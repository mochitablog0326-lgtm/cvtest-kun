/** 埋め込みブラウザの表示領域（renderer のプレースホルダ座標）。 */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** 埋め込みブラウザの遷移状態。ツールバーの表示に使う。 */
export interface NavState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}
