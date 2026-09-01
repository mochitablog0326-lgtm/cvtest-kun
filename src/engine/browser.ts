import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

export interface LaunchOptions {
  headless?: boolean
  /** 'chrome' | 'msedge' | undefined（Playwright同梱ブラウザ） */
  channel?: string
  /** trace を録る出力先ディレクトリ。未指定なら録らない */
  traceDir?: string
  viewport?: { width: number; height: number }
  locale?: string
  timezoneId?: string
  /** 実行可能ファイルの明示指定。Cask配布時にユーザーが上書きできる */
  executablePath?: string
}

export interface Session {
  browser: Browser
  context: BrowserContext
  page: Page
  close(): Promise<void>
}

/**
 * playwright-core はブラウザを同梱しないので、実行環境にある Chrome を使う。
 * 候補を順に試し、全滅したら何をすればよいかを日本語で示す。
 */
const CHANNEL_CANDIDATES = ['chrome', 'chrome-beta', 'msedge']

export function isBrowserMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes("Executable doesn't exist") ||
    message.includes('Chromium distribution') ||
    message.includes('is not found') ||
    message.includes('ENOENT')
  )
}

export const BROWSER_SETUP_HINT = [
  'ブラウザが見つかりませんでした。',
  '次のいずれかで解決できます:',
  '  1. Google Chrome をインストールする（推奨）',
  '  2. npx playwright install chromium を実行する',
  '  3. 設定でブラウザの実行ファイルパスを指定する'
].join('\n')

async function launchBrowser(opts: LaunchOptions): Promise<Browser> {
  const headless = opts.headless ?? false

  if (opts.executablePath) {
    return chromium.launch({ headless, executablePath: opts.executablePath })
  }

  const channels = opts.channel ? [opts.channel] : CHANNEL_CANDIDATES
  let lastError: unknown

  for (const channel of channels) {
    try {
      return await chromium.launch({ headless, channel })
    } catch (err) {
      lastError = err
      if (!isBrowserMissingError(err)) throw err
    }
  }

  // Playwright 同梱ブラウザ（npx playwright install 済みなら通る）
  try {
    return await chromium.launch({ headless })
  } catch (err) {
    if (isBrowserMissingError(err) || isBrowserMissingError(lastError)) {
      throw new Error(BROWSER_SETUP_HINT)
    }
    throw err
  }
}

export async function launch(opts: LaunchOptions = {}): Promise<Session> {
  const browser = await launchBrowser(opts)

  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 900 },
    // 日本のフォームを相手にするので既定を JST / ja-JP にする
    locale: opts.locale ?? 'ja-JP',
    timezoneId: opts.timezoneId ?? 'Asia/Tokyo'
  })

  if (opts.traceDir) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  }

  const page = await context.newPage()

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    try {
      if (opts.traceDir) {
        await context.tracing.stop({ path: `${opts.traceDir}/trace.zip` }).catch(() => {})
      }
      await context.close().catch(() => {})
    } finally {
      await browser.close().catch(() => {})
    }
  }

  return { browser, context, page, close }
}

/**
 * frame 指定があれば frameLocator 経由の Locator を返す。
 * ステップ実行はすべてここを通し、iframe を透過的に扱う。
 */
export function locate(page: Page, selector: string, frame?: string) {
  return frame ? page.frameLocator(frame).locator(selector) : page.locator(selector)
}
