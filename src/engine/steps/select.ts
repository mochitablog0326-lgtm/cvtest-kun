import type { SelectStep } from '../../types/scenario'
import { locate } from '../browser'
import type { StepContext, StepDetail } from './context'

/**
 * プルダウンを選ぶ。
 *
 * シナリオの `value` は option の value でもラベルでもよい（設計 §4.1）。
 * AIやピッカーはラベルで書くことが多いので、value 一致 -> ラベル一致 の順に試す。
 */
export async function select(step: SelectStep, ctx: StepContext): Promise<StepDetail> {
  const wanted = ctx.expand(step.value)
  const locator = locate(ctx.page, step.selector, step.frame).first()

  await locator.waitFor({ state: 'visible', timeout: ctx.timeoutMs })

  try {
    await locator.selectOption({ value: wanted }, { timeout: 3_000 })
    return { matchedBy: 'value', value: wanted }
  } catch {
    // value で一致しなければラベルで試す
  }

  try {
    await locator.selectOption({ label: wanted }, { timeout: 3_000 })
    return { matchedBy: 'label', value: wanted }
  } catch {
    // 完全一致で駄目なら部分一致にフォールバックする。
    // 「導入相談」に対し実際の option が「導入のご相談」のようなケース向け。
  }

  const options = await locator.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => ({
      label: (o.textContent ?? '').trim(),
      value: o.value
    }))
  )

  const partial = options.find(
    (o) => o.label.includes(wanted) || (wanted.length >= 2 && wanted.includes(o.label) && o.value)
  )

  if (!partial) {
    throw new Error(
      `選択肢が見つかりません: "${wanted}"。候補: ${options.map((o) => o.label).join(' / ')}`
    )
  }

  await locator.selectOption({ value: partial.value })
  ctx.log(`  部分一致で選択しました: "${wanted}" -> "${partial.label}"`)
  return { matchedBy: 'partial', value: partial.value, label: partial.label }
}
