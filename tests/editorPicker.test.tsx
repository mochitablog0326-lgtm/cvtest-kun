import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenarioEditor } from '../src/renderer/src/views/ScenarioEditor'
import type { Scenario } from '../src/types/scenario'
import type { PickedElement } from '../src/types/picker'
import { installDomStubs } from './setup-dom'

installDomStubs()

/** ピッカーの通知先。main プロセスの代わりにテストから発火させる */
let pickerListener: ((picked: PickedElement) => void) | undefined

function mockApi(): void {
  const noop = (): Promise<unknown> => Promise.resolve(undefined)
  ;(window as unknown as { api: unknown }).api = {
    config: { load: () => Promise.resolve({ scenarioDir: '/tmp' }), save: noop },
    scenario: { list: noop, load: noop, save: () => Promise.resolve('/tmp/x.json'), delete: noop, chooseDir: noop },
    browser: {
      open: () => Promise.resolve('https://example.com/reserve'),
      close: noop,
      screenshot: noop,
      setBounds: noop,
      setVisible: noop,
      back: noop,
      forward: noop,
      reload: noop,
      startPicker: noop,
      stopPicker: noop,
      learnRule: () => Promise.resolve({})
    },
    extract: { fields: () => Promise.resolve({ url: '', title: '', fields: [] }) },
    ai: { listProviders: () => Promise.resolve([]), generate: noop, toSteps: noop },
    presets: { list: () => Promise.resolve([]), detect: () => Promise.resolve(undefined) },
    run: { start: noop, abort: noop, list: noop, load: noop, reveal: noop, openTrace: noop },
    secrets: { set: noop, has: noop, keys: noop, delete: noop, available: noop },
    events: {
      onPickerSelected: (fn: (p: PickedElement) => void) => {
        pickerListener = fn
        return () => {
          pickerListener = undefined
        }
      },
      onBrowserNav: () => () => {},
      onPickerState: () => () => {},
      onRunStep: () => () => {},
      onRunLog: () => () => {},
      onRunFinished: () => () => {}
    }
  }
}

const scenario: Scenario = {
  version: 1,
  name: '予約フォーム',
  url: 'https://example.com/reserve',
  steps: [
    { id: 'a', type: 'fill', label: 'セイ', selector: '#old-sei', value: '【テスト】ヤマダ' },
    { id: 'b', type: 'check', label: '同意', selector: '#old-agree', checked: true }
  ],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

function picked(selector: string): PickedElement {
  return {
    selector,
    label: '新しい要素',
    tagName: 'input',
    inputType: 'text',
    classes: [],
    attrs: {},
    text: '',
    hasChildLink: false,
    looksLikeCalendarCell: false
  }
}

let container: HTMLDivElement
let root: Root
let current: Scenario

/**
 * 実際の App と同じく、親側が state でシナリオを保持する構造にする。
 * onChange から再描画を呼び直すと act が入れ子になって壊れる。
 */
function Harness({ initial }: { initial: Scenario }): JSX.Element {
  const [value, setValue] = useState(initial)
  current = value
  return (
    <ScenarioEditor
      scenario={value}
      onChange={setValue}
      onSaved={() => {}}
      onFinished={() => {}}
    />
  )
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<Harness initial={current} />)
  })
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text
  ) as HTMLButtonElement | undefined
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(async () => {
  mockApi()
  current = { ...scenario, steps: scenario.steps.map((s) => ({ ...s })) }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await render()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  pickerListener = undefined
  vi.restoreAllMocks()
})

describe('編集画面のピッカー', () => {
  it('ピッカーを開くとURL欄が出て、開くとモード切替が出る', async () => {
    expect(findButton('ピッカーで編集')).toBeDefined()
    await click(findButton('ピッカーで編集')!)
    // 開く前はURL欄だけ
    expect(findButton('開く')).toBeDefined()
    expect(container.textContent).not.toContain('操作モード')

    await click(findButton('開く')!)
    expect(container.textContent).toContain('操作モード')
    expect(container.textContent).toContain('選択モード')
  })

  it('取り直しを選んでから選択すると、そのステップのセレクタが差し替わる', async () => {
    await click(findButton('ピッカーで編集')!)

    // 1件目の「取直」を押す
    const repick = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === '取直'
    )
    expect(repick.length).toBe(2)
    await click(repick[0]!)

    expect(container.textContent).toContain('取り直します')

    // ピッカーで別の要素を選ぶ
    expect(pickerListener).toBeDefined()
    await act(async () => {
      pickerListener!(picked('#new-sei'))
    })

    // ステップは増えず、対象のセレクタだけ入れ替わる
    expect(current.steps).toHaveLength(2)
    expect(current.steps[0]).toMatchObject({
      id: 'a',
      type: 'fill',
      label: 'セイ',
      selector: '#new-sei',
      // 種類・ラベル・値は保たれる
      value: '【テスト】ヤマダ'
    })
    expect(current.steps[1]).toMatchObject({ id: 'b', selector: '#old-agree' })
  })

  it('取り直し後は追加モードに戻る', async () => {
    await click(findButton('ピッカーで編集')!)
    const repick = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === '取直'
    )
    await click(repick[0]!)

    await act(async () => pickerListener!(picked('#new-sei')))
    expect(current.steps).toHaveLength(2)

    // 続けて選ぶと今度は追加される
    await act(async () => pickerListener!(picked('#another')))
    expect(current.steps).toHaveLength(3)
    expect(current.steps[2]).toMatchObject({ selector: '#another' })
  })

  it('取り直しを指定していなければ末尾に追加する', async () => {
    await click(findButton('ピッカーで編集')!)
    await act(async () => pickerListener!(picked('#added')))

    expect(current.steps).toHaveLength(3)
    expect(current.steps[0]).toMatchObject({ selector: '#old-sei' })
    expect(current.steps[2]).toMatchObject({ selector: '#added' })
  })

  it('ステップを並べ替えられる', async () => {
    const down = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === '↓'
    )
    await click(down[0]!)
    expect(current.steps.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('ステップを削除できる', async () => {
    const remove = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === '✕'
    )
    await click(remove[0]!)
    expect(current.steps.map((s) => s.id)).toEqual(['b'])
  })
})
