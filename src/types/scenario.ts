import { z } from 'zod'

/** 空き枠判定ルール。サイトごとに空き表現が違うのでピッカーで学習して生成する。 */
export const availableRuleSchema = z.object({
  hasClass: z.array(z.string()).optional(),
  notClass: z.array(z.string()).optional(),
  notAttr: z.array(z.string()).optional(),
  textIn: z.array(z.string()).optional(),
  textNotIn: z.array(z.string()).optional(),
  hasChild: z.string().optional()
})
export type AvailableRule = z.infer<typeof availableRuleSchema>

const baseStepSchema = z.object({
  id: z.string(),
  /** UI表示用（例: "会社名を入力"） */
  label: z.string().optional(),
  /** iframe セレクタ。指定時は frameLocator 経由 */
  frame: z.string().optional(),
  /** 失敗しても続行 */
  optional: z.boolean().optional()
})

export const fillStepSchema = baseStepSchema.extend({
  type: z.literal('fill'),
  selector: z.string(),
  /** テンプレート展開対象 */
  value: z.string()
})

export const clickStepSchema = baseStepSchema.extend({
  type: z.literal('click'),
  selector: z.string(),
  waitAfter: z.number().optional()
})

export const selectStepSchema = baseStepSchema.extend({
  type: z.literal('select'),
  selector: z.string(),
  /** option の value か label */
  value: z.string()
})

export const checkStepSchema = baseStepSchema.extend({
  type: z.literal('check'),
  selector: z.string(),
  checked: z.boolean()
})

export const pickDateStepSchema = baseStepSchema.extend({
  type: z.literal('pickDate'),
  /** 例: "[data-date='{{today+7|YYYY-MM-DD}}']" */
  selector: z.string()
})

export const pickSlotStepSchema = baseStepSchema.extend({
  type: z.literal('pickSlot'),
  /** カレンダー全体 */
  grid: z.string(),
  /** 各セル */
  cell: z.string(),
  available: availableRuleSchema,
  range: z
    .object({
      minDaysAhead: z.number().optional(),
      maxDaysAhead: z.number().optional()
    })
    .optional(),
  strategy: z.enum(['first', 'last', 'random']),
  /** 翌月ボタン */
  nextMonth: z.string().optional(),
  maxMonthNav: z.number().optional()
})

export const waitStepSchema = baseStepSchema.extend({
  type: z.literal('wait'),
  ms: z.number().optional(),
  /** 要素の出現待ち */
  selector: z.string().optional()
})

export const assertStepSchema = baseStepSchema.extend({
  type: z.literal('assert'),
  selector: z.string(),
  mode: z.enum(['text', 'visible', 'url']),
  value: z.string().optional()
})

export const screenshotStepSchema = baseStepSchema.extend({
  type: z.literal('screenshot'),
  name: z.string()
})

/** 計測タグの発火をアサートする（設計 §10）。 */
export const assertTrackingStepSchema = baseStepSchema.extend({
  type: z.literal('assertTracking'),
  provider: z.string(),
  eventName: z.string().optional(),
  /** 期待発火回数。GTMトリガー誤設定による水増しを検出する */
  expectedCount: z.number().optional(),
  /** ここまでに発火していることを期待する猶予 ms */
  timeoutMs: z.number().optional()
})

export const stepSchema = z.discriminatedUnion('type', [
  fillStepSchema,
  clickStepSchema,
  selectStepSchema,
  checkStepSchema,
  pickDateStepSchema,
  pickSlotStepSchema,
  waitStepSchema,
  assertStepSchema,
  screenshotStepSchema,
  assertTrackingStepSchema
])

export const scenarioSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  url: z.string().url(),
  /** {{var.key}} で参照 */
  variables: z.record(z.string()).optional(),
  /** 媒体別テストCVプリセットID（設計 §11.1） */
  presetId: z.string().optional(),
  /** ステップ間の既定ウェイト ms。人間らしい間隔を入れる */
  stepDelayMs: z.number().optional(),
  steps: z.array(stepSchema),
  createdAt: z.string(),
  updatedAt: z.string()
})

export type FillStep = z.infer<typeof fillStepSchema>
export type ClickStep = z.infer<typeof clickStepSchema>
export type SelectStep = z.infer<typeof selectStepSchema>
export type CheckStep = z.infer<typeof checkStepSchema>
export type PickDateStep = z.infer<typeof pickDateStepSchema>
export type PickSlotStep = z.infer<typeof pickSlotStepSchema>
export type WaitStep = z.infer<typeof waitStepSchema>
export type AssertStep = z.infer<typeof assertStepSchema>
export type ScreenshotStep = z.infer<typeof screenshotStepSchema>
export type AssertTrackingStep = z.infer<typeof assertTrackingStepSchema>
export type Step = z.infer<typeof stepSchema>
export type Scenario = z.infer<typeof scenarioSchema>

export type StepType = Step['type']
