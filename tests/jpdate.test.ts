import { describe, it, expect } from 'vitest'
import { parseJpDate, parseYearMonth, normalizeDigits } from '../src/engine/jpdate'

const REF = new Date('2026-09-01T05:00:00.000Z') // 2026-09-01 JST

describe('parseJpDate', () => {
  it('西暦の各表記', () => {
    expect(parseJpDate('2026-09-15')).toBe('2026-09-15')
    expect(parseJpDate('2026/9/15')).toBe('2026-09-15')
    expect(parseJpDate('2026年9月15日')).toBe('2026-09-15')
    expect(parseJpDate('20260915')).toBe('2026-09-15')
  })

  it('和暦', () => {
    expect(parseJpDate('令和8年9月15日')).toBe('2026-09-15')
    expect(parseJpDate('令和元年5月1日')).toBe('2019-05-01')
    expect(parseJpDate('平成31年4月30日')).toBe('2019-04-30')
    expect(parseJpDate('昭和64年1月7日')).toBe('1989-01-07')
    expect(parseJpDate('R8.9.15')).toBe('2026-09-15')
    expect(parseJpDate('H30/4/1')).toBe('2018-04-01')
  })

  it('全角数字を受け付ける', () => {
    expect(parseJpDate('２０２６年９月１５日')).toBe('2026-09-15')
    expect(normalizeDigits('０９')).toBe('09')
  })

  it('年省略は未来側に寄せる', () => {
    // 基準 2026-09-01。9/15 はまだ来ていないので同年
    expect(parseJpDate('9/15', { reference: REF })).toBe('2026-09-15')
    // 3/1 は過ぎているので翌年
    expect(parseJpDate('3/1', { reference: REF })).toBe('2027-03-01')
    expect(parseJpDate('9月15日', { reference: REF })).toBe('2026-09-15')
  })

  it('sameYear 指定なら同年に固定する', () => {
    expect(parseJpDate('3/1', { reference: REF, yearGuess: 'sameYear' })).toBe('2026-03-01')
  })

  it('日のみは表示中の年月がある時だけ解決する', () => {
    expect(parseJpDate('15', { contextYear: 2026, contextMonth: 9 })).toBe('2026-09-15')
    expect(parseJpDate('15日', { contextYear: 2026, contextMonth: 9 })).toBe('2026-09-15')
    expect(parseJpDate('15')).toBeNull()
  })

  it('存在しない日付は null', () => {
    expect(parseJpDate('2026-02-30')).toBeNull()
    expect(parseJpDate('2026-13-01')).toBeNull()
    expect(parseJpDate('15', { contextYear: 2026, contextMonth: 2 })).toBe('2026-02-15')
    expect(parseJpDate('31', { contextYear: 2026, contextMonth: 2 })).toBeNull()
  })

  it('解釈できない文字列は null（空セルを例外にしない）', () => {
    expect(parseJpDate('')).toBeNull()
    expect(parseJpDate('　')).toBeNull()
    expect(parseJpDate('×')).toBeNull()
    expect(parseJpDate('満席')).toBeNull()
  })

  it('うるう年', () => {
    expect(parseJpDate('2028-02-29')).toBe('2028-02-29')
    expect(parseJpDate('2026-02-29')).toBeNull()
  })
})

describe('parseYearMonth', () => {
  it('カレンダーヘッダから年月を取る', () => {
    expect(parseYearMonth('2026年9月')).toEqual({ year: 2026, month: 9 })
    expect(parseYearMonth('2026/09')).toEqual({ year: 2026, month: 9 })
    expect(parseYearMonth('令和8年9月')).toEqual({ year: 2026, month: 9 })
    expect(parseYearMonth('来月')).toBeNull()
  })
})
