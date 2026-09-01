import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import dayjs from 'dayjs'
import { run } from '../src/engine/runner'
import { isAvailableFromInfo, dateOfCell } from '../src/engine/steps/pickSlot'
import type { Scenario, PickSlotStep } from '../src/types/scenario'
import { startServer, type TestServer } from './helpers/server'

let server: TestServer
let runsDir: string

beforeAll(async () => {
  server = await startServer()
  runsDir = await mkdtemp(join(tmpdir(), 'cvtest-slot-'))
}, 30_000)

afterAll(async () => {
  await server?.close()
})

/** ○△ を空き、× を満席とみなすルール。ピッカーの学習フローが生成する形。 */
const AVAILABLE = {
  notClass: ['full'],
  notAttr: ['aria-disabled'],
  textNotIn: ['×', '満']
}

function calendarScenario(step: Omit<PickSlotStep, 'id' | 'type'>): Scenario {
  return {
    version: 1,
    name: '予約',
    url: `${server.origin}/calendar.html`,
    stepDelayMs: 0,
    steps: [{ id: 's1', type: 'pickSlot', label: '空き枠を選ぶ', ...step }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  }
}

describe('isAvailableFromInfo', () => {
  const info = (over: Partial<Parameters<typeof isAvailableFromInfo>[0]> = {}) => ({
    classes: ['day', 'available'],
    attrs: {} as Record<string, string>,
    text: '15 ○',
    hasChildMatch: true,
    dateAttrs: [],
    ariaLabel: '',
    disabled: false,
    ...over
  })

  it('textNotIn で満席を弾く', () => {
    expect(isAvailableFromInfo(info(), { textNotIn: ['×'] })).toBe(true)
    expect(isAvailableFromInfo(info({ text: '15 ×' }), { textNotIn: ['×'] })).toBe(false)
  })

  it('textIn で空き記号を絞る', () => {
    expect(isAvailableFromInfo(info(), { textIn: ['○', '△'] })).toBe(true)
    expect(isAvailableFromInfo(info({ text: '15 ×' }), { textIn: ['○', '△'] })).toBe(false)
  })

  it('hasClass / notClass', () => {
    expect(isAvailableFromInfo(info(), { hasClass: ['available'] })).toBe(true)
    expect(isAvailableFromInfo(info(), { hasClass: ['open'] })).toBe(false)
    expect(isAvailableFromInfo(info({ classes: ['day', 'full'] }), { notClass: ['full'] })).toBe(false)
  })

  it('notAttr は値が false のときは無効扱いしない', () => {
    expect(
      isAvailableFromInfo(info({ attrs: { 'aria-disabled': 'true' } }), { notAttr: ['aria-disabled'] })
    ).toBe(false)
    expect(
      isAvailableFromInfo(info({ attrs: { 'aria-disabled': 'false' } }), { notAttr: ['aria-disabled'] })
    ).toBe(true)
    expect(isAvailableFromInfo(info(), { notAttr: ['aria-disabled'] })).toBe(true)
  })

  it('hasChild でリンクの有無を見る', () => {
    expect(isAvailableFromInfo(info(), { hasChild: 'a' })).toBe(true)
    expect(isAvailableFromInfo(info({ hasChildMatch: false }), { hasChild: 'a' })).toBe(false)
  })

  it('ルールが空なら全て空き扱い', () => {
    expect(isAvailableFromInfo(info({ text: '15 ×' }), {})).toBe(true)
  })
})

describe('dateOfCell', () => {
  const base = {
    classes: [],
    attrs: {},
    hasChildMatch: false,
    ariaLabel: '',
    disabled: false
  }
  const ref = new Date('2026-09-01T05:00:00.000Z')

  it('data-date を最優先で使う', () => {
    expect(
      dateOfCell({ ...base, text: '15', dateAttrs: ['2026-10-15'] }, undefined, ref)
    ).toBe('2026-10-15')
  })

  it('UNIXタイムスタンプ属性を解釈する', () => {
    const secs = Math.floor(Date.UTC(2026, 9, 15, 3, 0, 0) / 1000)
    expect(dateOfCell({ ...base, text: '', dateAttrs: [String(secs)] }, undefined, ref)).toBe(
      '2026-10-15'
    )
  })

  it('aria-label の和暦・日本語表記を解釈する', () => {
    expect(
      dateOfCell(
        { ...base, text: '', dateAttrs: [], ariaLabel: '令和8年10月15日 空きあり' },
        undefined,
        ref
      )
    ).toBe('2026-10-15')
  })

  it('日番号と空き記号が混ざったテキストを表示年月で解決する', () => {
    expect(
      dateOfCell({ ...base, text: '15 ○', dateAttrs: [] }, { year: 2026, month: 10 }, ref)
    ).toBe('2026-10-15')
  })

  it('表示年月が分からなければ日番号だけでは解決しない', () => {
    expect(dateOfCell({ ...base, text: '15 ○', dateAttrs: [] }, undefined, ref)).toBeNull()
  })
})

describe('pickSlot（実ブラウザ）', () => {
  it('当月が満席なら翌月に進んで空き枠を選ぶ', async () => {
    const result = await run(
      calendarScenario({
        grid: '#calendar table.grid',
        cell: 'td.day',
        available: AVAILABLE,
        strategy: 'first',
        nextMonth: '#next',
        maxMonthNav: 3
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('success')
    // 何を予約したかは必ず記録される（設計 §11.2）
    expect(result.pickedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const detail = result.steps[0]?.detail as { monthsNavigated: number }
    expect(detail.monthsNavigated).toBe(1) // 当月は全て×なので1回進む

    // 選んだ日は翌月の1日目の空き枠（1日は ○）
    const expected = dayjs().add(1, 'month').startOf('month').format('YYYY-MM-DD')
    expect(result.pickedDate).toBe(expected)
  }, 90_000)

  it('実際にセルがクリックされている', async () => {
    const result = await run(
      calendarScenario({
        grid: '#calendar table.grid',
        cell: 'td.day',
        available: AVAILABLE,
        strategy: 'first',
        nextMonth: '#next'
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )
    expect(result.status).toBe('success')
    expect(result.steps[0]?.status).toBe('ok')
  }, 90_000)

  it('minDaysAhead で直近の枠を避ける（設計 §11）', async () => {
    const minDaysAhead = 40
    const result = await run(
      calendarScenario({
        grid: '#calendar table.grid',
        cell: 'td.day',
        available: AVAILABLE,
        range: { minDaysAhead },
        strategy: 'first',
        nextMonth: '#next',
        maxMonthNav: 3
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('success')
    const daysAhead = dayjs(result.pickedDate).diff(dayjs().startOf('day'), 'day')
    expect(daysAhead).toBeGreaterThanOrEqual(minDaysAhead)
  }, 90_000)

  it('last / random でも範囲内の枠を選ぶ', async () => {
    for (const strategy of ['last', 'random'] as const) {
      const result = await run(
        calendarScenario({
          grid: '#calendar table.grid',
          cell: 'td.day',
          available: AVAILABLE,
          range: { minDaysAhead: 1, maxDaysAhead: 70 },
          strategy,
          nextMonth: '#next',
          maxMonthNav: 3
        }),
        { runsDir, launch: { headless: true }, trace: false }
      )
      expect(result.status, strategy).toBe('success')
      const daysAhead = dayjs(result.pickedDate).diff(dayjs().startOf('day'), 'day')
      expect(daysAhead, strategy).toBeGreaterThanOrEqual(1)
      expect(daysAhead, strategy).toBeLessThanOrEqual(70)
    }
  }, 120_000)

  it('data-date が無くても表示年月から日付を解決する', async () => {
    const result = await run(
      calendarScenario({
        grid: '#calendar-text table.grid',
        cell: 'td.day',
        available: AVAILABLE,
        strategy: 'first'
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    // 当月は全て満席なので、翌月ボタン無しでは見つからない
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/空き枠が見つかりませんでした/)
    // セルの日付自体は解決できていること（エラーに日付が並ぶ）
    expect(result.error).toMatch(/\d{4}-\d{2}-\d{2}:×/)
  }, 90_000)

  it('見つからない場合は何セル見たかを添えて失敗する', async () => {
    const result = await run(
      calendarScenario({
        grid: '#calendar table.grid',
        cell: 'td.day',
        available: AVAILABLE,
        strategy: 'first',
        maxMonthNav: 0
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/条件に合う空き枠が見つかりませんでした/)
    expect(result.error).toMatch(/セルを確認/)
    // 予約していないので後始末に予約枠は載らない
    expect(result.cleanup.some((c) => c.source === 'reservation')).toBe(false)
  }, 90_000)

  it('予約した枠が後始末チェックリストに載る（設計 §11.2）', async () => {
    const result = await run(
      calendarScenario({
        grid: '#calendar table.grid',
        cell: 'td.day',
        available: AVAILABLE,
        strategy: 'first',
        nextMonth: '#next'
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('success')
    const item = result.cleanup.find((c) => c.source === 'reservation')
    expect(item?.text).toContain(result.pickedDate!)
    expect(item?.text).toContain('キャンセル')
  }, 90_000)
})
