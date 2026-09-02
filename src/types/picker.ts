import { z } from 'zod'

/**
 * ピッカーがクリックを検出したときに返す情報（設計 §7）。
 *
 * 埋め込みブラウザでは、この値が「対象ページ（＝第三者のサイト）」から
 * IPC 経由で main に届く。信用できない入力なのでスキーマ検証を必ず通す。
 */
export const pickedElementSchema = z.object({
  selector: z.string().min(1).max(2000),
  label: z.string().max(500),
  tagName: z.string().max(50),
  /** input の type 属性 */
  inputType: z.string().max(50).optional(),
  classes: z.array(z.string().max(200)).max(100),
  attrs: z.record(z.string().max(4000)),
  text: z.string().max(2000),
  /** a / button を子に持つか（空き枠がリンクになっているカレンダー向け） */
  hasChildLink: z.boolean(),
  /** カレンダーセルらしさ。ピッカーUIで日付ダイアログを出すか決める */
  looksLikeCalendarCell: z.boolean(),
  /** 時間枠らしさ。時刻の扱いを聞くダイアログを出すか決める */
  looksLikeTimeSlot: z.boolean().optional(),
  frame: z.string().max(2000).optional()
})

export type PickedElement = z.infer<typeof pickedElementSchema>
