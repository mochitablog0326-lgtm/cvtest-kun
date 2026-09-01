import { describe, it, expect } from 'vitest'
import { expand, hasTemplate, referencedKeys } from '../src/engine/template'

// 2026-09-01 14:30:22 JST を固定の「今」にする（火曜日）
const NOW = new Date('2026-09-01T05:30:22.000Z')

describe('expand', () => {
  it('timestamp を JST で展開する', () => {
    expect(expand('{{timestamp}}', { now: NOW })).toBe('20260901143022')
  })

  it('today をフォーマット指定で展開する', () => {
    expect(expand('{{today|YYYY-MM-DD}}', { now: NOW })).toBe('2026-09-01')
  })

  it('today+7 を展開する', () => {
    expect(expand('{{today+7|YYYY-MM-DD}}', { now: NOW })).toBe('2026-09-08')
  })

  it('週・月単位のオフセットに対応する', () => {
    expect(expand('{{today+2w|YYYY-MM-DD}}', { now: NOW })).toBe('2026-09-15')
    expect(expand('{{today+1m|YYYY-MM-DD}}', { now: NOW })).toBe('2026-10-01')
    expect(expand('{{today-1|YYYY-MM-DD}}', { now: NOW })).toBe('2026-08-31')
  })

  it('nextMonday を展開する', () => {
    // 2026-09-01 は火曜。次の月曜は 9/7
    expect(expand('{{nextMonday|M/D}}', { now: NOW })).toBe('9/7')
  })

  it('今日が該当曜日なら翌週を返す', () => {
    const tuesday = new Date('2026-09-01T05:00:00.000Z')
    expect(expand('{{nextTuesday|YYYY-MM-DD}}', { now: tuesday })).toBe('2026-09-08')
  })

  it('random:N を指定長で返す', () => {
    const out = expand('{{random:6}}', { now: NOW })
    expect(out).toMatch(/^[a-z0-9]{6}$/)
  })

  it('env / secret / var を引く', () => {
    const ctx = {
      now: NOW,
      env: { PASSWORD: 'pw123' },
      secrets: { LOGIN_PW: 'sec' },
      variables: { company: 'サンプル社' }
    }
    expect(expand('{{env.PASSWORD}}', ctx)).toBe('pw123')
    expect(expand('{{secret.LOGIN_PW}}', ctx)).toBe('sec')
    expect(expand('{{var.company}}', ctx)).toBe('サンプル社')
  })

  it('メールアドレスの複合展開', () => {
    expect(expand('test+{{timestamp}}@example.com', { now: NOW })).toBe(
      'test+20260901143022@example.com'
    )
  })

  it('未定義の参照は例外にする（空値送信を防ぐ）', () => {
    expect(() => expand('{{env.NOPE}}', { now: NOW, env: {} })).toThrow(/環境変数/)
    expect(() => expand('{{var.nope}}', { now: NOW })).toThrow(/変数/)
    expect(() => expand('{{secret.nope}}', { now: NOW })).toThrow(/シークレット/)
  })

  it('未知の記法は例外にする', () => {
    expect(() => expand('{{bogus}}', { now: NOW })).toThrow(/解釈できません/)
  })

  it('テンプレートを含まない文字列はそのまま返す', () => {
    expect(expand('【テスト】山田太郎', { now: NOW })).toBe('【テスト】山田太郎')
  })

  it('実行マシンのTZに依存しない', () => {
    const prev = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // UTC 2026-09-01T20:00 は NY では 9/1 16:00 だが JST では 9/2 05:00
      const late = new Date('2026-09-01T20:00:00.000Z')
      expect(expand('{{today|YYYY-MM-DD}}', { now: late })).toBe('2026-09-02')
    } finally {
      process.env.TZ = prev
    }
  })
})

describe('hasTemplate / referencedKeys', () => {
  it('未展開のテンプレートを検出する', () => {
    expect(hasTemplate('{{today}}')).toBe(true)
    expect(hasTemplate('plain')).toBe(false)
  })

  it('参照キーを列挙する', () => {
    const keys = referencedKeys('{{env.A}} {{secret.B}} {{var.c}} {{today|YYYY}}')
    expect(keys).toEqual({ env: ['A'], secret: ['B'], var: ['c'] })
  })
})
