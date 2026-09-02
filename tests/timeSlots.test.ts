import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Session } from '../src/engine/browser'
import { startPicker, stopPicker, type PickedElement } from '../src/engine/picker'
import { guessCell, guessGrid } from '../src/renderer/src/components/PickerPane'
import { run } from '../src/engine/runner'
import type { Scenario, PickSlotStep } from '../src/types/scenario'
import { startServer, type TestServer } from './helpers/server'

/**
 * 時間帯の一覧（<tr data-time="10:00"> が1枠）への対応。
 * 日付カレンダーと同じ学習フローで扱えることを確認する。
 */
let server: TestServer
let runsDir: string

beforeAll(async () => {
  server = await startServer()
  runsDir = await mkdtemp(join(tmpdir(), 'cvtest-time-'))
}, 30_000)

afterAll(async () => {
  await server?.close()
})

/** ○ を空き、× を満席とみなすルール。ピッカーが学習する形 */
const AVAILABLE = { notClass: ['notFree'], textNotIn: ['×'] }

/** 日付を選ぶステップ。時間表は日付を選ぶまで表示されない */
const pickDateStep: Scenario['steps'][number] = {
  id: 'd0',
  type: 'pickSlot',
  label: '日付を選ぶ',
  grid: '#calendar-date',
  cell: 'td.day',
  available: { notClass: ['full'], notAttr: ['aria-disabled'], textNotIn: ['×'] },
  strategy: 'first'
}

function scenario(step: Omit<PickSlotStep, 'id' | 'type'>, extra: Scenario['steps'] = []): Scenario {
  return {
    version: 1,
    name: '時間帯の予約',
    url: `${server.origin}/time-slots.html`,
    stepDelayMs: 0,
    steps: [pickDateStep, { id: 's1', type: 'pickSlot', label: '時間を選ぶ', ...step }, ...extra],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  }
}

const timeStep: Omit<PickSlotStep, 'id' | 'type'> = {
  kind: 'time',
  grid: '#calendar-time',
  cell: 'tr[data-time]',
  available: AVAILABLE,
  strategy: 'first'
}

describe('時間帯の自動選択', () => {
  it('空いている時間を選び、選んだ時刻を記録する', async () => {
    const result = await run(scenario(timeStep), {
      runsDir,
      launch: { headless: true },
      trace: false
    })

    expect(result.status).toBe('success')
    // 何を予約したか分からないと片付けられない（設計 §11.2）
    expect(result.pickedTime).toBe('10:00')
  }, 90_000)

  it('実際にその行がクリックされている', async () => {
    const result = await run(
      scenario(timeStep, [
        { id: 's2', type: 'assert', selector: '#picked', mode: 'text', value: '10:00' }
      ]),
      { runsDir, launch: { headless: true }, trace: false }
    )
    expect(result.status).toBe('success')
  }, 90_000)

  it('満席の時間は選ばない', async () => {
    // 30分刻みは全て満席にしてあるので、選ばれるのは必ず 00 分
    for (const strategy of ['first', 'last', 'random'] as const) {
      const result = await run(scenario({ ...timeStep, strategy }), {
        runsDir,
        launch: { headless: true },
        trace: false
      })
      expect(result.status, strategy).toBe('success')
      expect(result.pickedTime, strategy).toMatch(/:00$/)
    }
  }, 180_000)

  it('timeRange で時間帯を絞れる', async () => {
    const result = await run(
      scenario({ ...timeStep, timeRange: { from: '14:00', to: '16:00' }, strategy: 'first' }),
      { runsDir, launch: { headless: true }, trace: false }
    )
    expect(result.status).toBe('success')
    expect(result.pickedTime).toBe('14:00')
  }, 90_000)

  it('last で範囲内の最後を選ぶ', async () => {
    const result = await run(
      scenario({ ...timeStep, timeRange: { from: '14:00', to: '16:00' }, strategy: 'last' }),
      { runsDir, launch: { headless: true }, trace: false }
    )
    expect(result.pickedTime).toBe('16:00')
  }, 90_000)

  it('範囲に空きが無ければ分かる形で失敗する', async () => {
    const result = await run(
      scenario({ ...timeStep, timeRange: { from: '10:30', to: '10:30' } }),
      { runsDir, launch: { headless: true }, trace: false }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/空き時間が見つかりませんでした/)
  }, 90_000)

  it('日付と時間を続けて選ぶと、後始末に両方が載る', async () => {
    const result = await run(scenario(timeStep), {
      runsDir,
      launch: { headless: true },
      trace: false
    })

    expect(result.status).toBe('success')
    expect(result.pickedDate).toBe('2026-10-05')
    expect(result.pickedTime).toBe('10:00')

    const item = result.cleanup.find((c) => c.source === 'reservation')
    expect(item?.text).toBe('予約枠 2026-10-05 10:00 をキャンセルする')

    const cleanup = await readFile(join(result.runDir, 'cleanup.md'), 'utf8')
    expect(cleanup).toContain('2026-10-05 10:00')
  }, 120_000)

  it('日付を選ぶ前に時間を選ぼうとしたら、理由が分かる形で失敗する', async () => {
    const result = await run(
      {
        version: 1,
        name: '順序ミス',
        url: `${server.origin}/time-slots.html`,
        stepDelayMs: 0,
        steps: [{ id: 's1', type: 'pickSlot', label: '時間を選ぶ', ...timeStep }],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      },
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 3_000 }
    )

    expect(result.status).toBe('failed')
    // 素のタイムアウトではなく、何をすべきか分かる文言にする
    expect(result.error).toContain('先に日付を選ぶステップが必要です')
    expect(result.error).not.toMatch(/TimeoutError/)
  }, 90_000)

  it('存在しないセレクタは「見つかりません」と伝える', async () => {
    const result = await run(
      scenario({ ...timeStep, grid: '#no-such-table' }),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 3_000 }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('ページに見つかりません')
  }, 90_000)
})

describe('ピッカーによる時間枠の認識', () => {
  let session: Session
  const picks: PickedElement[] = []

  beforeAll(async () => {
    session = await launch({ headless: true })
    await session.page.goto(`${server.origin}/time-slots.html`)
    // 実際の流れと同じく、操作モードで日付を選んで時間表を出してから
    // 選択モードに切り替える
    await session.page.click('#calendar-date td[data-date="2026-10-05"]')
    await session.page.waitForSelector('#calendar-time', { state: 'visible' })
    await startPicker(session.page, (p) => picks.push(p))
  }, 60_000)

  afterAll(async () => {
    await stopPicker(session.page)
    await session?.close()
  })

  it('時刻の見出しを押しても、枠である行を対象にする', async () => {
    // 人が押すのは <th>10:00</th>。空き状況を持つのは親の <tr data-time>
    await session.page.click('#calendar-time tr[data-time="10:00"] th')
    await session.page.waitForTimeout(200)

    const picked = picks.at(-1)
    expect(picked?.tagName).toBe('tr')
    expect(picked?.attrs['data-time']).toBe('10:00')
    expect(picked?.looksLikeTimeSlot).toBe(true)
  }, 60_000)

  it('○ の欄を押しても行を対象にする', async () => {
    await session.page.click('#calendar-time tr[data-time="11:00"] td')
    await session.page.waitForTimeout(200)
    expect(picks.at(-1)?.attrs['data-time']).toBe('11:00')
  }, 60_000)

  it('日付セルは時間枠と混同しない', async () => {
    await session.page.click('#calendar-date td[data-date="2026-10-05"]')
    await session.page.waitForTimeout(200)

    const picked = picks.at(-1)
    expect(picked?.looksLikeCalendarCell).toBe(true)
    expect(picked?.looksLikeTimeSlot).toBe(false)
  }, 60_000)

  it('推測したセレクタで実際の行を拾える', async () => {
    await session.page.click('#calendar-time tr[data-time="12:00"] th')
    await session.page.waitForTimeout(200)
    const picked = picks.at(-1)!

    const cell = guessCell(picked)
    // 空き状況を表す class を使うと満席の枠が候補から外れてしまう
    expect(cell).toBe('tr[data-time]')
    expect(cell).not.toContain('available')

    // 表の id は行ではなく親のテーブルに付いている。
    // ここを取り違えるとページ最初の表を掴み、表示待ちでタイムアウトする
    const grid = guessGrid(picked)
    expect(grid).toBe('#calendar-time')
    expect(grid).not.toBe('table')

    const count = await session.page.locator(`${grid} ${cell}`).count()
    expect(count).toBe(19)
  }, 60_000)

  it('日付セルの表も親のテーブルとして特定できる', async () => {
    await session.page.click('#calendar-date td[data-date="2026-10-07"]')
    await session.page.waitForTimeout(200)
    expect(guessGrid(picks.at(-1)!)).toBe('#calendar-date')
  }, 60_000)
})
