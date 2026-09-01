import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Scenario, Step } from '../types/scenario'
import type { CleanupItem, RunResult, StepResult } from '../types/result'
import { launch, type LaunchOptions, type Session } from './browser'
import { TrackingMonitor } from './tracking'
import { expand, type TemplateContext } from './template'
import type { StepContext, StepDetail } from './steps/context'
import { fill } from './steps/fill'
import { click } from './steps/click'
import { select } from './steps/select'
import { check } from './steps/check'
import { pickDate } from './steps/pickDate'
import { pickSlot } from './steps/pickSlot'
import { assertStep, assertTracking, wait } from './steps/assert'
import { screenshot } from './steps/screenshot'
import { detectPreset, findPreset, verifySteps, type TestCvPreset } from '../presets/testcv'

export interface RunOptions {
  /** 実行結果の保存先ルート（この下に日時ディレクトリを作る） */
  runsDir: string
  launch?: LaunchOptions
  template?: Omit<TemplateContext, 'now'>
  presets?: TestCvPreset[]
  /** ステップ既定タイムアウト ms */
  timeoutMs?: number
  /** ステップ間の既定ウェイト ms。人間らしい間隔を入れる（設計 §11） */
  stepDelayMs?: number
  /** trace を録るか */
  trace?: boolean
  onStep?: (result: StepResult) => void
  onLog?: (message: string) => void
  /** true を返すと中断する */
  shouldAbort?: () => boolean
}

/** 実行時刻からディレクトリ名を作る（2026-09-01T14-30-22）。 */
export function runDirName(at: Date = new Date()): string {
  return at.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-')
}

const DEFAULT_TIMEOUT = 15_000
const DEFAULT_STEP_DELAY = 400

async function runStep(step: Step, ctx: StepContext): Promise<StepDetail> {
  switch (step.type) {
    case 'fill':
      return fill(step, ctx)
    case 'click':
      return click(step, ctx)
    case 'select':
      return select(step, ctx)
    case 'check':
      return check(step, ctx)
    case 'pickDate':
      return pickDate(step, ctx)
    case 'pickSlot':
      return pickSlot(step, ctx)
    case 'wait':
      return wait(step, ctx)
    case 'assert':
      return assertStep(step, ctx)
    case 'assertTracking':
      return assertTracking(step, ctx)
    case 'screenshot':
      return screenshot(step, ctx)
  }
}

/**
 * シナリオを実行する。
 *
 * このツールは実際にフォームを送信し、実際に予約を入れる（設計 §11）。
 * 途中で落ちても「何をしたか」を必ず残す ─ 後始末できないのが最悪の状態なので。
 */
export async function run(scenario: Scenario, options: RunOptions): Promise<RunResult> {
  const startedAt = new Date()
  const runDir = join(options.runsDir, runDirName(startedAt))
  await mkdir(runDir, { recursive: true })

  const preset =
    (scenario.presetId ? findPreset(scenario.presetId, options.presets) : undefined) ??
    detectPreset(scenario.url, options.presets)

  const log = (message: string): void => options.onLog?.(message)

  // 実行前チェック: プリセット条件を満たさない値が残っていないか（設計 §11.1）
  const warnings = preset ? verifySteps(scenario.steps, preset) : []
  for (const w of warnings) log(`警告: ${w}`)

  const steps: StepResult[] = []
  const screenshots: string[] = []
  let pickedDate: string | undefined
  let status: RunResult['status'] = 'success'
  let error: string | undefined

  let session: Session | undefined
  let tracking: TrackingMonitor | undefined

  try {
    session = await launch({
      ...options.launch,
      traceDir: options.trace === false ? undefined : runDir
    })

    tracking = new TrackingMonitor(session.context)
    tracking.start()

    const ctx: StepContext = {
      page: session.page,
      tracking,
      expand: (value) => expand(value, { ...options.template, variables: scenario.variables, now: startedAt }),
      log,
      runDir,
      screenshots,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
      isAborted: () => options.shouldAbort?.() ?? false
    }

    log(`ページを開きます: ${scenario.url}`)
    await session.page.goto(scenario.url, { waitUntil: 'domcontentloaded' })
    await tracking.snapshotCookies(session.page)

    const stepDelay = scenario.stepDelayMs ?? options.stepDelayMs ?? DEFAULT_STEP_DELAY

    for (const step of scenario.steps) {
      if (ctx.isAborted()) {
        status = 'aborted'
        error = '実行が中断されました'
        log(abortNotice(preset))
        break
      }

      const stepStart = Date.now()
      const stepStartedAt = new Date().toISOString()
      const title = step.label ?? step.type

      log(`[${step.type}] ${title}`)

      let result: StepResult
      try {
        const detail = await runStep(step, ctx)
        if (detail && typeof detail['pickedDate'] === 'string') {
          pickedDate = detail['pickedDate']
        }
        result = {
          id: step.id,
          type: step.type,
          label: step.label,
          status: 'ok',
          startedAt: stepStartedAt,
          durationMs: Date.now() - stepStart,
          detail
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result = {
          id: step.id,
          type: step.type,
          label: step.label,
          status: step.optional ? 'skipped' : 'failed',
          startedAt: stepStartedAt,
          durationMs: Date.now() - stepStart,
          message
        }

        if (step.optional) {
          log(`  スキップ（optional）: ${message}`)
        } else {
          log(`  失敗: ${message}`)
          steps.push(result)
          options.onStep?.(result)
          status = 'failed'
          error = message
          await captureFailure(ctx, screenshots)
          break
        }
      }

      steps.push(result)
      options.onStep?.(result)

      if (stepDelay > 0) {
        await session.page.waitForTimeout(stepDelay)
      }
    }

    if (status === 'success') {
      await tracking.snapshotCookies(session.page)
    }
  } catch (err) {
    status = 'failed'
    error = err instanceof Error ? err.message : String(err)
    log(`実行エラー: ${error}`)
  } finally {
    tracking?.stop()
    await session?.close()
  }

  const result: RunResult = {
    scenarioName: scenario.name,
    url: scenario.url,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    steps,
    pickedDate,
    screenshots,
    tracePath: options.trace === false ? undefined : join(runDir, 'trace.zip'),
    trackingEvents: tracking?.getEvents() ?? [],
    cookieSnapshots: tracking?.getCookieSnapshots() ?? [],
    presetId: preset?.id,
    cleanup: buildCleanup({ status, pickedDate, preset, warnings }),
    runDir,
    error
  }

  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8')
  await writeFile(join(runDir, 'cleanup.md'), renderCleanup(result, preset), 'utf8')

  return result
}

/**
 * qualva のドキュメントには「テストにもかかわらず途中で離脱すると
 * ダッシュボードの数値に影響する」との記載がある（設計 §11.1）。
 * 中断時はその旨を必ず伝える。
 */
function abortNotice(preset: TestCvPreset | undefined): string {
  if (preset?.warning) {
    return `中断しました。${preset.label}: ${preset.warning}`
  }
  return '中断しました。フォームを途中まで送信している場合、媒体の数値に影響する可能性があります。'
}

async function captureFailure(ctx: StepContext, screenshots: string[]): Promise<void> {
  try {
    const path = join(ctx.runDir, 'failure.png')
    await ctx.page.screenshot({ path, fullPage: true })
    screenshots.push(path)
  } catch {
    // スクショが撮れなくても結果の保存は続ける
  }
}

/** 後始末チェックリストを組み立てる（設計 §11.2）。 */
function buildCleanup(input: {
  status: RunResult['status']
  pickedDate?: string
  preset?: TestCvPreset
  warnings: string[]
}): CleanupItem[] {
  const items: CleanupItem[] = []

  if (input.preset && !input.preset.cleanup.auto) {
    items.push({ done: false, text: input.preset.cleanup.note, source: 'preset' })
  }

  // 何を予約したか分からないと片付けられない（設計 §11.2）
  if (input.pickedDate) {
    items.push({
      done: false,
      text: `予約枠 ${input.pickedDate} をキャンセルする`,
      source: 'reservation'
    })
  }

  if (input.status !== 'success') {
    items.push({
      done: false,
      text: '実行が完了しませんでした。フォームが途中まで送信されていないか確認する',
      source: 'manual'
    })
  }

  for (const w of input.warnings) {
    items.push({ done: false, text: w, source: 'preset' })
  }

  return items
}

function renderCleanup(result: RunResult, preset: TestCvPreset | undefined): string {
  const lines: string[] = []
  const mark = result.status === 'success' ? '完了' : '未完了'

  lines.push(`# 後始末チェックリスト`)
  lines.push('')
  lines.push(`- シナリオ: ${result.scenarioName}`)
  lines.push(`- URL: ${result.url}`)
  lines.push(`- 実行: ${result.startedAt}`)
  lines.push(`- 結果: ${mark}（${result.status}）`)
  if (preset) lines.push(`- 媒体プリセット: ${preset.label}`)
  if (result.pickedDate) lines.push(`- 選択した予約枠: **${result.pickedDate}**`)
  lines.push('')

  if (result.cleanup.length === 0) {
    lines.push('必要な後始末はありません。')
    if (preset?.cleanup.auto) lines.push('')
    if (preset?.cleanup.auto) lines.push(`> ${preset.cleanup.note}`)
  } else {
    lines.push('## やること')
    lines.push('')
    for (const item of result.cleanup) {
      lines.push(`- [ ] ${item.text}`)
    }
  }

  lines.push('')
  lines.push('## 計測タグ発火')
  lines.push('')
  if (result.trackingEvents.length === 0) {
    lines.push('検出されませんでした。CVが計測されていない可能性があります。')
  } else {
    for (const e of result.trackingEvents) {
      lines.push(`- ${e.provider}${e.eventName ? ` / ${e.eventName}` : ''}: ${e.count} 回`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
