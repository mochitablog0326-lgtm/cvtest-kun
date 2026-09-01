import type { FillStep } from '../../types/scenario'
import { locate } from '../browser'
import type { StepContext, StepDetail } from './context'

/**
 * 入力欄を埋める。
 *
 * `fill()` は React の制御コンポーネントにも効く（Playwright が
 * ネイティブ setter を叩いて input/change を発火させる）ので、
 * webview を直接触る場合のような小細工は要らない。
 */
export async function fill(step: FillStep, ctx: StepContext): Promise<StepDetail> {
  const value = ctx.expand(step.value)
  const locator = locate(ctx.page, step.selector, step.frame).first()

  await locator.waitFor({ state: 'visible', timeout: ctx.timeoutMs })
  await locator.fill(value)

  // 入力後の値を読み戻して確認する。maxlength で切られたり、
  // 電話番号のマスク入力で化けたりするのを取りこぼさないため。
  const actual = await locator.inputValue().catch(() => undefined)
  if (actual !== undefined && actual !== value) {
    ctx.log(`  入力値が変換されました: "${value}" -> "${actual}"`)
  }

  return { value, actual }
}
