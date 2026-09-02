import type { PickDateStep } from '../../types/scenario'
import { locate } from '../browser'
import { waitForTarget } from './target'
import type { StepContext, StepDetail } from './context'

/**
 * 日付を固定・相対指定でクリックする（設計 §4.2）。
 *
 * セレクタ自体がテンプレートを含む: `[data-date='{{today+7|YYYY-MM-DD}}']`
 * pickSlot と違い「空いているか」は見ない。狙った日が埋まっていれば失敗する。
 */
export async function pickDate(step: PickDateStep, ctx: StepContext): Promise<StepDetail> {
  const selector = ctx.expand(step.selector)
  const locator = locate(ctx.page, selector, step.frame).first()

  await waitForTarget(locator, 'visible', ctx, step, selector)
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await locator.click({ timeout: ctx.timeoutMs })

  // 日付が特定できるなら後始末チェックリストに載せる（設計 §11.2）
  const pickedDate = await locator
    .evaluate(
      (el) =>
        (el as HTMLElement).getAttribute('data-date') ??
        (el as HTMLElement).getAttribute('datetime') ??
        null
    )
    .catch(() => null)

  ctx.log(`  日付を選択: ${pickedDate ?? selector}`)
  return { selector, pickedDate: pickedDate ?? undefined }
}
