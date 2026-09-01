import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli/index'
import { startServer, type TestServer } from './helpers/server'

let server: TestServer
let dir: string

beforeAll(async () => {
  server = await startServer()
  dir = await mkdtemp(join(tmpdir(), 'cvtest-cli-'))
}, 30_000)

afterAll(async () => {
  await server?.close()
})

/** 標準出力を捕まえて中身を検査する。 */
async function capture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    out += args.join(' ') + '\n'
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    err += args.join(' ') + '\n'
  })
  try {
    const code = await main(argv)
    return { code, out, err }
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
}

async function writeScenario(name: string, scenario: unknown): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, JSON.stringify(scenario, null, 2), 'utf8')
  return path
}

describe('cvtest CLI', () => {
  it('ヘルプを出す', async () => {
    const { code, out } = await capture([])
    expect(code).toBe(0)
    expect(out).toContain('cvtest run <scenario.json>')
    // 実送信する旨の警告を必ず載せる
    expect(out).toContain('実際にフォームを送信します')
  })

  it('バージョンを出す', async () => {
    const { code, out } = await capture(['--version'])
    expect(code).toBe(0)
    expect(out.trim()).toBe('0.1.0')
  })

  it('プリセット一覧を出す', async () => {
    const { code, out } = await capture(['presets'])
    expect(code).toBe(0)
    expect(out).toContain('qualva')
    expect(out).toContain('後始末: 手動が必要')
  })

  it('不明なコマンドは終了コード2', async () => {
    const { code } = await capture(['bogus'])
    expect(code).toBe(2)
  })

  it('不明なオプションを例外にする', async () => {
    await expect(main(['run', 'x.json', '--nope'])).rejects.toThrow(/不明なオプション/)
  })

  it('シナリオの形式エラーを項目付きで知らせる', async () => {
    const path = await writeScenario('bad.json', { version: 1, name: '', url: 'not-a-url', steps: [] })
    await expect(main(['validate', path])).rejects.toThrow(/シナリオの形式が正しくありません/)
  })

  it('壊れたJSONを分かる形で落とす', async () => {
    const path = join(dir, 'broken.json')
    await writeFile(path, '{ not json', 'utf8')
    await expect(main(['validate', path])).rejects.toThrow(/JSON として読めません/)
  })

  it('正しいシナリオを検証できる', async () => {
    const path = await writeScenario('ok.json', {
      version: 1,
      name: 'テスト',
      url: `${server.origin}/contact.html`,
      steps: [{ id: 's1', type: 'fill', selector: '#company', value: 'x' }],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    })
    const { code, out } = await capture(['validate', path])
    expect(code).toBe(0)
    expect(out).toContain('OK: テスト')
    expect(out).toContain('ステップ数: 1')
  })

  it('run が成功すると終了コード0', async () => {
    const path = await writeScenario('run-ok.json', {
      version: 1,
      name: '送信テスト',
      url: `${server.origin}/contact.html`,
      stepDelayMs: 0,
      steps: [
        { id: 's1', type: 'fill', label: '会社名', selector: '#company', value: '【テスト】株式会社' },
        { id: 's2', type: 'screenshot', name: 'shot' }
      ],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    })
    const { code, out } = await capture(['run', path, '--headless', '--no-trace', '--out', dir])
    expect(code).toBe(0)
    expect(out).toContain('結果: success')
    expect(out).toContain('計測タグの発火は検出されませんでした')
  }, 90_000)

  it('run が失敗すると終了コード1', async () => {
    const path = await writeScenario('run-ng.json', {
      version: 1,
      name: '失敗テスト',
      url: `${server.origin}/contact.html`,
      stepDelayMs: 0,
      steps: [{ id: 's1', type: 'fill', selector: '#no-such', value: 'x' }],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    })
    const { code, out } = await capture([
      'run', path, '--headless', '--no-trace', '--out', dir, '--timeout', '2000'
    ])
    expect(code).toBe(1)
    expect(out).toContain('結果: failed')
  }, 90_000)

  it('--json で機械可読な結果を出す', async () => {
    const path = await writeScenario('run-json.json', {
      version: 1,
      name: 'JSON出力',
      url: `${server.origin}/contact.html`,
      stepDelayMs: 0,
      steps: [{ id: 's1', type: 'fill', selector: '#company', value: 'x' }],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    })
    const { code, out } = await capture(['run', path, '--headless', '--no-trace', '--json', '--out', dir])
    expect(code).toBe(0)
    const parsed = JSON.parse(out)
    expect(parsed.status).toBe('success')
    expect(parsed.scenarioName).toBe('JSON出力')
  }, 90_000)

  it('extract で項目一覧を出す', async () => {
    const { code, out } = await capture([
      'extract', `${server.origin}/contact.html`, '--headless'
    ])
    expect(code).toBe(0)
    expect(out).toContain('label:"会社名"')
    expect(out).toContain('ハニーポットとして除外')
  }, 90_000)
})
