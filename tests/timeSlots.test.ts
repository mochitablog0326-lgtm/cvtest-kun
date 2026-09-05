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

describe('枠のセレクタ生成', () => {
  let session: Session
  const picks: PickedElement[] = []

  beforeAll(async () => {
    session = await launch({ headless: true })
    await session.page.goto(`${server.origin}/time-slots.html`)
    await session.page.click('#calendar-date td[data-date="2026-10-05"]')
    await session.page.waitForSelector('#calendar-time', { state: 'visible' })
    await startPicker(session.page, (p) => picks.push(p))
  }, 60_000)

  afterAll(async () => {
    await stopPicker(session.page)
    await session?.close()
  })

  it('表の行にラベル指定のセレクタを作らない', async () => {
    // getByLabel は「ラベルに紐づくフォーム部品」を指す。
    // <tr> に使うと不可視の何かを待ち続けてタイムアウトする
    await session.page.click('#calendar-time tr[data-time="14:30"] td')
    await session.page.waitForTimeout(200)

    const selector = picks.at(-1)!.selector
    expect(selector).not.toContain('internal:label')
    expect(selector).not.toContain('internal:role')
  }, 60_000)

  it('data 属性を使って行を一意に指す', async () => {
    await session.page.click('#calendar-time tr[data-time="15:00"] th')
    await session.page.waitForTimeout(200)
    expect(picks.at(-1)!.selector).toBe('tr[data-time="15:00"]')
  }, 60_000)

  it('生成したセレクタが実際にその行だけを指す', async () => {
    await session.page.click('#calendar-time tr[data-time="16:00"] th')
    await session.page.waitForTimeout(200)

    const selector = picks.at(-1)!.selector
    const locator = session.page.locator(selector)
    expect(await locator.count()).toBe(1)
    expect(await locator.getAttribute('data-time')).toBe('16:00')
    // 実際に見えている＝待ってもタイムアウトしない
    expect(await locator.isVisible()).toBe(true)
  }, 60_000)

  it('日付セルも data-date で指す', async () => {
    await session.page.click('#calendar-date td[data-date="2026-10-07"]')
    await session.page.waitForTimeout(200)
    expect(picks.at(-1)!.selector).toBe('td[data-date="2026-10-07"]')
  }, 60_000)

  it('フォーム部品では従来どおりラベル指定を使える', async () => {
    await session.page.goto(`${server.origin}/contact.html`)
    await startPicker(session.page, (p) => picks.push(p))
    await session.page.click('input[name="tel"]')
    await session.page.waitForTimeout(200)

    // input には name があるのでそちらが優先されるが、
    // ラベル指定の経路自体が塞がれていないことを確認する
    const picked = picks.at(-1)!
    expect(picked.tagName).toBe('input')
    expect(picked.label).toBe('電話番号')
  }, 60_000)
})

describe('失敗メッセージ', () => {
  const base = (steps: Scenario['steps']): Scenario => ({
    version: 1,
    name: 'エラー確認',
    url: `${server.origin}/time-slots.html`,
    stepDelayMs: 0,
    steps,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  })

  it('対象が無いときは取直を案内する', async () => {
    const result = await run(
      base([{ id: 's1', type: 'fill', label: 'セイ', selector: '#no-such', value: 'x' }]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 2_000 }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('「セイ」の対象が見つかりません')
    expect(result.error).toContain('取直')
    expect(result.error).not.toMatch(/TimeoutError/)
  }, 60_000)

  it('存在するが非表示のときはその旨を伝える', async () => {
    // 時間表は日付を選ぶまで非表示
    const result = await run(
      base([
        {
          id: 's1',
          type: 'click',
          label: '時間の行',
          selector: 'tr[data-time="10:00"]'
        }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 2_000 }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('表示されていません')
    expect(result.error).toContain('1 件一致')
  }, 60_000)

  it('ラベル指定は読める形で示す', async () => {
    const result = await run(
      base([
        {
          id: 's1',
          type: 'fill',
          label: '謎の項目',
          selector: 'internal:label="14:30 ×"s',
          value: 'x'
        }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 2_000 }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('ラベル "14:30 ×"')
  }, 60_000)
})

describe('時間帯が後から読み込まれる場合', () => {
  /**
   * 日付を選ぶと表だけ先に現れ、行は少し遅れて差し込まれる作り。
   * 表の表示だけで先へ進むと「0 セルを確認」で空振りする。
   */
  const asyncScenario = (over: Partial<PickSlotStep> = {}): Scenario => ({
    version: 1,
    name: '後から読み込み',
    url: `${server.origin}/time-slots-async.html`,
    stepDelayMs: 0,
    steps: [
      { ...pickDateStep, grid: '#calendar-date' },
      {
        id: 't1',
        type: 'pickSlot',
        label: '時間を選ぶ',
        kind: 'time',
        grid: '#calendar-time',
        cell: 'tr[data-time]',
        available: AVAILABLE,
        strategy: 'first',
        ...over
      } as PickSlotStep
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  })

  it('行が差し込まれるまで待って選ぶ', async () => {
    const result = await run(asyncScenario(), {
      runsDir,
      launch: { headless: true },
      trace: false
    })

    expect(result.status).toBe('success')
    expect(result.pickedTime).toBe('10:00')
  }, 90_000)

  it('枠のセレクタが違うときは、ページ全体との対比で伝える', async () => {
    const result = await run(asyncScenario({ cell: 'tr[data-nothing]' }), {
      runsDir,
      launch: { headless: true },
      trace: false,
      timeoutMs: 3_000
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('ページに1つもありません')
  }, 90_000)

  it('表の指定が違うときは、枠がページにある旨を伝える', async () => {
    // 枠は存在するが、別の表を指している
    const result = await run(asyncScenario({ grid: '#calendar-date' }), {
      runsDir,
      launch: { headless: true },
      trace: false,
      timeoutMs: 3_000
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('ページに 19 件ありますが')
    expect(result.error).toContain('表を指すセレクタが違う可能性があります')
  }, 90_000)
})

describe('ステップの種類の取り違え', () => {
  const base = (steps: Scenario['steps']): Scenario => ({
    version: 1,
    name: '種類の確認',
    url: `${server.origin}/time-slots.html`,
    stepDelayMs: 0,
    steps,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  })

  it('予約枠を fill しようとしたら、作り直しを案内する', async () => {
    const result = await run(
      base([
        { ...pickDateStep },
        {
          id: 's1',
          type: 'fill',
          label: '時間',
          selector: 'tr[data-time="17:00"]',
          value: '○'
        }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 5_000 }
    )

    expect(result.status).toBe('failed')
    expect(result.error).toContain('入力欄ではありません')
    expect(result.error).toContain('<tr>')
    expect(result.error).toContain('予約枠のようです')
    expect(result.error).toContain('空いている枠から自動で選ぶ')
    // Playwright の英語エラーをそのまま出さない
    expect(result.error).not.toContain('Element is not an <input>')
  }, 90_000)

  it('プルダウンでない要素に select しようとしたら伝える', async () => {
    const result = await run(
      base([
        { ...pickDateStep },
        { id: 's1', type: 'select', label: '時間', selector: 'tr[data-time="17:00"]', value: '○' }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 5_000 }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('プルダウンではありません')
  }, 90_000)

  it('チェックボックスでない要素に check しようとしたら伝える', async () => {
    const result = await run(
      base([
        { ...pickDateStep },
        { id: 's1', type: 'check', label: '時間', selector: 'tr[data-time="17:00"]', checked: true }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 5_000 }
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('チェックボックス・ラジオではありません')
  }, 90_000)

  it('正しい種類のステップは素通しする', async () => {
    const result = await run(
      {
        version: 1,
        name: '正常',
        url: `${server.origin}/contact.html`,
        stepDelayMs: 0,
        steps: [
          { id: 's1', type: 'fill', label: '会社名', selector: '#company', value: '【テスト】社' },
          { id: 's2', type: 'select', label: '相談内容', selector: '#subject', value: '導入相談' },
          { id: 's3', type: 'check', label: '同意', selector: 'input[name="agree"]', checked: true }
        ],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      },
      { runsDir, launch: { headless: true }, trace: false }
    )
    expect(result.status).toBe('success')
  }, 90_000)
})
