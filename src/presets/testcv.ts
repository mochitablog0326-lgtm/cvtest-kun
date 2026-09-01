import { z } from 'zod'
import type { Field } from '../types/field'
import type { Step } from '../types/scenario'
import builtinPresets from './data/presets.json'

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

/** 同梱プリセット。ユーザー追加分は userData/presets/ から読み込んでマージする。 */
export const BUILTIN_PRESETS: TestCvPreset[] = presetsSchema.parse(builtinPresets)

export function findPreset(id: string, presets: TestCvPreset[] = BUILTIN_PRESETS): TestCvPreset | undefined {
  return presets.find((p) => p.id === id)
}

/** URL から媒体を自動判定する（設計 §11.1 の挙動1）。 */
export function detectPreset(
  url: string,
  presets: TestCvPreset[] = BUILTIN_PRESETS
): TestCvPreset | undefined {
  return presets.find((p) =>
    (p.detect?.urlIncludes ?? []).some((fragment) => fragment && url.includes(fragment))
  )
}

/**
 * 「会社名」「店舗名」なども `名` を含むため、除外語を先に見る。
 * 社名を「テスト株式会社サンプル」に書き換えてしまうのを防ぐ。
 */
const NAME_EXCLUDE =
  /会社|企業|法人|団体|組織|部署|部門|屋号|店舗|物件|商品|件名|company|corp|organization|department|subject/i
const NAME_INCLUDE = /名前|氏名|お名前|担当者|\bname\b|last_?name|first_?name|\bsei\b|\bmei\b/i

/** 姓名欄っぽいラベル・name か。 */
function isNameField(field: Field): boolean {
  if (field.type !== 'text') return false
  const haystack = `${field.label} ${field.name ?? ''}`
  if (NAME_EXCLUDE.test(haystack)) return false
  if (NAME_INCLUDE.test(haystack)) return true
  // 姓・名で分割入力するフォーム（ラベルが1文字）
  return /^(姓|名)$/.test(field.label.trim())
}

function isEmailField(field: Field): boolean {
  if (field.type === 'email') return true
  const haystack = `${field.label} ${field.name ?? ''}`.toLowerCase()
  return /メール|mail|email/.test(haystack)
}

export interface PresetViolation {
  ref: string
  label: string
  reason: string
  suggested: string
}

/**
 * プリセットのルールを値に強制適用する（設計 §11.1 の挙動2）。
 *
 * AI生成・手動入力のどちらであっても後段で必ず通す。
 * 「テスト」が入っていなければ自動で付与する。
 */
export function applyPreset(
  values: Record<string, string | boolean>,
  fields: Field[],
  preset: TestCvPreset
): { values: Record<string, string | boolean>; applied: PresetViolation[] } {
  const out = { ...values }
  const applied: PresetViolation[] = []
  const fieldByRef = new Map(fields.map((f) => [f.ref, f]))

  const markers = preset.rules.nameFieldMustInclude ?? []

  for (const [ref, value] of Object.entries(out)) {
    const field = fieldByRef.get(ref)
    if (!field || typeof value !== 'string') continue

    if (markers.length > 0 && isNameField(field)) {
      const hasMarker = markers.some((m) => value.includes(m))
      if (!hasMarker) {
        const suggested = `${markers[0]}${value}`
        out[ref] = suggested
        applied.push({
          ref,
          label: field.label,
          reason: `${preset.label}のテストCV判定に必要な「${markers[0]}」が含まれていません`,
          suggested
        })
      }
    }

    if (preset.rules.emailSuffix && isEmailField(field) && value.includes('@')) {
      const [local = '', domain = ''] = value.split('@')
      if (!local.includes(preset.rules.emailSuffix)) {
        const suggested = `${local}${preset.rules.emailSuffix}@${domain}`
        out[ref] = suggested
        applied.push({
          ref,
          label: field.label,
          reason: `${preset.label}のルールによりメールアドレスに ${preset.rules.emailSuffix} を付与しました`,
          suggested
        })
      }
    }
  }

  for (const [labelPattern, forced] of Object.entries(preset.rules.forceValues ?? {})) {
    const field = fields.find((f) => f.label.includes(labelPattern))
    if (!field) continue
    if (out[field.ref] === forced) continue
    out[field.ref] = forced
    applied.push({
      ref: field.ref,
      label: field.label,
      reason: `${preset.label}のルールにより固定値を適用しました`,
      suggested: forced
    })
  }

  return { values: out, applied }
}

/**
 * 実行直前に、シナリオのステップがプリセット条件を満たしているか検証する
 * （設計 §11.1 の挙動3）。満たさない値が残っていれば警告する。
 */
export function verifySteps(steps: Step[], preset: TestCvPreset): string[] {
  const markers = preset.rules.nameFieldMustInclude ?? []
  if (markers.length === 0) return []

  const fillSteps = steps.filter((s): s is Extract<Step, { type: 'fill' }> => s.type === 'fill')
  const nameLike = fillSteps.filter((s) =>
    /名前|氏名|姓|name/i.test(`${s.label ?? ''} ${s.selector}`)
  )

  if (nameLike.length === 0) {
    return [
      `${preset.label}: 姓名欄と思われるステップが見つかりませんでした。` +
        `テストCVと認識されない可能性があります（「${markers[0]}」を含む必要があります）。`
    ]
  }

  const missing = nameLike.filter((s) => !markers.some((m) => s.value.includes(m)))
  return missing.map(
    (s) =>
      `${preset.label}: 「${s.label ?? s.selector}」の値に「${markers[0]}」が含まれていません。` +
      'テストCVとして扱われず、実際の成果として計上される可能性があります。'
  )
}
