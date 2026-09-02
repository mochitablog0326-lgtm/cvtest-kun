import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvailableRule, Step } from '../../../types/scenario'
import type { PickedElement } from '../../../types/picker'
import type { NavState } from '../../../types/browser'

/** カレンダーセルをクリックしたときの選択肢（設計 §7）。 */
type DateMode = 'fixed' | 'relative' | 'auto'

interface LearnState {
  /** 空き枠と満席枠を1つずつクリックさせる学習フロー */
  stage: 'available' | 'full'
  /** date: 日付カレンダー / time: 時間帯の一覧 */
  kind: 'date' | 'time'
  grid: string
  cell: string
  available?: PickedElement
}

interface Props {
  /** 開くURL。編集中のシナリオのURLを渡す */
  url: string
  onUrlChange?: (url: string) => void
  /** ステップが確定したとき。picked は取り直し用に生の情報も渡す */
  onStep: (step: Step, picked: PickedElement) => void
  /** 見出し。呼び出し側で文脈に合わせて変える */
  title?: string
  /**
   * 取り直しモード。ラベルは空文字にもなりうるので、
   * 有効かどうかは真偽値で受け取る。
   */
  repickActive?: boolean
  repickLabel?: string
  onCancelRepick?: () => void
}

let stepSeq = 0
const newId = (): string => `s${++stepSeq}-${Math.random().toString(36).slice(2, 6)}`

/**
 * 埋め込みブラウザとピッカーをまとめた部品。
 * 新規録画と既存シナリオの編集で同じ操作になるよう共有する。
 */
export function PickerPane({
  url,
  onUrlChange,
  onStep,
  title = 'ブラウザ',
  repickActive = false,
  repickLabel,
  onCancelRepick
}: Props): JSX.Element {
  const [inputUrl, setInputUrl] = useState(url)
  const [opened, setOpened] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nav, setNav] = useState<NavState | undefined>()

  const [dialog, setDialog] = useState<PickedElement | undefined>()
  const [dateMode, setDateMode] = useState<DateMode>('auto')
  const [daysAhead, setDaysAhead] = useState(7)
  const [learn, setLearn] = useState<LearnState | undefined>()

  // イベントハンドラから最新の状態を読むための写し
  const learnRef = useRef<LearnState | undefined>(undefined)
  learnRef.current = learn
  const repickRef = useRef(false)
  repickRef.current = repickActive

  const slotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setInputUrl(url), [url])

  const fail = (err: unknown): void => setError(err instanceof Error ? err.message : String(err))

  const syncBounds = useCallback((): void => {
    const el = slotRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    void window.api.browser.setBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
  }, [])

  // ウィンドウのリサイズとスクロールに追従させる
  useEffect(() => {
    if (!opened) return undefined
    syncBounds()
    const handler = (): void => syncBounds()
    window.addEventListener('resize', handler)
    const main = document.querySelector('.main')
    main?.addEventListener('scroll', handler)
    const observer = new ResizeObserver(handler)
    if (slotRef.current) observer.observe(slotRef.current)
    return () => {
      window.removeEventListener('resize', handler)
      main?.removeEventListener('scroll', handler)
      observer.disconnect()
    }
  }, [opened, syncBounds])

  // 画面を離れたらビューを隠す。他の画面の上に貼り付いたままにしない
  useEffect(() => {
    return () => {
      void window.api.browser.setVisible(false)
    }
  }, [])

  useEffect(() => {
    return window.api.events.onBrowserNav((state) => setNav(state))
  }, [])

  // ページ側で ESC を押されたときにモード表示を合わせる
  useEffect(() => {
    return window.api.events.onPickerState((active) => {
      setPicking(active)
      if (!active) setLearn(undefined)
    })
  }, [])

  const open = async (): Promise<void> => {
    setBusy(true)
    try {
      setOpened(true)
      requestAnimationFrame(() => {
        syncBounds()
        void window.api.browser.setVisible(true)
      })
      await window.api.browser.open(inputUrl)
      onUrlChange?.(inputUrl)
      setError('')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 操作モードと選択モードを切り替える。
   * 選択モードはクリックを横取りするので、日付を押して現れる項目のように
   * 「操作した結果を見たい」場面では操作モードに戻す必要がある。
   */
  const setMode = async (next: 'operate' | 'pick'): Promise<void> => {
    try {
      if (next === 'pick') {
        await window.api.browser.startPicker()
        setPicking(true)
      } else {
        await window.api.browser.stopPicker()
        setPicking(false)
        setLearn(undefined)
      }
    } catch (err) {
      fail(err)
    }
  }

  /*
   * ピッカーの購読は一度だけ登録する（[] 依存）。そのため購読時の関数が
   * そのまま握られ続ける。onStep をそのまま呼ぶと、最初のレンダー時点の
   * 状態（取り直し対象や編集中のシナリオ）を見てしまい、取り直しが
   * 追加として扱われる。常に最新を呼ぶよう ref 経由にする。
   */
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep

  const emit = (step: Step, picked: PickedElement): void => onStepRef.current(step, picked)

  /** 通常の要素 → 型に応じたステップ。 */
  const addStepFor = (picked: PickedElement): void => {
    const base = { id: newId(), label: stepLabelFor(picked) }
    const type = (picked.inputType ?? '').toLowerCase()

    if (picked.tagName === 'select') {
      emit({ ...base, type: 'select', selector: picked.selector, value: '' }, picked)
      return
    }
    if (type === 'checkbox' || type === 'radio') {
      emit({ ...base, type: 'check', selector: picked.selector, checked: true }, picked)
      return
    }
    if (picked.tagName === 'button' || ['submit', 'button'].includes(type)) {
      emit({ ...base, type: 'click', selector: picked.selector }, picked)
      return
    }
    emit({ ...base, type: 'fill', selector: picked.selector, value: '' }, picked)
  }

  const handleLearnPick = async (picked: PickedElement, current: LearnState): Promise<void> => {
    if (current.stage === 'available') {
      setLearn({ ...current, stage: 'full', available: picked })
      return
    }
    if (!current.available) return

    try {
      const rule = (await window.api.browser.learnRule(current.available, picked)) as AvailableRule

      if (Object.keys(rule).length === 0) {
        setError(
          '2つの枠の見た目に違いが見つかりませんでした。空き枠と満席枠をもう一度選び直してください。'
        )
        setLearn({ stage: 'available', kind: current.kind, grid: current.grid, cell: current.cell })
        return
      }

      const isTime = current.kind === 'time'
      emit(
        {
          id: newId(),
          label: isTime ? '空いている時間を自動で選ぶ' : '空いている枠を自動で選ぶ',
          type: 'pickSlot',
          kind: current.kind,
          grid: current.grid,
          cell: current.cell,
          available: rule,
          // 日付は直近の枠を避けるのを既定にする（設計 §11）
          ...(isTime ? {} : { range: { minDaysAhead: 1 }, maxMonthNav: 3 }),
          strategy: 'random'
        },
        picked
      )
      setLearn(undefined)
      setError('')
    } catch (err) {
      fail(err)
    }
  }

  useEffect(() => {
    return window.api.events.onPickerSelected((picked) => {
      const learning = learnRef.current
      if (learning) {
        void handleLearnPick(picked, learning)
        return
      }
      // 取り直し中は種類を変えず、選ばれた要素をそのまま親へ渡す
      if (repickRef.current) {
        emit({ id: newId(), type: 'fill', selector: picked.selector, value: '' }, picked)
        return
      }
      if (picked.looksLikeTimeSlot || picked.looksLikeCalendarCell) {
        setDialog(picked)
        return
      }
      addStepFor(picked)
    })
  }, [])

  /** カレンダーダイアログの決定。 */
  const confirmDate = (): void => {
    if (!dialog) return
    const isTime = Boolean(dialog.looksLikeTimeSlot)
    const label = isTime
      ? `時間を選ぶ（${dialog.text || dialog.selector}）`
      : `日付を選ぶ（${dialog.text || dialog.selector}）`

    if (dateMode === 'fixed') {
      const fixed = isTime ? dialog.attrs['data-time'] : dialog.attrs['data-date']
      const attr = isTime ? 'data-time' : 'data-date'
      emit(
        {
          id: newId(),
          label,
          type: 'pickDate',
          selector: fixed ? `[${attr}="${fixed}"]` : dialog.selector
        },
        dialog
      )
      setDialog(undefined)
      return
    }

    if (dateMode === 'relative') {
      emit(
        {
          id: newId(),
          label: `${daysAhead}日後を選ぶ`,
          type: 'pickDate',
          selector: `[data-date="{{today+${daysAhead}|YYYY-MM-DD}}"]`
        },
        dialog
      )
      setDialog(undefined)
      return
    }

    // 空き枠の自動選択 → 判定ルールの学習フローへ（設計 §7）
    setLearn({
      stage: 'available',
      kind: isTime ? 'time' : 'date',
      grid: guessGrid(dialog),
      cell: guessCell(dialog)
    })
    setDialog(undefined)
  }

  return (
    <>
      {error && <div className="banner danger">{error}</div>}

      <div className="panel">
        <h2>{title}</h2>

        {repickActive && (
          <div className="banner warn">
            「{repickLabel || 'ラベルなし'}
            」を取り直します。ページを開き、選択モードで対象をクリックしてください。
            <button style={{ marginLeft: 12 }} onClick={onCancelRepick}>
              やめる
            </button>
          </div>
        )}

        <div className="row">
          <input
            className="grow"
            placeholder="https://example.com/contact"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
          />
          <button className="primary" onClick={() => void open()} disabled={!inputUrl || busy}>
            {opened ? '開き直す' : '開く'}
          </button>
        </div>

        {opened && (
          <>
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={() => void window.api.browser.back()} title="戻る">
                ←
              </button>
              <button onClick={() => void window.api.browser.forward()} title="進む">
                →
              </button>
              <button onClick={() => void window.api.browser.reload()} title="再読込">
                ↻
              </button>
              <div className="segmented">
                <button className={!picking ? 'active' : ''} onClick={() => void setMode('operate')}>
                  操作モード
                </button>
                <button className={picking ? 'active' : ''} onClick={() => void setMode('pick')}>
                  選択モード
                </button>
              </div>
              <span className="muted grow ellipsis">{nav?.loading ? '読み込み中… ' : ''}{nav?.url ?? inputUrl}</span>
            </div>

            {learn && (
              <div className="banner warn" style={{ marginTop: 10 }}>
                {learn.kind === 'time'
                  ? learn.stage === 'available'
                    ? '空いている時間を1つクリックしてください'
                    : '埋まっている時間を1つクリックしてください'
                  : learn.stage === 'available'
                    ? '空いている枠を1つクリックしてください'
                    : '埋まっている枠を1つクリックしてください'}
              </div>
            )}

            <p className="muted" style={{ margin: '10px 0' }}>
              {picking ? (
                <>
                  <strong>選択モード</strong>：クリックした要素がステップになります。
                  クリックはページに渡らないので送信は起きません。ESC で操作モードに戻ります。
                </>
              ) : (
                <>
                  <strong>操作モード</strong>：ページを普通に操作できます。
                  日付を押して現れる項目など、先に画面を進めてから選択モードに切り替えてください。
                </>
              )}
            </p>

            {/* 埋め込みブラウザはこの矩形に重なる */}
            <div ref={slotRef} className="browser-slot" />
          </>
        )}
      </div>

      {dialog && (
        <div className="panel">
          <h2>
            {dialog.looksLikeTimeSlot ? 'この時間枠をどう扱いますか？' : 'この日付をどう扱いますか？'}
          </h2>
          <div className="row">
            <label>
              <input type="radio" checked={dateMode === 'fixed'} onChange={() => setDateMode('fixed')} />{' '}
              {dialog.looksLikeTimeSlot ? 'この時間で固定する' : 'この日付で固定する'}
            </label>
          </div>
          {!dialog.looksLikeTimeSlot && (
            <div className="row">
              <label>
                <input
                  type="radio"
                  checked={dateMode === 'relative'}
                  onChange={() => setDateMode('relative')}
                />{' '}
                相対日付にする（今日から
                <input
                  type="number"
                  style={{ width: 70, display: 'inline-block', margin: '0 6px' }}
                  value={daysAhead}
                  onChange={(e) => setDaysAhead(Number(e.target.value))}
                />
                日後）
              </label>
            </div>
          )}
          <div className="row">
            <label>
              <input type="radio" checked={dateMode === 'auto'} onChange={() => setDateMode('auto')} />{' '}
              {dialog.looksLikeTimeSlot
                ? '空いている時間から自動で選ぶ（推奨）'
                : '空いている枠から自動で選ぶ（推奨）'}
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={confirmDate}>
              決定
            </button>
            <button onClick={() => setDialog(undefined)}>やめる</button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * ステップに付ける表示名。
 *
 * ラベルが取れないときに要素のテキストへ落ちるが、長すぎると一覧が
 * 読めなくなるので name 属性を優先し、最後に長さを詰める。
 */
export function stepLabelFor(picked: PickedElement): string {
  const raw =
    picked.label || picked.text || picked.attrs['name'] || picked.attrs['id'] || picked.tagName
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed
}

/** カレンダー・時間表の全体を指すセレクタを推測する。ユーザーが編集画面で直せる。 */
export function guessGrid(picked: PickedElement): string {
  const container = picked.attrs['data-grid-id']
  if (container) return `#${container}`
  const classes = picked.classes.filter((c) => /calendar|cal|schedule|month|time|slot/i.test(c))
  if (classes.length > 0) return `.${classes[0]}`
  return 'table'
}

/**
 * 枠1つを指すセレクタを推測する。
 *
 * 空き状況を表す class（available など）を使うと、埋まっている枠が
 * 候補から外れて判定が成り立たなくなる。data-time / data-date のような
 * 「枠であること」を示す属性があればそれを最優先する。
 */
export function guessCell(picked: PickedElement): string {
  for (const attr of ['data-time', 'data-date', 'data-slot', 'data-day']) {
    if (picked.attrs[attr] !== undefined) return `${picked.tagName}[${attr}]`
  }

  const stable = picked.classes.filter(
    (c) => !/selected|active|today|hover|available|free|open|full|disabled|notfree/i.test(c)
  )
  if (stable.length > 0) return `${picked.tagName}.${stable[0]}`
  return picked.tagName
}
