/** ピッカーがクリックを検出したときに返す情報（設計 §7）。 */
export interface PickedElement {
  selector: string
  label: string
  tagName: string
  /** input の type 属性 */
  inputType?: string
  classes: string[]
  attrs: Record<string, string>
  text: string
  /** a / button を子に持つか（空き枠がリンクになっているカレンダー向け） */
  hasChildLink: boolean
  /** カレンダーセルらしさ。ピッカーUIで日付ダイアログを出すか決める */
  looksLikeCalendarCell: boolean
  frame?: string
}
