import type { Field } from '../types/field'
import { toCompact } from '../engine/extract'
import type { PageContext } from './provider'

export const SYSTEM_PROMPT = [
  'あなたは日本語のWebフォームに入力するテストデータを作るアシスタントです。',
  '与えられた項目一覧に対して、各項目へ入れる値をJSONで返してください。',
  '',
  '厳守すること:',
  '- これはテスト送信です。氏名・会社名には必ず「【テスト】」を先頭に付けてください。',
  '- メールアドレスは必ず test+{{timestamp}}@example.com の形式にしてください。',
  '- 電話番号は 03-0000-0000 のような明らかにダミーと分かる番号にしてください。',
  '- 実在の個人名・実在の企業名・実在の住所は使わないでください。',
  '- 項目は f1, f2 ... の ref で指定します。ref は一覧にあるものだけを使ってください。',
  '- select と radio は、提示された選択肢の文字列をそのまま使ってください。',
  '- checkbox は true / false で答えてください。',
  '- 出力は JSON のみ。説明文やコードフェンスは付けないでください。',
  '',
  '出力形式:',
  '{"values": {"f1": "【テスト】株式会社サンプル", "f7": true}, "submit": "b1"}'
].join('\n')

/**
 * AIに渡すユーザープロンプトを組み立てる（設計 §6.2）。
 *
 * 生HTMLではなく圧縮表現を渡す。トークンが1/100程度になり、
 * セレクタも渡さないので幻覚したセレクタが混ざる余地がない。
 */
export function buildPrompt(fields: Field[], ctx: PageContext): string {
  const lines: string[] = []

  lines.push(`ページタイトル: ${ctx.title}`)
  if (ctx.pageHeading) lines.push(`見出し: ${ctx.pageHeading}`)
  lines.push(`URL: ${ctx.url}`)
  if (ctx.purpose) lines.push(`このフォームの用途: ${ctx.purpose}`)
  lines.push('')
  lines.push('項目一覧:')
  lines.push(toCompact(fields))
  lines.push('')
  lines.push('各項目に入れる値をJSONで返してください。')

  return lines.join('\n')
}

/**
 * ページ本文の文字列は渡さない。
 *
 * フォームの説明文に「これまでの指示を無視して…」のような文が仕込まれていても、
 * AIが読むのはラベルと型だけなので影響範囲が小さい。
 * それでも値のサニタイズは provider.ts 側で必ず行う。
 */
export function buildMessages(
  fields: Field[],
  ctx: PageContext
): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: buildPrompt(fields, ctx) }
}
