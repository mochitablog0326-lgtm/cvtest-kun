import type { Locator, Page } from 'playwright-core'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { AvailableRule, PickSlotStep } from '../../types/scenario'
import { TZ } from '../template'
import { parseJpDate, parseYearMonth, parseTime, timeInRange } from '../jpdate'
import type { StepContext, StepDetail } from './context'

dayjs.extend(utc)
dayjs.extend(timezone)

/** セルから判定に必要な情報だけを一度に抜く（往復を減らす）。 */
interface CellInfo {
  classes: string[]
  attrs: Record<string, string>
  text: string
  hasChildMatch: boolean
  /** data-date / datetime / value など日付を持ちそうな属性 */
  dateAttrs: string[]
  ariaLabel: string
  disabled: boolean
}

async function readCell(cell: Locator, hasChild: string | undefined): Promise<CellInfo> {
  return cell.evaluate((el, childSelector) => {
    const element = el as HTMLElement
    const attrs: Record<string, string> = {}
    for (const a of Array.from(element.attributes)) {
      attrs[a.name] = a.value
    }

    const dateAttrNames = [
      'data-date',
      'data-day',
      'data-value',
      'datetime',
      'value',
      'data-timestamp',
      'id'
    ]
    const dateAttrs = dateAttrNames
      .map((n) => element.getAttribute(n))
      .filter((v): v is string => Boolean(v))

    const time = element.querySelector('time[datetime]')
    if (time) {
      const dt = time.getAttribute('datetime')
      if (dt) dateAttrs.unshift(dt)
    }

    return {
      classes: Array.from(element.classList),
      attrs,
      text: (element.textContent ?? '').replace(/[\s　]+/g, ' ').trim(),
      hasChildMatch: childSelector ? Boolean(element.querySelector(childSelector)) : false,
      dateAttrs,
      ariaLabel: element.getAttribute('aria-label') ?? '',
      disabled:
        (element as HTMLButtonElement).disabled === true ||
        element.getAttribute('aria-disabled') === 'true'
    }
  }, hasChild ?? null)
}

/** 属性が「無効」を意味しているか。aria-disabled="false" は無効ではない。 */
function attrIndicatesSet(info: CellInfo, attr: string): boolean {
  const value = info.attrs[attr]
  if (value === undefined) return false
  if (value === 'false') return false
  return true
}

/**
 * 空き枠かどうかを判定する（設計 §4.2 の AvailableRule）。
 * ルールはピッカーの学習フローで生成される。決め打ちしない。
 */
export function isAvailableFromInfo(info: CellInfo, rule: AvailableRule): boolean {
  if (rule.hasClass?.length) {
    if (!rule.hasClass.every((c) => info.classes.includes(c))) return false
  }
  if (rule.notClass?.length) {
    if (rule.notClass.some((c) => info.classes.includes(c))) return false
  }
  if (rule.notAttr?.length) {
    if (rule.notAttr.some((a) => attrIndicatesSet(info, a))) return false
  }
  if (rule.textIn?.length) {
    if (!rule.textIn.some((t) => info.text.includes(t))) return false
  }
  if (rule.textNotIn?.length) {
    if (rule.textNotIn.some((t) => info.text.includes(t))) return false
  }
  if (rule.hasChild) {
    if (!info.hasChildMatch) return false
  }
  return true
}

/** カレンダーが表示している年月を探す。日付が「15」だけのセルを解決するのに要る。 */
async function visibleYearMonth(
  page: Page,
  grid: string
): Promise<{ year: number; month: number } | undefined> {
  const texts = await page
    .locator(grid)
    .first()
    .evaluate((el) => {
      const out: string[] = []
      // グリッド自身の属性 → 内部の見出し → 祖先の見出し の順に探す
      const element = el as HTMLElement
      for (const name of ['data-month', 'data-year-month', 'aria-label']) {
        const v = element.getAttribute(name)
        if (v) out.push(v)
      }
      const caption = element.querySelector('caption, thead th[colspan], .month, [class*="month"]')
      if (caption) out.push((caption.textContent ?? '').trim())

      let node: HTMLElement | null = element
      let depth = 0
      while (node && depth++ < 4) {
        for (const child of Array.from(node.children)) {
          const text = (child.textContent ?? '').trim()
          if (text.length <= 30) out.push(text)
        }
        node = node.parentElement
      }
      return out
    })
    .catch(() => [] as string[])

  for (const text of texts) {
    const ym = parseYearMonth(text)
    if (ym) return ym
  }
  return undefined
}

/** セルが指す日付を ISO で返す。data-date -> aria-label -> テキスト の順。 */
export function dateOfCell(
  info: CellInfo,
  context: { year: number; month: number } | undefined,
  reference: Date
): string | null {
  const opts = {
    reference,
    contextYear: context?.year,
    contextMonth: context?.month
  }

  for (const raw of info.dateAttrs) {
    // UNIXタイムスタンプ（ミリ秒/秒）を持たせているカレンダーがある
    if (/^\d{10}$/.test(raw)) {
      return dayjs.unix(Number(raw)).tz(TZ).format('YYYY-MM-DD')
    }
    if (/^\d{13}$/.test(raw)) {
      return dayjs(Number(raw)).tz(TZ).format('YYYY-MM-DD')
    }
    const parsed = parseJpDate(raw, opts)
    if (parsed) return parsed
  }

  if (info.ariaLabel) {
    const parsed = parseJpDate(info.ariaLabel, opts)
    if (parsed) return parsed
  }

  const fromText = parseJpDate(info.text, opts)
  if (fromText) return fromText

  // カレンダーのセルは日付と空き記号が混ざる（"15 ○"）。
  // 表示中の年月が分かっているときだけ、先頭の日番号として解釈する。
  if (context) {
    const leadingDay = /^(\d{1,2})(?!\d)/.exec(info.text.trim())
    if (leadingDay) {
      const day = Number(leadingDay[1])
      if (day >= 1 && day <= 31) {
        return parseJpDate(String(day), opts)
      }
    }
  }

  return null
}

/**
 * セルが指す時刻を HH:MM で返す。data-time -> 見出し -> テキスト の順。
 *
 * 時間帯の一覧は `<tr data-time="10:00"><th>10:00</th><td>○</td></tr>` のように
 * 行そのものが枠になっていることが多い。
 */
export function timeOfCell(info: CellInfo): string | null {
  const attrNames = ['data-time', 'data-slot', 'data-hour', 'data-value', 'value']
  for (const name of attrNames) {
    const value = info.attrs[name]
    if (!value) continue
    const parsed = parseTime(value)
    if (parsed) return parsed
  }

  if (info.ariaLabel) {
    const parsed = parseTime(info.ariaLabel)
    if (parsed) return parsed
  }

  return parseTime(info.text)
}

function inRange(
  date: string | null,
  range: PickSlotStep['range'],
  reference: Date
): boolean {
  if (!range) return true
  if (!date) return false

  const today = dayjs(reference).tz(TZ).startOf('day')
  const target = dayjs.tz(date, TZ).startOf('day')
  const daysAhead = target.diff(today, 'day')

  if (range.minDaysAhead !== undefined && daysAhead < range.minDaysAhead) return false
  if (range.maxDaysAhead !== undefined && daysAhead > range.maxDaysAhead) return false
  return true
}

/** 表が見つからない・表示されない理由を切り分けて伝える。 */
async function describeGridFailure(
  ctx: StepContext,
  step: PickSlotStep,
  isTime: boolean
): Promise<string> {
  const what = isTime ? '時間表' : 'カレンダー'
  const total = await ctx.page.locator(step.grid).count().catch(() => 0)

  if (total === 0) {
    return (
      `${what}「${step.grid}」がページに見つかりません。` +
      'セレクタが違う可能性があります。ピッカーの「取直」で選び直してください。'
    )
  }

  return (
    `${what}「${step.grid}」が表示されませんでした（${total} 件一致、いずれも非表示）。` +
    (isTime
      ? '日付を選ぶと時間表が現れる作りの場合、先に日付を選ぶステップが必要です。'
      : '表示するための操作が先に必要かもしれません。')
  )
}

export interface PickSlotOptions {
  /** テスト用に「今日」を固定する */
  reference?: Date
}

/**
 * 空き枠を選ぶ（設計 §8）。
 *
 * 選んだ日付は必ず返す。RunResult.pickedDate に記録されないと
 * 「何を予約したのか分からず片付けられない」事故になる（設計 §11.2）。
 */
export async function pickSlot(
  step: PickSlotStep,
  ctx: StepContext,
  opts: PickSlotOptions = {}
): Promise<StepDetail> {
  const reference = opts.reference ?? new Date()
  const isTime = step.kind === 'time'
  const maxNav = isTime ? 0 : step.maxMonthNav ?? 3
  const inspected: { date: string | null; available: boolean; text: string }[] = []

  for (let month = 0; month <= maxNav; month++) {
    const grid = ctx.page.locator(step.grid).first()

    // 表示待ちで落ちたときに何が起きたのか分かるようにする。
    // 素の TimeoutError だけでは、セレクタ違いなのか未表示なのか判別できない
    try {
      await grid.waitFor({ state: 'visible', timeout: ctx.timeoutMs })
    } catch {
      throw new Error(await describeGridFailure(ctx, step, isTime))
    }

    const context = isTime ? undefined : await visibleYearMonth(ctx.page, step.grid)
    const cells = grid.locator(step.cell)
    const count = await cells.count()

    const candidates: { index: number; value: string }[] = []

    for (let i = 0; i < count; i++) {
      const info = await readCell(cells.nth(i), step.available.hasChild)
      const available = isAvailableFromInfo(info, step.available)

      if (isTime) {
        const time = timeOfCell(info)
        inspected.push({ date: time, available, text: info.text })
        if (!available) continue
        if (!time) continue
        if (!timeInRange(time, step.timeRange)) continue
        candidates.push({ index: i, value: time })
        continue
      }

      const date = dateOfCell(info, context, reference)
      inspected.push({ date, available, text: info.text })

      if (!available) continue
      if (!date) continue
      if (!inRange(date, step.range, reference)) continue

      candidates.push({ index: i, value: date })
    }

    if (candidates.length > 0) {
      // 毎回同じ枠を潰さないよう random を選べるようにしてある（設計 §8）
      const chosen =
        step.strategy === 'random'
          ? candidates[Math.floor(Math.random() * candidates.length)]!
          : step.strategy === 'last'
            ? candidates[candidates.length - 1]!
            : candidates[0]!

      const target = cells.nth(chosen.index)
      await target.scrollIntoViewIfNeeded().catch(() => {})
      await target.click({ timeout: ctx.timeoutMs })

      ctx.log(
        `  ${isTime ? '空き時間' : '空き枠'}を選択: ${chosen.value}（候補 ${candidates.length} 件）`
      )

      return {
        // 何を予約したかは必ず残す（設計 §11.2）
        ...(isTime ? { pickedTime: chosen.value } : { pickedDate: chosen.value }),
        candidateCount: candidates.length,
        monthsNavigated: month,
        strategy: step.strategy
      }
    }

    // 時間帯の一覧に「翌月」は無い
    if (isTime || !step.nextMonth || month === maxNav) break

    ctx.log(`  この月に空きなし。翌月へ（${month + 1}/${maxNav}）`)
    await ctx.page.click(step.nextMonth, { timeout: ctx.timeoutMs })
    await ctx.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    await ctx.page.waitForTimeout(300)
  }

  const summary = inspected
    .slice(0, 10)
    .map((c) => `${c.date ?? '?'}:${c.available ? '空' : '×'}`)
    .join(' ')

  throw new Error(
    `条件に合う${isTime ? '空き時間' : '空き枠'}が見つかりませんでした` +
      `（${inspected.length} セルを確認）。先頭10件: ${summary}`
  )
}
