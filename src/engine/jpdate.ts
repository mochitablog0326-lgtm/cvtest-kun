import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { TZ } from './template'

dayjs.extend(utc)
dayjs.extend(timezone)

/** 和暦の元号開始年（元年 = その年）。 */
const ERAS: { names: string[]; startYear: number; startMonth: number; startDay: number }[] = [
  { names: ['令和', 'R', 'r'], startYear: 2019, startMonth: 5, startDay: 1 },
  { names: ['平成', 'H', 'h'], startYear: 1989, startMonth: 1, startDay: 8 },
  { names: ['昭和', 'S', 's'], startYear: 1926, startMonth: 12, startDay: 25 },
  { names: ['大正', 'T', 't'], startYear: 1912, startMonth: 7, startDay: 30 },
  { names: ['明治', 'M', 'm'], startYear: 1868, startMonth: 1, startDay: 25 }
]

const ZEN_TO_HAN: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
}

/** 全角数字を半角へ。日本のフォームは全角混在が多い。 */
export function normalizeDigits(input: string): string {
  return input.replace(/[０-９]/g, (c) => ZEN_TO_HAN[c] ?? c)
}

function iso(year: number, month: number, day: number): string | null {
  const d = dayjs.tz(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    TZ
  )
  if (!d.isValid() || d.month() + 1 !== month || d.date() !== day) return null
  return d.format('YYYY-MM-DD')
}

export interface ParseOptions {
  /** 年が省略された表記（`9/15`）の基準日。既定は今日(JST)。 */
  reference?: Date
  /**
   * 年省略時の解決方法。予約カレンダーは未来を指すのが普通なので
   * 既定は 'future'（基準日以降で最も近い同月日）。
   */
  yearGuess?: 'future' | 'sameYear'
  /** 日のみ表記（カレンダーセルの `15`）を解決するための表示中の年月。 */
  contextYear?: number
  contextMonth?: number
}

/**
 * 日本のフォーム／カレンダーに現れる日付表記を ISO (YYYY-MM-DD) に正規化する。
 * 解釈できない場合は null を返す（例外にしない ─ カレンダーには空セルが混ざるため）。
 */
export function parseJpDate(raw: string, opts: ParseOptions = {}): string | null {
  if (!raw) return null
  const text = normalizeDigits(raw).trim()
  if (!text) return null

  const ref = opts.reference ? dayjs(opts.reference).tz(TZ) : dayjs().tz(TZ)

  // 和暦: 令和6年9月15日 / R6.9.15 / H30/4/1
  for (const era of ERAS) {
    for (const name of era.names) {
      const pattern = new RegExp(
        `${name}\\s*(元|\\d{1,2})\\s*[年./-]\\s*(\\d{1,2})\\s*[月./-]\\s*(\\d{1,2})`
      )
      const m = pattern.exec(text)
      if (!m) continue
      const eraYear = m[1] === '元' ? 1 : Number(m[1])
      const year = era.startYear + eraYear - 1
      return iso(year, Number(m[2]), Number(m[3]))
    }
  }

  // 西暦: 2026-09-15 / 2026/9/15 / 2026年9月15日 / 20260915
  const ymd = /(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/.exec(text)
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (compact) return iso(Number(compact[1]), Number(compact[2]), Number(compact[3]))

  // 年省略: 9/15 / 9月15日
  const md = /(?:^|[^\d])(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(?:[^\d]|$)/.exec(text)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      if (opts.yearGuess === 'sameYear') return iso(ref.year(), month, day)
      const sameYear = iso(ref.year(), month, day)
      if (sameYear && dayjs.tz(sameYear, TZ).isBefore(ref.startOf('day'))) {
        return iso(ref.year() + 1, month, day)
      }
      return sameYear
    }
  }

  // 日のみ: カレンダーセルの "15"。表示中の年月が分かるときだけ解決する
  const dayOnly = /^(\d{1,2})\s*日?$/.exec(text)
  if (dayOnly && opts.contextYear && opts.contextMonth) {
    return iso(opts.contextYear, opts.contextMonth, Number(dayOnly[1]))
  }

  return null
}

/** カレンダーのヘッダ文字列（"2026年9月" 等）から表示中の年月を取る。 */
export function parseYearMonth(raw: string): { year: number; month: number } | null {
  if (!raw) return null
  const text = normalizeDigits(raw).trim()

  for (const era of ERAS) {
    for (const name of era.names) {
      const m = new RegExp(`${name}\\s*(元|\\d{1,2})\\s*年\\s*(\\d{1,2})\\s*月`).exec(text)
      if (m) {
        const eraYear = m[1] === '元' ? 1 : Number(m[1])
        return { year: era.startYear + eraYear - 1, month: Number(m[2]) }
      }
    }
  }

  const m = /(\d{4})\s*[年./-]\s*(\d{1,2})\s*月?/.exec(text)
  if (m) {
    const month = Number(m[2])
    if (month >= 1 && month <= 12) return { year: Number(m[1]), month }
  }
  return null
}
