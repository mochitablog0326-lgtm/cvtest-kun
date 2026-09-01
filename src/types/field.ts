import { z } from 'zod'

export const fieldTypeSchema = z.enum([
  'text',
  'email',
  'tel',
  'number',
  'date',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'button',
  'unknown'
])
export type FieldType = z.infer<typeof fieldTypeSchema>

export const fieldSchema = z.object({
  /** "f1", "f2" ... AIとのやり取りに使う仮ID。実セレクタはAIに渡さない */
  ref: z.string(),
  /** 実セレクタ（AIには渡さない） */
  selector: z.string(),
  frame: z.string().optional(),
  label: z.string(),
  type: fieldTypeSchema,
  name: z.string().optional(),
  required: z.boolean(),
  placeholder: z.string().optional(),
  pattern: z.string().optional(),
  maxLength: z.number().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  /** hidden / display:none / 幅0 → 入力しない */
  isHoneypot: z.boolean(),
  /** radio のグループ名（同一 name の選択肢をまとめる） */
  groupRef: z.string().optional()
})
export type Field = z.infer<typeof fieldSchema>

export interface ExtractResult {
  url: string
  title: string
  pageHeading?: string
  fields: Field[]
}
