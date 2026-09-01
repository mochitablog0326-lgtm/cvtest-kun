import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PRESETS,
  applyPreset,
  detectPreset,
  findPreset,
  verifySteps
} from '../src/presets/testcv'
import type { Field } from '../src/types/field'
import type { Step } from '../src/types/scenario'

const fields: Field[] = [
  { ref: 'f1', selector: '#company', label: '会社名', type: 'text', required: true, isHoneypot: false },
  { ref: 'f2', selector: '#name', label: 'お名前', type: 'text', required: true, isHoneypot: false },
  { ref: 'f3', selector: '#email', label: 'メールアドレス', type: 'email', required: true, isHoneypot: false },
  { ref: 'f4', selector: '#body', label: '詳細', type: 'textarea', required: false, isHoneypot: false }
]

describe('同梱プリセット', () => {
  it('スキーマ検証を通る', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(3)
    expect(BUILTIN_PRESETS.map((p) => p.id)).toContain('qualva')
    expect(BUILTIN_PRESETS.map((p) => p.id)).toContain('dairin')
  })

  it('自動削除される媒体とそうでない媒体を区別している', () => {
    expect(findPreset('qualva')?.cleanup.auto).toBe(true)
    expect(findPreset('dairin')?.cleanup.auto).toBe(false)
    expect(findPreset('dairin')?.cleanup.note).toContain('非承認')
  })

  it('qualva には途中離脱の警告が入っている', () => {
    expect(findPreset('qualva')?.warning).toContain('離脱')
  })
})

describe('detectPreset', () => {
  it('URLから媒体を判定する', () => {
    expect(detectPreset('https://lp.qualva.jp/form')?.id).toBe('qualva')
    expect(detectPreset('https://example.dairin.jp/entry')?.id).toBe('dairin')
  })

  it('該当しなければ undefined', () => {
    expect(detectPreset('https://example.com/contact')).toBeUndefined()
  })

  it('空の判定条件で誤検出しない', () => {
    // gunosy-ads は urlIncludes が空。全URLに当たってはいけない
    expect(detectPreset('https://example.com/')?.id).not.toBe('gunosy-ads')
  })
})

describe('applyPreset', () => {
  const qualva = findPreset('qualva')!

  it('姓名欄に「テスト」が無ければ自動で付与する', () => {
    const { values, applied } = applyPreset(
      { f1: '株式会社サンプル', f2: '山田太郎', f3: 'a@example.com' },
      fields,
      qualva
    )
    expect(values['f2']).toBe('テスト山田太郎')
    expect(applied.some((a) => a.ref === 'f2')).toBe(true)
  })

  it('既に含まれていれば触らない', () => {
    const { values, applied } = applyPreset({ f2: '【テスト】山田太郎' }, fields, qualva)
    expect(values['f2']).toBe('【テスト】山田太郎')
    expect(applied).toHaveLength(0)
  })

  it('「てすと」でも判定を満たす', () => {
    const { values } = applyPreset({ f2: 'てすと太郎' }, fields, qualva)
    expect(values['f2']).toBe('てすと太郎')
  })

  it('姓・名で分割されたフォームにも付与する', () => {
    const split: Field[] = [
      { ref: 'f1', selector: '#sei', label: '姓', type: 'text', required: true, isHoneypot: false },
      { ref: 'f2', selector: '#mei', label: '名', type: 'text', required: true, isHoneypot: false }
    ]
    const { values } = applyPreset({ f1: '山田', f2: '太郎' }, split, qualva)
    expect(values['f1']).toBe('テスト山田')
    expect(values['f2']).toBe('テスト太郎')
  })

  it('「会社名」を姓名欄と誤認しない', () => {
    const { values } = applyPreset(
      { f1: '株式会社サンプル', f4: 'お問い合わせ内容' },
      fields,
      qualva
    )
    expect(values['f1']).toBe('株式会社サンプル')
    expect(values['f4']).toBe('お問い合わせ内容')
  })

  it('emailSuffix ルールを適用する', () => {
    const preset = {
      ...qualva,
      rules: { ...qualva.rules, emailSuffix: '+test' }
    }
    const { values } = applyPreset({ f3: 'user@example.com' }, fields, preset)
    expect(values['f3']).toBe('user+test@example.com')
  })

  it('forceValues でラベル一致の項目を固定する', () => {
    const preset = {
      ...qualva,
      rules: { ...qualva.rules, forceValues: { 詳細: 'テスト送信です' } }
    }
    const { values, applied } = applyPreset({ f4: '本文' }, fields, preset)
    expect(values['f4']).toBe('テスト送信です')
    expect(applied.some((a) => a.ref === 'f4')).toBe(true)
  })

  it('真偽値（チェックボックス）は素通しする', () => {
    const { values } = applyPreset({ f2: 'テスト太郎', agree: true }, fields, qualva)
    expect(values['agree']).toBe(true)
  })
})

describe('verifySteps', () => {
  const qualva = findPreset('qualva')!

  const step = (over: Partial<Extract<Step, { type: 'fill' }>>): Step => ({
    id: 's1',
    type: 'fill',
    selector: '#name',
    label: 'お名前',
    value: '山田太郎',
    ...over
  })

  it('条件を満たさない値が残っていれば警告する', () => {
    const warnings = verifySteps([step({})], qualva)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('テスト')
    expect(warnings[0]).toContain('実際の成果として計上される可能性')
  })

  it('条件を満たしていれば警告しない', () => {
    expect(verifySteps([step({ value: '【テスト】山田太郎' })], qualva)).toHaveLength(0)
  })

  it('姓名欄が見つからない場合も警告する', () => {
    const warnings = verifySteps(
      [step({ selector: '#company', label: '会社名', value: 'サンプル社' })],
      qualva
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('見つかりませんでした')
  })

  it('ルールを持たない媒体は警告しない', () => {
    const gunosy = findPreset('gunosy-ads')!
    expect(verifySteps([step({})], gunosy)).toHaveLength(0)
  })
})
