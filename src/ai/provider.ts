import { z } from 'zod'
import type { Field } from '../types/field'

export interface PageContext {
  url: string
  title: string
  pageHeading?: string
  /** ユーザーが指定した用途（例: "資料請求"） */
  purpose?: string
}

export type ValueMap = Record<string, string | boolean>

export interface GeneratedValues {
  values: ValueMap
  /** 送信ボタンの ref（b1 など） */
  submit?: string
  /** どのプロバイダが生成したか。UI表示用 */
  providerId?: string
  /** サニタイズで捨てた・直した内容。人間のレビュー材料になる */
  notes: string[]
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  isAvailable(): Promise<boolean>
  generateValues(fields: Field[], ctx: PageContext): Promise<GeneratedValues>
}

/** AIの返答スキーマ（設計 §6.3）。 */
export const aiResponseSchema = z.object({
  values: z.record(z.union([z.string(), z.boolean()])),
  submit: z.string().optional()
})

export type AIResponse = z.infer<typeof aiResponseSchema>

/** 制御文字を落とす。改行の混入で意図しない複数行入力になるのを防ぐ。 */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  // 改行・タブは残し、その他の制御文字と DEL を落とす
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** 1行入力欄に改行を入れさせない。 */
function toSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

const MAX_VALUE_LENGTH = 5000

/**
 * AI出力を実セレクタへ写す前に必ず通す（設計 §6.3 / §11）。
 *
 * AIにセレクタは書かせないので存在しない要素は指せないが、
 * 値の中身はプロンプトインジェクションの通り道になりうる。
 * 未知の ref は破棄し、型・長さ・選択肢の妥当性まで見る。
 */
export function sanitizeValues(
  raw: AIResponse,
  fields: Field[]
): { values: ValueMap; submit?: string; notes: string[] } {
  const notes: string[] = []
  const byRef = new Map(fields.map((f) => [f.ref, f]))
  const values: ValueMap = {}

  for (const [ref, rawValue] of Object.entries(raw.values)) {
    const field = byRef.get(ref)

    if (!field) {
      notes.push(`未知の項目 ${ref} を破棄しました`)
      continue
    }

    // ハニーポットには絶対に入力しない
    if (field.isHoneypot) {
      notes.push(`${ref}（${field.label}）はハニーポットのため入力しません`)
      continue
    }

    if (field.type === 'button') {
      notes.push(`${ref} はボタンのため値を無視しました`)
      continue
    }

    // チェックボックスは真偽値
    if (field.type === 'checkbox') {
      const bool =
        typeof rawValue === 'boolean'
          ? rawValue
          : ['true', 'yes', 'on', '1', 'はい'].includes(String(rawValue).toLowerCase())
      values[ref] = bool
      continue
    }

    if (typeof rawValue === 'boolean') {
      notes.push(`${ref}（${field.label}）に真偽値が来たため破棄しました`)
      continue
    }

    let value = stripControlChars(rawValue)

    if (field.type !== 'textarea') {
      value = toSingleLine(value)
    }

    if (value.length > MAX_VALUE_LENGTH) {
      value = value.slice(0, MAX_VALUE_LENGTH)
      notes.push(`${ref}（${field.label}）が長すぎるため切り詰めました`)
    }

    if (field.maxLength && value.length > field.maxLength) {
      value = value.slice(0, field.maxLength)
      notes.push(`${ref}（${field.label}）を maxlength ${field.maxLength} に合わせました`)
    }

    // select / radio は実在する選択肢に限る
    if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
      const matched =
        field.options.find((o) => o.label === value || o.value === value) ??
        field.options.find((o) => o.label.includes(value) || value.includes(o.label))

      if (!matched) {
        notes.push(
          `${ref}（${field.label}）の "${value}" は選択肢にないため破棄しました`
        )
        continue
      }
      if (matched.label !== value && matched.value !== value) {
        notes.push(`${ref}（${field.label}）を "${value}" -> "${matched.label}" に補正しました`)
      }
      values[ref] = matched.label || matched.value
      continue
    }

    if (value === '') {
      notes.push(`${ref}（${field.label}）が空のため破棄しました`)
      continue
    }

    values[ref] = value
  }

  // submit も実在するボタンでなければ捨てる
  let submit: string | undefined
  if (raw.submit) {
    const button = byRef.get(raw.submit)
    if (button && button.type === 'button') {
      submit = raw.submit
    } else {
      notes.push(`submit に指定された ${raw.submit} はボタンではないため無視しました`)
    }
  }

  // 必須項目の埋め忘れを知らせる
  for (const field of fields) {
    if (!field.required || field.isHoneypot || field.type === 'button') continue
    if (values[field.ref] === undefined) {
      notes.push(`必須項目「${field.label}」が生成されていません`)
    }
  }

  return { values, submit, notes }
}

/**
 * 文字列中から、括弧の対応が取れた JSON オブジェクトを全て拾う。
 *
 * CLI 系のプロバイダは本文の前後にログや進捗を出すため、
 * 「最初の { から最後の } まで」では別物を掴んでしまう。
 */
function balancedObjects(text: string): string[] {
  const found: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          found.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }
  return found
}

function looksLikeAnswer(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'values' in value
}

/**
 * モデルの返答からJSON部分を取り出す。
 * ```json フェンス・前置き・CLIのログ出力に耐える。
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = []

  // コードフェンスの中を最優先
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    if (m[1]) candidates.push(m[1])
  }
  candidates.push(text)
  // 括弧の対応が取れた塊。後ろにあるものほど最終回答である可能性が高い
  candidates.push(...balancedObjects(text).reverse())

  let fallback: unknown
  for (const candidate of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate.trim())
    } catch {
      continue
    }
    // values を持つものが本命。ログ中の別のJSONを拾わないための判定
    if (looksLikeAnswer(parsed)) return parsed
    if (fallback === undefined) fallback = parsed
  }

  if (fallback !== undefined) return fallback

  throw new Error(`AIの返答をJSONとして読めませんでした: ${text.trim().slice(0, 200)}`)
}

/** 生テキスト → 検証済みの値。全プロバイダ共通の出口。 */
export function parseResponse(
  text: string,
  fields: Field[],
  providerId: string
): GeneratedValues {
  const json = extractJson(text)
  const parsed = aiResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new Error(
      `AIの返答がスキーマに合いません: ${parsed.error.issues.map((i) => i.message).join(', ')}`
    )
  }

  const { values, submit, notes } = sanitizeValues(parsed.data, fields)
  return { values, submit, providerId, notes }
}
