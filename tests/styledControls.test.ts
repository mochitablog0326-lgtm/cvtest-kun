import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Session } from '../src/engine/browser'
import { extractFields, toCompact } from '../src/engine/extract'
import { startPicker, stopPicker, type PickedElement } from '../src/engine/picker'
import { buildSteps } from '../src/engine/buildSteps'
import { run } from '../src/engine/runner'
import type { ExtractResult, Field } from '../src/types/field'
import type { Scenario } from '../src/types/scenario'
import { startServer, type TestServer } from './helpers/server'

/**
 * 実体の input を display:none で隠し、ラベル側を装飾するフォーム。
 * 日本のLPで非常に多く、ここが壊れると同意チェックなどが黙って入力されない。
 */
let server: TestServer
let session: Session
let result: ExtractResult
let runsDir: string

const byName = (name: string): Field | undefined =>
  result.fields.find((f) => f.name === name)

beforeAll(async () => {
  server = await startServer()
  runsDir = await mkdtemp(join(tmpdir(), 'cvtest-styled-'))
  session = await launch({ headless: true })
  await session.page.goto(`${server.origin}/styled-controls.html`)
  result = await extractFields(session.page)
}, 60_000)

afterAll(async () => {
  await session?.close()
  await server?.close()
})

describe('抽出（装飾されたラジオ・チェックボックス）', () => {
  it('見えるラベルを持つ隠れたラジオはハニーポットにしない', () => {
    const gender = byName('gender')
    expect(gender?.type).toBe('radio')
    expect(gender?.isHoneypot).toBe(false)
  })

  it('見えるラベルを持つ隠れたチェックボックスもハニーポットにしない', () => {
    const agree = byName('agree')
    expect(agree?.type).toBe('checkbox')
    expect(agree?.isHoneypot).toBe(false)
    expect(agree?.label).toBe('個人情報の取扱いに同意する')
  })

  it('本物のハニーポットは従来どおり除外する', () => {
    // ラベルを持たない画面外の入力欄
    expect(byName('website')?.isHoneypot).toBe(true)
    // display:none のコンテナに入った入力欄
    expect(byName('trap')?.isHoneypot).toBe(true)
  })

  it('ラジオの選択肢を取れる', () => {
    expect(byName('gender')?.options?.map((o) => o.value)).toEqual([
      '男性',
      '女性',
      '回答しない'
    ])
  })

  it('AIに渡す表現に同意チェックが含まれる', () => {
    const compact = toCompact(result.fields)
    expect(compact).toContain('個人情報の取扱いに同意する')
    expect(compact).not.toContain('website')
    expect(compact).not.toContain('trap')
  })

  it('HTMLコメントをラベルとして拾わない', () => {
    // website の直前にはコメントがあるが、ラベルにしてはいけない
    expect(byName('website')?.label ?? '').not.toContain('ハニーポット')
  })
})

describe('ピッカー（ラベルを押したとき）', () => {
  const picks: PickedElement[] = []

  beforeAll(async () => {
    await session.page.goto(`${server.origin}/styled-controls.html`)
    await startPicker(session.page, (p) => picks.push(p))
    // 実体の input は display:none。人間が押せるのはラベル側だけ
    await session.page.evaluate(`document.querySelectorAll('label.wrap')[0].click()`)
    await session.page.waitForTimeout(200)
  }, 30_000)

  afterAll(async () => {
    await stopPicker(session.page)
  })

  it('押されたラベルではなく、対応する input を対象にする', () => {
    expect(picks).toHaveLength(1)
    expect(picks[0]?.tagName).toBe('input')
    expect(picks[0]?.inputType).toBe('radio')
  })

  it('値まで絞り込んだセレクタを作る', () => {
    expect(picks[0]?.selector).toBe('input[name="gender"][value="回答しない"]')
  })
})

describe('実行（隠れたラジオ・チェックボックス）', () => {
  const scenario = (steps: Scenario['steps']): Scenario => ({
    version: 1,
    name: '装飾コントロール',
    url: `${server.origin}/styled-controls.html`,
    stepDelayMs: 0,
    steps,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  })

  it('display:none のラジオをラベル経由で選択できる', async () => {
    const result = await run(
      scenario([
        {
          id: 's1',
          type: 'check',
          label: '回答しない',
          selector: 'input[name="gender"][value="回答しない"]',
          checked: true
        },
        {
          id: 's2',
          type: 'assert',
          label: '選択されたことを確認',
          selector: 'input[name="gender"][value="回答しない"]:checked',
          mode: 'visible'
        }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 8_000 }
    )

    // :checked の要素自体は不可視なので assert(visible) は通らない。
    // check ステップ自体が成功していることを detail で確認する
    expect(result.steps[0]?.status).toBe('ok')
    expect(result.steps[0]?.detail).toMatchObject({ checked: true, changed: true })
  }, 60_000)

  it('display:none の同意チェックを入れられる', async () => {
    const result = await run(
      scenario([
        { id: 's1', type: 'check', label: '同意', selector: 'input[name="agree"]', checked: true }
      ]),
      { runsDir, launch: { headless: true }, trace: false, timeoutMs: 8_000 }
    )

    expect(result.status).toBe('success')
    expect(result.steps[0]?.detail).toMatchObject({ checked: true })
  }, 60_000)

  it('抽出した項目からラジオのステップを組み立てて実行できる', async () => {
    const steps = buildSteps(result.fields, { [byName('gender')!.ref]: '回答しない' })
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      type: 'check',
      selector: 'input[type="radio"][name="gender"][value="回答しない"]',
      checked: true
    })

    const runResult = await run(scenario(steps), {
      runsDir,
      launch: { headless: true },
      trace: false,
      timeoutMs: 8_000
    })
    expect(runResult.status).toBe('success')
  }, 60_000)
})
