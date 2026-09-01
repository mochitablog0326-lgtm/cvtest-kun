import type { StepType } from './scenario'

export type RunStatus = 'success' | 'failed' | 'aborted'

export interface StepResult {
  id: string
  type: StepType
  label?: string
  status: 'ok' | 'failed' | 'skipped'
  startedAt: string
  durationMs: number
  message?: string
  /** pickSlot が選んだ日付など、ステップ固有の記録 */
  detail?: Record<string, unknown>
}

export interface TrackingEvent {
  /** "GA4" | "Google Ads" | "Yahoo" | "Meta" | "GTM" | "unknown" */
  provider: string
  url: string
  eventName?: string
  /** 発火回数。重複発火の検出に使う */
  count: number
  at: string
}

export interface CookieSnapshot {
  at: string
  url: string
  cookies: { name: string; domain: string; value: string }[]
}

export interface CleanupItem {
  done: boolean
  text: string
  /** 由来: "preset" | "reservation" | "manual" */
  source: string
}

export interface RunResult {
  scenarioName: string
  url: string
  startedAt: string
  finishedAt: string
  status: RunStatus
  steps: StepResult[]
  /** pickSlot が何を選んだか（必須で記録） */
  pickedDate?: string
  screenshots: string[]
  tracePath?: string
  trackingEvents: TrackingEvent[]
  cookieSnapshots: CookieSnapshot[]
  /** 適用された媒体プリセットID */
  presetId?: string
  cleanup: CleanupItem[]
  runDir: string
  error?: string
}
