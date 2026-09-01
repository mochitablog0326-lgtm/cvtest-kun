import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

/** 日付計算は JST 固定（設計 §9）。実行マシンのTZに依存させない。 */
export const TZ = 'Asia/Tokyo'

export interface TemplateContext {
  variables?: Record<string, string>
  env?: Record<string, string | undefined>
  /** safeStorage から復号した値を引く。同期で解決できるものだけ渡す */
  secrets?: Record<string, string>
  /** テスト用に「今」を固定する */
  now?: Date
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomString(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)]
  }
  return out
}

/** `today+7` `today-1d` `today+2w` `today+1m` を dayjs に落とす。 */
function applyOffset(base: dayjs.Dayjs, offset: string | undefined): dayjs.Dayjs {
  if (!offset) return base
  const m = /^([+-])(\d+)([dwmy]?)$/.exec(offset.trim())
  if (!m) throw new Error(`日付オフセットを解釈できません: ${offset}`)
  const sign = m[1] === '-' ? -1 : 1
  const amount = sign * Number(m[2])
  const unit = m[3] || 'd'
  const unitMap: Record<string, dayjs.ManipulateType> = {
    d: 'day',
    w: 'week',
    m: 'month',
    y: 'year'
  }
  return base.add(amount, unitMap[unit] ?? 'day')
}

/** 次の指定曜日（今日がその曜日なら7日後）。 */
function nextWeekday(base: dayjs.Dayjs, weekday: number): dayjs.Dayjs {
  const diff = (weekday - base.day() + 7) % 7
  return base.add(diff === 0 ? 7 : diff, 'day')
}

function resolveToken(token: string, ctx: TemplateContext): string {
  const now = ctx.now ? dayjs(ctx.now).tz(TZ) : dayjs().tz(TZ)

  // {{expr|format}}
  const pipeIndex = token.indexOf('|')
  const expr = (pipeIndex >= 0 ? token.slice(0, pipeIndex) : token).trim()
  const format = pipeIndex >= 0 ? token.slice(pipeIndex + 1).trim() : undefined

  if (expr === 'timestamp') return now.format('YYYYMMDDHHmmss')

  const randomMatch = /^random:(\d+)$/.exec(expr)
  if (randomMatch) return randomString(Number(randomMatch[1]))

  const envMatch = /^env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(expr)
  if (envMatch) {
    const key = envMatch[1]!
    const value = ctx.env?.[key]
    if (value === undefined) throw new Error(`環境変数が未設定です: ${key}`)
    return value
  }

  const secretMatch = /^secret\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(expr)
  if (secretMatch) {
    const key = secretMatch[1]!
    const value = ctx.secrets?.[key]
    if (value === undefined) throw new Error(`シークレットが未登録です: ${key}`)
    return value
  }

  const varMatch = /^var\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(expr)
  if (varMatch) {
    const key = varMatch[1]!
    const value = ctx.variables?.[key]
    if (value === undefined) throw new Error(`変数が未定義です: ${key}`)
    return value
  }

  // 日付系: today / now / tomorrow / yesterday / nextMonday ... + オフセット
  const dateMatch = /^([A-Za-z]+)([+-]\d+[dwmy]?)?$/.exec(expr)
  if (dateMatch) {
    const nameRaw = dateMatch[1]!
    const offset = dateMatch[2]
    const name = nameRaw.toLowerCase()
    let base: dayjs.Dayjs | undefined

    if (name === 'today' || name === 'now') base = now
    else if (name === 'tomorrow') base = now.add(1, 'day')
    else if (name === 'yesterday') base = now.subtract(1, 'day')
    else {
      const weekdayMatch = /^next([a-z]+)$/.exec(name)
      if (weekdayMatch) {
        const weekday = WEEKDAYS[weekdayMatch[1]!]
        if (weekday !== undefined) base = nextWeekday(now, weekday)
      }
    }

    if (base) {
      return applyOffset(base, offset).format(format ?? 'YYYY-MM-DD')
    }
  }

  throw new Error(`テンプレート記法を解釈できません: {{${token}}}`)
}

/**
 * `{{...}}` を展開する。未知の記法は例外にする（黙って空文字にすると
 * 実フォームに空値を送ってしまうため）。
 */
export function expand(input: string, ctx: TemplateContext = {}): string {
  return input.replace(/\{\{([^}]+)\}\}/g, (_full, token: string) => resolveToken(token, ctx))
}

/** 文字列に未展開のテンプレートが残っていないか。 */
export function hasTemplate(input: string): boolean {
  return /\{\{[^}]+\}\}/.test(input)
}

/** 展開せずに参照しているキーを列挙する（実行前の未設定チェック用）。 */
export function referencedKeys(input: string): { env: string[]; secret: string[]; var: string[] } {
  const out = { env: [] as string[], secret: [] as string[], var: [] as string[] }
  for (const m of input.matchAll(/\{\{([^}]+)\}\}/g)) {
    const expr = (m[1] ?? '').split('|')[0]!.trim()
    const parts = /^(env|secret|var)\.(.+)$/.exec(expr)
    if (parts) out[parts[1] as 'env' | 'secret' | 'var'].push(parts[2]!)
  }
  return out
}
