import { describe, it, expect } from 'vitest'
import { applyPick, hasSelector, moveStep, removeStep, setStepValue } from '../src/renderer/src/lib/steps'
import type { Step } from '../src/types/scenario'
import type { PickedElement } from '../src/types/picker'

const steps: Step[] = [
  { id: 'a', type: 'fill', label: 'セイ', selector: '#a', value: 'x' },
  { id: 'b', type: 'check', label: '同意', selector: '#b', checked: true },
  {
    id: 'c',
    type: 'pickSlot',
    label: '空き枠',
    grid: '#cal',
    cell: 'td',
    available: {},
    strategy: 'first'
  }
]

const picked = (selector: string): PickedElement => ({
  selector,
  label: '',
  tagName: 'input',
  classes: [],
  attrs: {},
  text: '',
  hasChildLink: false,
  looksLikeCalendarCell: false
})

const newStep: Step = { id: 'z', type: 'fill', label: '新規', selector: '#z', value: '' }

describe('applyPick', () => {
  it('取り直し指定が無ければ末尾に追加する', () => {
    const out = applyPick(steps, newStep, picked('#z'))
    expect(out).toHaveLength(4)
    expect(out[3]?.id).toBe('z')
  })

  it('取り直し指定があればセレクタだけ差し替える', () => {
    const out = applyPick(steps, newStep, picked('#new'), 'a')
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({
      id: 'a',
      type: 'fill',
      label: 'セイ',
      value: 'x',
      selector: '#new'
    })
  })

  it('対象以外は変えない', () => {
    const out = applyPick(steps, newStep, picked('#new'), 'a')
    expect(out[1]).toBe(steps[1])
    expect(out[2]).toBe(steps[2])
  })

  it('セレクタを持たないステップは差し替えない', () => {
    // pickSlot は grid/cell で指すので取り直しの対象外
    const out = applyPick(steps, newStep, picked('#new'), 'c')
    expect(out[2]).toBe(steps[2])
    expect(out).toHaveLength(3)
  })

  it('存在しないIDなら何も変わらない', () => {
    expect(applyPick(steps, newStep, picked('#new'), 'nope')).toEqual(steps)
  })
})

describe('hasSelector', () => {
  it('種類ごとに判定する', () => {
    expect(hasSelector(steps[0]!)).toBe(true)
    expect(hasSelector(steps[2]!)).toBe(false)
  })
})

describe('moveStep', () => {
  it('上下に動かせる', () => {
    expect(moveStep(steps, 'b', -1).map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(moveStep(steps, 'b', 1).map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('端では何もしない', () => {
    expect(moveStep(steps, 'a', -1)).toBe(steps)
    expect(moveStep(steps, 'c', 1)).toBe(steps)
  })

  it('存在しないIDでは何もしない', () => {
    expect(moveStep(steps, 'nope', 1)).toBe(steps)
  })
})

describe('removeStep / setStepValue', () => {
  it('削除できる', () => {
    expect(removeStep(steps, 'b').map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('値を持つステップだけ書き換える', () => {
    const out = setStepValue(steps, 'a', '新しい値')
    expect(out[0]).toMatchObject({ value: '新しい値' })
    // check ステップには value が無いので触らない
    expect(setStepValue(steps, 'b', 'x')[1]).toBe(steps[1])
  })
})
