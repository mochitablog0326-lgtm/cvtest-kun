import { app } from 'electron'
import { readdir, readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { scenarioSchema, type Scenario } from '../types/scenario'

export interface AppConfig {
  /** シナリオの保存先。ユーザーが任意のフォルダを指定できる（設計 §12） */
  scenarioDir: string
  providerId?: string
  /** Codex CLI に渡すモデル名。未指定なら CLI の既定 */
  aiModel?: string
  browserChannel?: string
  headless?: boolean
  stepDelayMs?: number
}

export interface ScenarioSummary {
  path: string
  name: string
  url: string
  updatedAt: string
  steps: number
}

const DEFAULT_SCENARIO_DIR = join(app.getPath('documents'), 'cvtest-scenarios')

export class Store {
  private readonly configPath = join(app.getPath('userData'), 'config.json')

  async loadConfig(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      return { scenarioDir: parsed.scenarioDir ?? DEFAULT_SCENARIO_DIR, ...parsed }
    } catch {
      return { scenarioDir: DEFAULT_SCENARIO_DIR }
    }
  }

  async saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    const merged = { ...(await this.loadConfig()), ...config }
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.configPath, JSON.stringify(merged, null, 2), 'utf8')
    return merged
  }

  get runsDir(): string {
    return join(app.getPath('userData'), 'runs')
  }

  get cacheDir(): string {
    return join(app.getPath('userData'), 'cache', 'ai')
  }

  get presetsDir(): string {
    return join(app.getPath('userData'), 'presets')
  }

  async list(): Promise<ScenarioSummary[]> {
    const { scenarioDir } = await this.loadConfig()
    let files: string[]
    try {
      files = await readdir(scenarioDir)
    } catch {
      return []
    }

    const summaries: ScenarioSummary[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const path = join(scenarioDir, file)
      try {
        const scenario = await this.load(path)
        summaries.push({
          path,
          name: scenario.name,
          url: scenario.url,
          updatedAt: scenario.updatedAt,
          steps: scenario.steps.length
        })
      } catch {
        // 壊れたファイルは一覧から外す（読み込み時にエラーを出す）
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async load(path: string): Promise<Scenario> {
    const raw = await readFile(path, 'utf8')
    const parsed = scenarioSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      throw new Error(
        `シナリオの形式が正しくありません: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
      )
    }
    return parsed.data
  }

  /** ファイル名に使えない文字を落とす。日本語名はそのまま通す（設計のリリース前チェック）。 */
  private fileNameFor(scenario: Scenario): string {
    const safe = scenario.name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'scenario'
    return `${safe}.json`
  }

  async save(scenario: Scenario, path?: string): Promise<string> {
    const { scenarioDir } = await this.loadConfig()
    await mkdir(scenarioDir, { recursive: true })

    const target = path ?? join(scenarioDir, this.fileNameFor(scenario))
    const updated: Scenario = { ...scenario, updatedAt: new Date().toISOString() }

    await writeFile(target, JSON.stringify(updated, null, 2), 'utf8')
    return target
  }

  async remove(path: string): Promise<void> {
    await unlink(path)
  }

  /** 実行結果の一覧。新しい順。 */
  async listRuns(limit = 50): Promise<{ dir: string; at: string }[]> {
    try {
      const entries = await readdir(this.runsDir)
      const runs = await Promise.all(
        entries.map(async (name) => {
          const dir = join(this.runsDir, name)
          const info = await stat(dir)
          return { dir, at: info.mtime.toISOString(), isDir: info.isDirectory() }
        })
      )
      return runs
        .filter((r) => r.isDir)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .map(({ dir, at }) => ({ dir, at }))
    } catch {
      return []
    }
  }

  async loadRunResult(dir: string): Promise<unknown> {
    const raw = await readFile(join(dir, 'result.json'), 'utf8')
    return JSON.parse(raw)
  }

  /** ユーザーが追加した媒体プリセットを読む（設計 §11.1 のコミュニティ追加）。 */
  async loadUserPresets(): Promise<unknown[]> {
    try {
      const files = await readdir(this.presetsDir)
      const presets: unknown[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const raw = await readFile(join(this.presetsDir, file), 'utf8')
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) presets.push(...parsed)
        else presets.push(parsed)
      }
      return presets
    } catch {
      return []
    }
  }

  /** 保存先ディレクトリの外を触らせない。 */
  async assertInScenarioDir(path: string): Promise<void> {
    const { scenarioDir } = await this.loadConfig()
    const normalized = resolve(path)
    if (!normalized.startsWith(resolve(scenarioDir))) {
      throw new Error(`シナリオ保存先の外は操作できません: ${basename(path)}`)
    }
  }
}
