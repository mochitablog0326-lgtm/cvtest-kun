import type { AssertStep, AssertTrackingStep, WaitStep } from '../../types/scenario'
import { locate } from '../browser'
import type { StepContext, StepDetail } from './context'

/** 到達確認。送信できたつもりでエラー画面に戻っていた、を防ぐ。 */
export async function assertStep(step: AssertStep, ctx: StepContext): Promise<StepDetail> {
  const expected = step.value !== undefined ? ctx.expand(step.value) : undefined

  if (step.mode === 'url') {
    if (expected === undefined) throw new Error('assert(url) には value が必要です')
    await ctx.page
      .waitForURL((url) => url.href.includes(expected), { timeout: ctx.timeoutMs })
      .catch(() => {})
    const actual = ctx.page.url()
    if (!actual.includes(expected)) {
      throw new Error(`URL が期待と違います。期待: "${expected}" 実際: "${actual}"`)
    }
    return { mode: 'url', expected, actual }
  }

  const locator = locate(ctx.page, step.selector, step.frame).first()

  if (step.mode === 'visible') {
    await locator.waitFor({ state: 'visible', timeout: ctx.timeoutMs })
    return { mode: 'visible', selector: step.selector }
  }

  // mode === 'text'
  if (expected === undefined) throw new Error('assert(text) には value が必要です')
  await locator.waitFor({ state: 'visible', timeout: ctx.timeoutMs })
  const actual = ((await locator.textContent()) ?? '').replace(/[\s　]+/g, ' ').trim()
  if (!actual.includes(expected)) {
    throw new Error(`テキストが一致しません。期待: "${expected}" 実際: "${actual}"`)
  }
  return { mode: 'text', expected, actual }
}

/**
 * 計測タグの発火を検証する（設計 §10）。
 *
 * expectedCount を指定すると発火回数まで見る。GTMのトリガー設定ミスで
 * ページ内の全ボタンで発火しCV数が水増しされる事故は、ここで検出できる。
 */
export async function assertTracking(
  step: AssertTrackingStep,
  ctx: StepContext
): Promise<StepDetail> {
  const timeout = step.timeoutMs ?? 10_000
  const fired = await ctx.tracking.waitFor(step.provider, step.eventName, timeout)
  const actualCount = ctx.tracking.countOf(step.provider, step.eventName)
  const target = step.eventName ? `${step.provider} / ${step.eventName}` : step.provider

  if (!fired) {
    throw new Error(
      `計測タグが発火していません: ${target}（${timeout}ms 待機）。` +
        'フォームは送信できていてもCVが計測されていない可能性があります。'
    )
  }

  if (step.expectedCount !== undefined && actualCount !== step.expectedCount) {
    throw new Error(
      `計測タグの発火回数が想定と違います: ${target} 期待 ${step.expectedCount} 回 / 実際 ${actualCount} 回。` +
        (actualCount > step.expectedCount
          ? 'トリガー条件が広すぎてCV数が水増しされている可能性があります。'
          : '')
    )
  }

  ctx.log(`  計測タグ発火を確認: ${target} (${actualCount} 回)`)
  return { provider: step.provider, eventName: step.eventName, count: actualCount }
}

/** 待機。ms でも要素出現でもよい。 */
export async function wait(step: WaitStep, ctx: StepContext): Promise<StepDetail> {
  if (step.selector) {
    const locator = locate(ctx.page, step.selector, step.frame).first()
    await locator.waitFor({ state: 'visible', timeout: step.ms ?? ctx.timeoutMs })
    return { waitedFor: step.selector }
  }
  const ms = step.ms ?? 1_000
  await ctx.page.waitForTimeout(ms)
  return { waitedMs: ms }
}
