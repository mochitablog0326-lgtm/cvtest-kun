import { WebContentsView, type BrowserWindow, type WebFrameMain } from 'electron'
import { join } from 'node:path'
import { EXTRACT_SCRIPT, renumber, type RawExtract } from '../engine/extract'
import { PICKER_SCRIPT } from '../engine/picker'
import type { ExtractResult, Field } from '../types/field'
import { pickedElementSchema, type PickedElement } from '../types/picker'
import type { Bounds, NavState } from '../types/browser'

export type { Bounds, NavState }

/**
 * アプリ内に埋め込むブラウザ（設計 §7 の録画UI）。
 *
 * 録画・ピッカー・項目抽出はこの埋め込みビューで行う。
 * 一方、シナリオの「実行」は Playwright のまま。自動待機・trace・
 * iframe 対応・計測タグ監視が要るので、設計 §2 の判断を変えていない。
 */
export class EmbeddedBrowser {
  private view: WebContentsView | undefined
  /**
   * 初期サイズを持たせておく。
   * ハニーポット判定は getBoundingClientRect を使うので、
   * 潰れた矩形でレイアウトされると全項目が罠と誤判定されうる。
   * （実測では 0x0 でも正しく判定されたが、この挙動に依存しない）
   */
  private bounds: Bounds = { x: 0, y: 0, width: 1280, height: 900 }
  private visible = false
  private pickerActive = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly onPicked: (picked: PickedElement) => void,
    private readonly onNavigate: (state: NavState) => void,
    private readonly onPickerState: (active: boolean) => void
  ) {}

  private ensure(): WebContentsView {
    if (this.view) return this.view

    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/page.js'),
        // 対象ページは第三者のサイト。隔離を緩めない
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // 録画中のページごとにセッションを分け、アプリ本体と混ぜない
        partition: 'persist:cvtest-recording'
      }
    })

    this.window.contentView.addChildView(view)
    view.setBounds(this.bounds)
    view.setVisible(this.visible)

    const wc = view.webContents

    // ページ遷移のたびにピッカーを入れ直す。SPA の遷移も拾う
    wc.on('dom-ready', () => {
      void this.reinjectPicker()
      this.emitNavState()
    })
    wc.on('did-navigate', () => this.emitNavState())
    wc.on('did-navigate-in-page', () => this.emitNavState())

    // 対象ページから新規ウィンドウを開かせない。同じビュー内で遷移させる
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url)
      return { action: 'deny' }
    })

    this.view = view
    return view
  }

  private emitNavState(): void {
    if (!this.view) return
    const wc = this.view.webContents
    this.onNavigate({
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading()
    })
  }

  /** 対象ページから届いた値を検証する。信用できない入力なので必ず通す。 */
  handlePicked(raw: unknown): void {
    const parsed = pickedElementSchema.safeParse(raw)
    if (!parsed.success) return
    this.onPicked(parsed.data)
  }

  /** ページ側でピッカーが開始・解除されたとき（ESC を含む）。 */
  handlePickerState(raw: unknown): void {
    const active = Boolean((raw as { active?: unknown } | null)?.active)
    this.pickerActive = active
    this.onPickerState(active)
  }

  async open(url: string): Promise<string> {
    const view = this.ensure()
    await view.webContents.loadURL(url)
    return view.webContents.getURL()
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds
    this.view?.setBounds(bounds)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.view?.setVisible(visible)
  }

  get isOpen(): boolean {
    return Boolean(this.view)
  }

  private get webContents(): Electron.WebContents {
    if (!this.view) throw new Error('ブラウザが開かれていません')
    return this.view.webContents
  }

  async goBack(): Promise<void> {
    const nav = this.webContents.navigationHistory
    if (nav.canGoBack()) nav.goBack()
  }

  async goForward(): Promise<void> {
    const nav = this.webContents.navigationHistory
    if (nav.canGoForward()) nav.goForward()
  }

  async reload(): Promise<void> {
    this.webContents.reload()
  }

  async screenshot(): Promise<string> {
    const image = await this.webContents.capturePage()
    return `data:image/png;base64,${image.toPNG().toString('base64')}`
  }

  // --- ピッカー ---

  private async reinjectPicker(): Promise<void> {
    if (!this.pickerActive || !this.view) return
    try {
      await this.webContents.executeJavaScript(PICKER_SCRIPT)
      await this.webContents.executeJavaScript('window.__cvtestStartPicker()')
    } catch {
      // 遷移直後で実行できないことがある。次の dom-ready で入り直す
    }
  }

  async startPicker(): Promise<void> {
    this.pickerActive = true
    await this.webContents.executeJavaScript(PICKER_SCRIPT)
    await this.webContents.executeJavaScript('window.__cvtestStartPicker()')
  }

  async stopPicker(): Promise<void> {
    this.pickerActive = false
    if (!this.view) return
    await this.webContents
      .executeJavaScript('window.__cvtestStopPicker && window.__cvtestStopPicker()')
      .catch(() => undefined)
  }

  // --- 抽出 ---

  /** 子フレームの iframe セレクタを、親フレーム側の src 突き合わせで求める。 */
  private async frameSelectors(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    try {
      const list = (await this.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('iframe')).map((f, i) => ({
           src: f.src,
           selector: f.id
             ? 'iframe#' + CSS.escape(f.id)
             : f.name
               ? 'iframe[name="' + f.name + '"]'
               : f.getAttribute('src')
                 ? 'iframe[src="' + f.getAttribute('src') + '"]'
                 : 'iframe:nth-of-type(' + (i + 1) + ')'
         }))`
      )) as { src: string; selector: string }[]

      for (const entry of list) {
        if (entry.src) map.set(entry.src, entry.selector)
      }
    } catch {
      // iframe が読めなくても本体の抽出は続ける
    }
    return map
  }

  async extractFields(): Promise<ExtractResult> {
    const wc = this.webContents
    const main = (await wc.executeJavaScript(EXTRACT_SCRIPT)) as RawExtract
    const fields: Field[] = main.fields.map((f) => ({ ...f }))

    const selectors = await this.frameSelectors()

    for (const frame of childFrames(wc.mainFrame)) {
      const selector = selectors.get(frame.url)
      if (!selector) continue

      let raw: RawExtract
      try {
        raw = (await frame.executeJavaScript(EXTRACT_SCRIPT)) as RawExtract
      } catch {
        continue // cross-origin などで読めないフレームは飛ばす
      }
      if (raw.fields.length === 0) continue

      for (const f of raw.fields) fields.push({ ...f, frame: selector })
    }

    return renumber({
      url: wc.getURL(),
      title: main.title,
      pageHeading: main.pageHeading,
      fields
    })
  }

  destroy(): void {
    if (!this.view) return
    this.window.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.view = undefined
    this.pickerActive = false
  }
}

/** 直下の子フレームを列挙する。 */
function childFrames(main: WebFrameMain): WebFrameMain[] {
  try {
    return main.frames
  } catch {
    return []
  }
}
