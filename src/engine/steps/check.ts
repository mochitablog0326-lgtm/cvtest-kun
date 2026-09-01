import type { CheckStep } from '../../types/scenario'
import { locate } from '../browser'
import type { StepContext, StepDetail } from './context'

/**
 * チェックボックス・ラジオを操作する。
 *
 * 同意チェックはカスタムUIで実体の input が隠されていることが多い
 * （見た目は span、実 input は opacity:0）。その場合 check() は
 * 「見えない」と言って失敗するので、ラベル経由のクリックに切り替える。
 */
export async function check(step: CheckStep, ctx: StepContext): Promise<StepDetail> {
  const locator = locate(ctx.page, step.selector, step.frame).first()
  await locator.waitFor({ state: 'attached', timeout: ctx.timeoutMs })

  const already = await locator.isChecked().catch(() => undefined)
  if (already === step.checked) {
    return { checked: step.checked, changed: false }
  }

  try {
    if (step.checked) {
      await locator.check({ timeout: 5_000 })
    } else {
      await locator.uncheck({ timeout: 5_000 })
    }
    return { checked: step.checked, changed: true, via: 'check' }
  } catch {
    // 実 input が隠れているカスタムUI向けのフォールバック
  }

  const clicked = await clickAssociatedLabel(step, ctx)
  const actual = await locator.isChecked().catch(() => undefined)

  if (actual !== step.checked) {
    // 最後の手段: JS で直接状態を変えてイベントを発火させる
    await locator.evaluate((el, checked) => {
      const input = el as HTMLInputElement
      input.checked = checked as boolean
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, step.checked)
    return { checked: step.checked, changed: true, via: 'dispatchEvent' }
  }

  return { checked: step.checked, changed: true, via: clicked ? 'label' : 'check' }
}

/** input に紐づくラベル（label[for] か祖先 label）をクリックする。 */
async function clickAssociatedLabel(step: CheckStep, ctx: StepContext): Promise<boolean> {
  const locator = locate(ctx.page, step.selector, step.frame).first()
  const handle = await locator.elementHandle()
  if (!handle) return false

  try {
    const labelHandle = await handle.evaluateHandle((el) => {
      const input = el as HTMLInputElement
      if (input.id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
        if (forLabel) return forLabel
      }
      return input.closest('label')
    })

    const element = labelHandle.asElement()
    if (!element) return false

    await element.click({ timeout: 5_000 })
    return true
  } catch {
    return false
  } finally {
    await handle.dispose()
  }
}
