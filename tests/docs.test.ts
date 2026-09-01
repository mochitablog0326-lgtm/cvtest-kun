import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scenarioSchema, pickSlotStepSchema } from '../src/types/scenario'
import { presetsSchema } from '../src/types/preset'
import { EXAMPLE_SCENARIO } from '../src/cli/index'
import { BUILTIN_PRESETS } from '../src/presets/testcv'

const ROOT = join(__dirname, '..')

/** README の ```json ブロックを取り出す。 */
async function jsonBlocks(file: string): Promise<unknown[]> {
  const text = await readFile(join(ROOT, file), 'utf8')
  const blocks: unknown[] = []
  for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    blocks.push(JSON.parse(m[1]!))
  }
  return blocks
}

describe('ドキュメントとコードの整合', () => {
  it('README のシナリオ例がスキーマ検証を通る', async () => {
    const blocks = await jsonBlocks('README.md')
    const scenarios = blocks.filter(
      (b): b is Record<string, unknown> =>
        typeof b === 'object' && b !== null && 'steps' in b
    )
    expect(scenarios.length).toBeGreaterThan(0)

    for (const scenario of scenarios) {
      const parsed = scenarioSchema.safeParse(scenario)
      if (!parsed.success) {
        throw new Error(
          `README のシナリオ例がスキーマに合いません: ${JSON.stringify(parsed.error.issues)}`
        )
      }
    }
  })

  it('README の pickSlot 例がスキーマ検証を通る', async () => {
    const blocks = await jsonBlocks('README.md')
    const slot = blocks.find(
      (b): b is Record<string, unknown> =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'pickSlot'
    )
    expect(slot).toBeDefined()
    // ドキュメントの例には id を書いていないので補って検証する
    const parsed = pickSlotStepSchema.safeParse({ id: 's1', ...slot })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('README.en.md のシナリオ例がスキーマ検証を通る', async () => {
    const blocks = await jsonBlocks('README.en.md')
    const scenarios = blocks.filter(
      (b): b is Record<string, unknown> =>
        typeof b === 'object' && b !== null && 'steps' in b
    )
    expect(scenarios.length).toBeGreaterThan(0)
    for (const scenario of scenarios) {
      expect(scenarioSchema.safeParse(scenario).success).toBe(true)
    }
  })

  it('CLI の雛形シナリオがスキーマ検証を通る', () => {
    expect(scenarioSchema.safeParse(EXAMPLE_SCENARIO).success).toBe(true)
  })

  it('同梱プリセットJSONがスキーマ検証を通る', async () => {
    const raw = JSON.parse(
      await readFile(join(ROOT, 'src/presets/data/presets.json'), 'utf8')
    )
    expect(presetsSchema.safeParse(raw).success).toBe(true)
  })

  it('README に載せた媒体が実際に同梱されている', async () => {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8')
    for (const preset of BUILTIN_PRESETS) {
      expect(readme, `${preset.label} が README に載っていません`).toContain(preset.label)
    }
  })

  it('README に CAPTCHA を回避しない旨を明記している', async () => {
    const ja = await readFile(join(ROOT, 'README.md'), 'utf8')
    const en = await readFile(join(ROOT, 'README.en.md'), 'utf8')
    expect(ja).toContain('CAPTCHA')
    expect(ja).toContain('回避する機能は持ちません')
    expect(en).toContain('does not bypass CAPTCHA')
  })

  it('英語READMEで CV の意味を明示している', async () => {
    const en = await readFile(join(ROOT, 'README.en.md'), 'utf8')
    expect(en).toContain('not _curriculum vitae_')
  })

  it('README のテンプレート記法が実装と一致する', async () => {
    // Markdown の表ではパイプを \| と書く必要があるので戻してから照合する
    const readme = (await readFile(join(ROOT, 'README.md'), 'utf8')).replace(/\\\|/g, '|')
    const { expand } = await import('../src/engine/template')
    const now = new Date('2026-09-01T05:30:22.000Z')

    // README の表に載せた記法をそのまま展開してみる
    const cases: [string, string][] = [
      ['{{timestamp}}', '20260901143022'],
      ['{{today|YYYY-MM-DD}}', '2026-09-01'],
      ['{{today+7|YYYY-MM-DD}}', '2026-09-08'],
      ['{{nextMonday|M/D}}', '9/7']
    ]
    for (const [notation, expected] of cases) {
      expect(readme, `${notation} が README に載っていません`).toContain(notation)
      expect(expand(notation, { now })).toBe(expected)
    }
  })
})
