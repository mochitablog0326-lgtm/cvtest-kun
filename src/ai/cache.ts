import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Field } from '../types/field'
import type { GeneratedValues } from './provider'

/**
 * hash(url + DOM構造) をキーにする（設計 §6.6）。
 *
 * 値そのものではなく「どんな項目があるか」でキーを作る。
 * 同じフォームなら毎回AIを呼ばずに済む。
 */
export function cacheKey(url: string, fields: Field[], providerId: string): string {
  const structure = fields
    .filter((f) => !f.isHoneypot)
    .map((f) =>
      [
        f.ref,
        f.type,
        f.label,
        f.name ?? '',
        f.required ? 'req' : '',
        (f.options ?? []).map((o) => o.label).join('|')
      ].join(':')
    )
    .join('\n')

  // クエリ文字列は毎回変わることがあるので除く
  let normalizedUrl = url
  try {
    const parsed = new URL(url)
    normalizedUrl = `${parsed.origin}${parsed.pathname}`
  } catch {
    // URL として読めなければそのまま使う
  }

  return createHash('sha256')
    .update(`${providerId}\n${normalizedUrl}\n${structure}`)
    .digest('hex')
    .slice(0, 32)
}

interface CacheEntry {
  key: string
  url: string
  createdAt: string
  result: GeneratedValues
}

/** userData/cache/ai 配下のローカルキャッシュ。 */
export class AiCache {
  constructor(
    private readonly dir: string,
    /** 有効期限。既定30日 */
    private readonly maxAgeMs = 30 * 24 * 60 * 60 * 1000
  ) {}

  private pathFor(key: string): string {
    return join(this.dir, `${key}.json`)
  }

  async get(key: string): Promise<GeneratedValues | undefined> {
    try {
      const raw = await readFile(this.pathFor(key), 'utf8')
      const entry = JSON.parse(raw) as CacheEntry
      const age = Date.now() - new Date(entry.createdAt).getTime()
      if (age > this.maxAgeMs) return undefined
      return entry.result
    } catch {
      return undefined
    }
  }

  async set(key: string, url: string, result: GeneratedValues): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true })
      const entry: CacheEntry = {
        key,
        url,
        createdAt: new Date().toISOString(),
        result
      }
      await writeFile(this.pathFor(key), JSON.stringify(entry, null, 2), 'utf8')
    } catch {
      // キャッシュに書けなくても生成自体は成功しているので握りつぶす
    }
  }

  async clear(): Promise<number> {
    try {
      const files = await readdir(this.dir)
      let removed = 0
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        await unlink(join(this.dir, file))
        removed++
      }
      return removed
    } catch {
      return 0
    }
  }

  /** 期限切れを掃除する。 */
  async prune(): Promise<number> {
    let removed = 0
    try {
      const files = await readdir(this.dir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const path = join(this.dir, file)
        const info = await stat(path)
        if (Date.now() - info.mtimeMs > this.maxAgeMs) {
          await unlink(path)
          removed++
        }
      }
    } catch {
      // ディレクトリが無ければ掃除する対象もない
    }
    return removed
  }
}
