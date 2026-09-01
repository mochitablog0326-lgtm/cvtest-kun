import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { launch, type Session } from '../src/engine/browser'
import { extractFields, toCompact } from '../src/engine/extract'
import type { ExtractResult, Field } from '../src/types/field'

let session: Session
let result: ExtractResult

const byLabel = (label: string): Field | undefined =>
  result.fields.find((f) => f.label === label)
const byName = (name: string): Field | undefined => result.fields.find((f) => f.name === name)

beforeAll(async () => {
  session = await launch({ headless: true })
  const url = pathToFileURL(resolve(__dirname, 'fixtures/contact.html')).href
  await session.page.goto(url)
  result = await extractFields(session.page)
}, 60_000)

afterAll(async () => {
  await session?.close()
})

describe('extractFields', () => {
  it('ページ情報を取る', () => {
    expect(result.title).toBe('お問い合わせ | サンプル株式会社')
    expect(result.pageHeading).toBe('お問い合わせフォーム')
  })

  it('テーブルレイアウトの th からラベルを解決する', () => {
    expect(byName('company')?.label).toBe('会社名')
    expect(byName('name')?.label).toBe('お名前')
  })

  it('label[for] / 祖先 label からラベルを解決する', () => {
    expect(byName('email')?.label).toBe('メールアドレス')
    expect(byName('tel')?.label).toBe('電話番号')
  })

  it('「必須」バッジから required を拾う', () => {
    expect(byName('company')?.required).toBe(true)
    expect(byName('email')?.required).toBe(true)
    expect(byName('tel')?.required).toBe(false)
  })

  it('型を判定する', () => {
    expect(byName('email')?.type).toBe('email')
    expect(byName('tel')?.type).toBe('tel')
    expect(byName('subject')?.type).toBe('select')
    expect(byName('body')?.type).toBe('textarea')
    expect(byName('agree')?.type).toBe('checkbox')
  })

  it('select の options を取る', () => {
    expect(byName('subject')?.options?.map((o) => o.label)).toEqual([
      '選択してください',
      '料金について',
      '導入相談',
      'その他'
    ])
  })

  it('maxlength / pattern を取る', () => {
    expect(byName('body')?.maxLength).toBe(1000)
    expect(byName('tel')?.pattern).toBe('[0-9-]+')
  })

  it('radio を name 単位で1項目にまとめる', () => {
    const radio = byName('contact_method')
    expect(radio?.type).toBe('radio')
    expect(radio?.label).toBe('ご連絡方法')
    expect(radio?.options).toEqual([
      { label: 'メール', value: 'mail' },
      { label: '電話', value: 'phone' }
    ])
  })

  it('ハニーポットを検出する（hidden / display:none / 画面外 / 幅0）', () => {
    expect(byName('csrf_token')?.isHoneypot).toBe(true)
    expect(byName('website')?.isHoneypot).toBe(true)
    expect(byName('hp_field')?.isHoneypot).toBe(true)
    expect(byName('zerosize')?.isHoneypot).toBe(true)
    // 通常の項目は巻き込まない
    expect(byName('company')?.isHoneypot).toBe(false)
  })

  it('送信ボタンを b1 として取る', () => {
    const button = result.fields.find((f) => f.type === 'button')
    expect(button?.ref).toBe('b1')
    expect(button?.label).toBe('確認画面へ')
  })

  it('自動生成っぽい id はセレクタに使わない', () => {
    const note = byName('note')
    expect(note?.selector).not.toContain('css-1a2b3c4d')
    expect(note?.selector).toBe('input[name="note"]')
  })

  it('安定した id を name より優先する（設計 §5 の順序）', () => {
    expect(byName('company')?.selector).toBe('#company')
    expect(byName('subject')?.selector).toBe('#subject')
  })

  it('id が使えない項目は name に落ちる', () => {
    // note の id は "css-1a2b3c4d"（自動生成）なので name を使う
    expect(byName('note')?.selector).toBe('input[name="note"]')
    // radio はグループ全体を指す
    expect(byName('contact_method')?.selector).toBe('input[type="radio"][name="contact_method"]')
  })

  it('生成したセレクタが実際に一意に解決する', async () => {
    for (const f of result.fields) {
      if (f.selector.startsWith('internal:')) continue
      const count = await session.page.locator(f.selector).count()
      expect(count, `${f.label} (${f.selector})`).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('toCompact', () => {
  it('ハニーポットを除外した圧縮表現を返す', () => {
    const compact = toCompact(result.fields)
    expect(compact).toContain('label:"会社名" type:text required name:company')
    expect(compact).toContain('button:"確認画面へ"')
    expect(compact).toContain('options:["選択してください","料金について","導入相談","その他"]')
    expect(compact).not.toContain('csrf_token')
    expect(compact).not.toContain('hp_field')
    expect(compact).not.toContain('website')
  })

  it('セレクタを含めない（AIに渡さない）', () => {
    const compact = toCompact(result.fields)
    expect(compact).not.toContain('input[name=')
    expect(compact).not.toContain('#company')
  })
})
