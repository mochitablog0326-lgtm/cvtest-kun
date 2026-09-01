import { z } from 'zod'

/** 媒体別テストCVプリセット（設計 §11.1）。 */
export const testCvPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** URLからの自動判定 */
  detect: z.object({ urlIncludes: z.array(z.string()).optional() }).optional(),
  rules: z.object({
    /** 姓名欄に必ず含める文字列（例: ["テスト"]） */
    nameFieldMustInclude: z.array(z.string()).optional(),
    /** メールアドレスに付けるサフィックス（例: "+test"） */
    emailSuffix: z.string().optional(),
    /** ラベルに一致する項目を固定値で上書きする */
    forceValues: z.record(z.string()).optional()
  }),
  cleanup: z.object({
    auto: z.boolean(),
    /** 手動対応が必要な場合の手順 */
    note: z.string()
  }),
  /** 実行前に強調表示する注意書き */
  warning: z.string().optional(),
  docUrl: z.string().optional()
})

export type TestCvPreset = z.infer<typeof testCvPresetSchema>

export const presetsSchema = z.array(testCvPresetSchema)
