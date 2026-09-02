import type { ClickStep } from '../../types/scenario'
import { locate } from '../browser'
import { waitForTarget } from './target'
import type { StepContext, StepDetail } from './context'

/**
 * クリックする。送信ボタンを踏むとページ遷移するので、
 * 遷移が起きた場合は落ち着くまで待ってから次のステップへ渡す。
 */
export async function click(step: ClickStep, ctx: StepContext): Promise<StepDetail> {
  const locator = locate(ctx.page, step.selector, step.frame).first()
  const urlBefore = ctx.page.url()

  await waitForTarget(locator, 'visible', ctx, step, step.selector)
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await locator.click({ timeout: ctx.timeoutMs })

  // 遷移するかどうかは踏んでみるまで分からないので、待てたら待つ程度に留める
  await ctx.page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
  await ctx.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

  if (step.waitAfter) {
    await ctx.page.waitForTimeout(step.waitAfter)
  }

  const urlAfter = ctx.page.url()
  if (urlAfter !== urlBefore) {
    ctx.log(`  ページ遷移: ${urlAfter}`)
    // 遷移のたびに Cookie を残す。ページ間の引き継ぎ確認に使う（設計 §10）
    await ctx.tracking.snapshotCookies(ctx.page)
  }

  return { urlBefore, urlAfter, navigated: urlAfter !== urlBefore }
}
