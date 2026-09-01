import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/engine/runner'
import type { Scenario } from '../src/types/scenario'
import { startServer, type TestServer } from './helpers/server'

let server: TestServer
let runsDir: string

beforeAll(async () => {
  server = await startServer()
  runsDir = await mkdtemp(join(tmpdir(), 'cvtest-runs-'))
}, 30_000)

afterAll(async () => {
  await server?.close()
})

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    version: 1,
    name: '問い合わせフォーム',
    url: `${server.origin}/contact.html`,
    steps: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

/** contact.html は email と agree が required。埋めないと送信自体がブロックされる。 */
function submitFlow(extra: Scenario['steps'] = []): Scenario['steps'] {
  return [
    { id: 'r1', type: 'fill', label: 'メール', selector: '#email', value: 'test@example.com' },
    { id: 'r2', type: 'check', label: '同意', selector: 'input[name="agree"]', checked: true },
    { id: 'r3', type: 'click', label: '確認画面へ', selector: 'button[type="submit"]' },
    { id: 'r4', type: 'click', label: '送信する', selector: 'button[type="submit"]' },
    ...extra
  ]
}

describe('run', () => {
  it('入力から確認画面を経て送信まで通す', async () => {
    const result = await run(
      scenario({
        variables: { company: 'サンプル' },
        stepDelayMs: 0,
        steps: [
          { id: 's1', type: 'fill', label: '会社名', selector: '#company', value: '【テスト】{{var.company}}株式会社' },
          { id: 's2', type: 'fill', label: 'お名前', selector: '#name', value: '【テスト】山田太郎' },
          { id: 's3', type: 'fill', label: 'メール', selector: '#email', value: 'test+{{timestamp}}@example.com' },
          { id: 's4', type: 'select', label: 'ご相談内容', selector: '#subject', value: '導入相談' },
          { id: 's5', type: 'check', label: '同意', selector: 'input[name="agree"]', checked: true },
          { id: 's6', type: 'screenshot', name: 'before-submit' },
          { id: 's7', type: 'click', label: '確認画面へ', selector: 'button[type="submit"]' },
          { id: 's8', type: 'assert', label: '確認画面に到達', selector: 'h1', mode: 'text', value: '入力内容の確認' },
          { id: 's9', type: 'click', label: '送信する', selector: 'button[type="submit"]' },
          { id: 's10', type: 'assert', label: '完了画面に到達', selector: 'h1', mode: 'text', value: '送信完了' },
          { id: 's11', type: 'screenshot', name: 'after-submit' }
        ]
      }),
      { runsDir, launch: { headless: true }, trace: true }
    )

    expect(result.status).toBe('success')
    expect(result.steps.every((s) => s.status === 'ok')).toBe(true)
    expect(result.error).toBeUndefined()
  }, 90_000)

  it('入力値のテンプレートを展開して実際に入れる', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: [
          { id: 's1', type: 'fill', selector: '#email', value: 'test+{{timestamp}}@example.com' }
        ]
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    const detail = result.steps[0]?.detail as { value: string; actual: string }
    expect(detail.value).toMatch(/^test\+\d{14}@example\.com$/)
    expect(detail.actual).toBe(detail.value)
  }, 60_000)

  it('スクショと result.json / cleanup.md を残す', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: [{ id: 's1', type: 'screenshot', name: 'shot' }]
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.screenshots).toHaveLength(1)
    const saved = JSON.parse(await readFile(join(result.runDir, 'result.json'), 'utf8'))
    expect(saved.scenarioName).toBe('問い合わせフォーム')
    const cleanup = await readFile(join(result.runDir, 'cleanup.md'), 'utf8')
    expect(cleanup).toContain('後始末チェックリスト')
  }, 60_000)

  it('失敗したステップで止め、失敗時スクショを残す', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: [
          { id: 's1', type: 'fill', selector: '#company', value: '【テスト】株式会社' },
          { id: 's2', type: 'fill', label: '存在しない欄', selector: '#no-such-field', value: 'x' },
          { id: 's3', type: 'fill', selector: '#name', value: '到達しないはず' }
        ]
      }),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 2_000 }
    )

    expect(result.status).toBe('failed')
    expect(result.steps).toHaveLength(2)
    expect(result.steps[1]?.status).toBe('failed')
    expect(result.screenshots.some((p) => p.endsWith('failure.png'))).toBe(true)
    // 完了しなかった旨が後始末に載る
    expect(result.cleanup.some((c) => c.text.includes('途中まで送信'))).toBe(true)
  }, 60_000)

  it('optional なステップは失敗しても続行する', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: [
          { id: 's1', type: 'fill', label: '任意欄', selector: '#no-such-field', value: 'x', optional: true },
          { id: 's2', type: 'fill', label: '会社名', selector: '#company', value: '【テスト】株式会社' }
        ]
      }),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 2_000 }
    )

    expect(result.status).toBe('success')
    expect(result.steps[0]?.status).toBe('skipped')
    expect(result.steps[1]?.status).toBe('ok')
  }, 60_000)

  it('未定義の変数参照は実行前に落とす（空値を送らない）', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: [{ id: 's1', type: 'fill', selector: '#company', value: '{{var.undefined_key}}' }]
      }),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 2_000 }
    )

    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/変数が未定義/)
  }, 60_000)
})

describe('計測タグ検証（設計 §10）', () => {
  it('CVタグの発火を記録し、回数まで数える', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: submitFlow([
          { id: 's3', type: 'assertTracking', label: 'CV計測', provider: 'GA4', eventName: 'generate_lead', expectedCount: 1 }
        ])
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('success')
    const cv = result.trackingEvents.find((e) => e.eventName === 'generate_lead')
    expect(cv?.provider).toBe('GA4')
    expect(cv?.count).toBe(1)
  }, 90_000)

  it('重複発火を検出する（トリガー誤設定によるCV水増し）', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: submitFlow([
          { id: 's3', type: 'assertTracking', label: '1回だけ発火するはず', provider: 'GA4', eventName: 'page_view', expectedCount: 1 }
        ])
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/発火回数が想定と違います/)
    expect(result.error).toMatch(/水増し/)
    // 実際は2回飛んでいる
    expect(result.trackingEvents.find((e) => e.eventName === 'page_view')?.count).toBe(2)
  }, 90_000)

  it('タグが飛ばない場合は「計測されていない」と分かる形で落とす', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: [
          { id: 's1', type: 'assertTracking', provider: 'Meta', timeoutMs: 1_000 }
        ]
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/計測タグが発火していません/)
    expect(result.error).toMatch(/CVが計測されていない可能性/)
  }, 60_000)

  it('ページ遷移ごとに Cookie を記録する', async () => {
    const result = await run(
      scenario({
        stepDelayMs: 0,
        steps: submitFlow()
      }),
      { runsDir, launch: { headless: true }, trace: false }
    )

    expect(result.cookieSnapshots.length).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
