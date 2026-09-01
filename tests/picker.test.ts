import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { launch, type Session } from '../src/engine/browser'
import { buildAvailableRule, startPicker, stopPicker, type PickedElement } from '../src/engine/picker'
import { isAvailableFromInfo } from '../src/engine/steps/pickSlot'
import { startServer, type TestServer } from './helpers/server'

let server: TestServer

beforeAll(async () => {
  server = await startServer()
}, 30_000)

afterAll(async () => {
  await server?.close()
})

function picked(over: Partial<PickedElement> = {}): PickedElement {
  return {
    selector: 'td.day',
    label: '',
    tagName: 'td',
    classes: [],
    attrs: {},
    text: '',
    hasChildLink: false,
    looksLikeCalendarCell: true,
    ...over
  }
}

describe('buildAvailableRule（空き判定の学習）', () => {
  it('class の差から hasClass / notClass を作る', () => {
    const rule = buildAvailableRule(
      picked({ classes: ['day', 'available'] }),
      picked({ classes: ['day', 'full'] })
    )
    expect(rule.hasClass).toEqual(['available'])
    expect(rule.notClass).toEqual(['full'])
  })

  it('埋まっている側だけに立つ属性を notAttr にする', () => {
    const rule = buildAvailableRule(
      picked({ attrs: { 'data-date': '2026-09-05' } }),
      picked({ attrs: { 'data-date': '2026-09-07', 'aria-disabled': 'true', disabled: '' } })
    )
    expect(rule.notAttr).toContain('aria-disabled')
    expect(rule.notAttr).toContain('disabled')
    // 値が違うだけの属性は無効化の印ではない
    expect(rule.notAttr).not.toContain('data-date')
  })

  it('aria-disabled="false" は無効化とみなさない', () => {
    const rule = buildAvailableRule(
      picked({ attrs: { 'aria-disabled': 'false' } }),
      picked({ attrs: { 'aria-disabled': 'true' } })
    )
    expect(rule.notAttr).toEqual(['aria-disabled'])
  })

  it('満席記号を textNotIn として拾う', () => {
    const rule = buildAvailableRule(picked({ text: '5 ○' }), picked({ text: '7 ×' }))
    expect(rule.textNotIn).toEqual(['×'])
  })

  it('日付の数字は記号として拾わない', () => {
    const rule = buildAvailableRule(picked({ text: '15 ○' }), picked({ text: '21 ×' }))
    expect(rule.textNotIn).toEqual(['×'])
  })

  it('クリックした空き記号を必須条件にしない（△ の枠を取りこぼさない）', () => {
    // ユーザーが ○ を空き例に選んでも、△ の枠は空きとして残る必要がある
    const rule = buildAvailableRule(picked({ text: '5 ○' }), picked({ text: '7 ×' }))
    expect(rule.textIn).toBeUndefined()

    const sankaku = {
      classes: [],
      attrs: {},
      text: '10 △',
      hasChildMatch: false,
      dateAttrs: [],
      ariaLabel: '',
      disabled: false
    }
    expect(isAvailableFromInfo(sankaku, rule)).toBe(true)
  })

  it('空きだけリンクになっている場合に hasChild を作る', () => {
    const rule = buildAvailableRule(
      picked({ hasChildLink: true }),
      picked({ hasChildLink: false })
    )
    expect(rule.hasChild).toBe('a, button')
  })

  it('見た目が同じなら空のルールになる（ユーザーに再学習を促せる）', () => {
    const rule = buildAvailableRule(picked({ text: '5' }), picked({ text: '7' }))
    expect(Object.keys(rule)).toHaveLength(0)
  })

  it('学習したルールが実際の判定に通る', () => {
    const rule = buildAvailableRule(
      picked({ classes: ['day', 'available'], text: '5 ○', hasChildLink: true }),
      picked({ classes: ['day', 'full'], text: '7 ×', attrs: { 'aria-disabled': 'true' } })
    )

    const availableCell = {
      classes: ['day', 'available'],
      attrs: {},
      text: '12 ○',
      hasChildMatch: true,
      dateAttrs: [],
      ariaLabel: '',
      disabled: false
    }
    const fullCell = {
      classes: ['day', 'full'],
      attrs: { 'aria-disabled': 'true' },
      text: '14 ×',
      hasChildMatch: false,
      dateAttrs: [],
      ariaLabel: '',
      disabled: true
    }

    expect(isAvailableFromInfo(availableCell, rule)).toBe(true)
    expect(isAvailableFromInfo(fullCell, rule)).toBe(false)
  })
})

describe('startPicker（実ブラウザ）', () => {
  let session: Session

  beforeAll(async () => {
    session = await launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await session?.close()
  })

  // ピッカーは遷移を跨いで生き残る。テスト間で漏れないよう毎回止める
  afterEach(async () => {
    await stopPicker(session.page)
  })

  it('クリックした要素のセレクタとラベルを返す', async () => {
    const picks: PickedElement[] = []
    await session.page.goto(`${server.origin}/contact.html`)
    await startPicker(session.page, (p) => picks.push(p))

    await session.page.click('#company')

    expect(picks).toHaveLength(1)
    expect(picks[0]?.selector).toBe('#company')
    expect(picks[0]?.label).toBe('会社名')
    expect(picks[0]?.tagName).toBe('input')
  }, 60_000)

  it('元のクリックを止める（送信ボタンを踏んでも実送信しない）', async () => {
    const picks: PickedElement[] = []
    await session.page.goto(`${server.origin}/contact.html`)
    await startPicker(session.page, (p) => picks.push(p))

    const urlBefore = session.page.url()
    await session.page.click('button[type="submit"]')
    await session.page.waitForTimeout(500)

    expect(picks).toHaveLength(1)
    expect(picks[0]?.label || picks[0]?.text).toContain('確認画面へ')
    // 遷移していないこと
    expect(session.page.url()).toBe(urlBefore)
  }, 60_000)

  it('カレンダーのセルを見分ける（日付ダイアログを出す判断に使う）', async () => {
    const picks: PickedElement[] = []
    await session.page.goto(`${server.origin}/calendar.html`)
    await startPicker(session.page, (p) => picks.push(p))

    await session.page.locator('#cells td.day').first().click()

    expect(picks[0]?.looksLikeCalendarCell).toBe(true)
    expect(picks[0]?.attrs['data-date']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  }, 60_000)

  it('ESC でピッカーを解除する', async () => {
    const picks: PickedElement[] = []
    await session.page.goto(`${server.origin}/contact.html`)
    await startPicker(session.page, (p) => picks.push(p))

    await session.page.keyboard.press('Escape')
    await session.page.click('#company')
    await session.page.waitForTimeout(200)

    expect(picks).toHaveLength(0)
  }, 60_000)

  it('実カレンダーの2セルからルールを学習して全体を判定できる', async () => {
    const picks: PickedElement[] = []
    await session.page.goto(`${server.origin}/calendar.html`)
    // 当月は全て満席なので翌月へ進めて空きセルを出す
    await session.page.click('#next')
    await startPicker(session.page, (p) => picks.push(p))

    await session.page.locator('#cells td.available').first().click()
    await session.page.locator('#cells td.full').first().click()

    expect(picks).toHaveLength(2)
    const rule = buildAvailableRule(picks[0]!, picks[1]!)

    // 学習結果でグリッド全体を判定する
    const verdicts = await session.page.$$eval('#cells td.day', (cells) =>
      cells.map((c) => ({
        isFull: c.classList.contains('full'),
        classes: Array.from(c.classList),
        attrs: Object.fromEntries(Array.from(c.attributes).map((a) => [a.name, a.value])),
        text: (c.textContent ?? '').replace(/[\s　]+/g, ' ').trim(),
        hasChildMatch: Boolean(c.querySelector('a, button'))
      }))
    )

    for (const v of verdicts) {
      const available = isAvailableFromInfo(
        { ...v, dateAttrs: [], ariaLabel: '', disabled: false },
        rule
      )
      expect(available, v.text).toBe(!v.isFull)
    }
  }, 60_000)
})
