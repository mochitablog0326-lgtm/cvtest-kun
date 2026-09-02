import type { Scenario, Step } from '../../../types/scenario'
import type { PickedElement } from '../../../types/picker'

/** セレクタを持つステップか。pickSlot は grid/cell なので取り直しの対象外。 */
export function hasSelector(step: Step): boolean {
  return 'selector' in step
}

/**
 * ピッカーで選ばれた要素をステップ一覧へ反映する。
 *
 * `repickId` が指定されていれば、そのステップの**セレクタだけ**を差し替える。
 * 種類とラベルは人が付けた情報なので保つ。
 * 指定が無ければ末尾に追加する。
 */
export function applyPick(
  steps: Step[],
  step: Step,
  picked: PickedElement,
  repickId?: string
): Step[] {
  if (!repickId) return [...steps, step]

  return steps.map((s) =>
    s.id === repickId && hasSelector(s) ? ({ ...s, selector: picked.selector } as Step) : s
  )
}

/** ステップを1つ上下に動かす。端では何もしない。 */
export function moveStep(steps: Step[], id: string, direction: -1 | 1): Step[] {
  const index = steps.findIndex((s) => s.id === id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= steps.length) return steps

  const out = [...steps]
  const [moved] = out.splice(index, 1)
  out.splice(next, 0, moved!)
  return out
}

export function removeStep(steps: Step[], id: string): Step[] {
  return steps.filter((s) => s.id !== id)
}

/** 値を編集する（value を持つステップのみ）。 */
export function setStepValue(steps: Step[], id: string, value: string): Step[] {
  return steps.map((s) => (s.id === id && 'value' in s ? ({ ...s, value } as Step) : s))
}

/** 取り直しでシナリオを更新する。 */
export function applyPickToScenario(
  scenario: Scenario,
  step: Step,
  picked: PickedElement,
  repickId?: string
): Scenario {
  return { ...scenario, steps: applyPick(scenario.steps, step, picked, repickId) }
}
