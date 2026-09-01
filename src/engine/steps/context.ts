import type { Page } from 'playwright-core'
import type { TrackingMonitor } from '../tracking'

/** 各ステップ実装に渡す実行コンテキスト。runner が組み立てる。 */
export interface StepContext {
  page: Page
  tracking: TrackingMonitor
  /** テンプレート展開（{{today+7}} 等）。未定義参照は例外になる */
  expand(value: string): string
  /** 実行ログ。UI へストリーミングされる */
  log(message: string): void
  /** スクリーンショットや trace の出力先 */
  runDir: string
  /** 撮ったスクショのパスを積む先 */
  screenshots: string[]
  /** ステップ既定タイムアウト ms */
  timeoutMs: number
  /** 中断要求。true になったら次のステップに進まない */
  isAborted(): boolean
}

/** ステップ固有の記録（RunResult.steps[].detail に載る）。 */
export type StepDetail = Record<string, unknown> | undefined
