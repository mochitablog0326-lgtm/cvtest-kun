import { spawn } from 'node:child_process'
import type { Field } from '../../types/field'
import { buildMessages } from '../prompt'
import { parseResponse, type AIProvider, type GeneratedValues, type PageContext } from '../provider'

export interface CliProviderConfig {
  id: string
  label: string
  /** 実行ファイル名。PATH から探す */
  command: string
  /** プロンプトを渡す引数を組み立てる */
  buildArgs(prompt: string): string[]
  /** プロンプトを stdin から渡す場合は true */
  useStdin?: boolean
  /** CLI の JSON 出力から本文を取り出す。省略時は stdout をそのまま使う */
  extractText?(stdout: string): string
  /** 実行時に足す環境変数 */
  env?: Record<string, string>
  timeoutMs?: number
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}

export function runCommand(
  command: string,
  args: string[],
  opts: { input?: string; env?: Record<string, string>; timeoutMs?: number; cwd?: string } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...opts.env },
      // コーディングエージェントがワークスペースのファイルを触りに行かないよう、
      // 作業ディレクトリを明示的に絞る（設計 §6.5）
      cwd: opts.cwd ?? process.env['TMPDIR'] ?? '/tmp',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`${command} がタイムアウトしました（${opts.timeoutMs ?? 120_000}ms）`))
    }, opts.timeoutMs ?? 120_000)

    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })

    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
  })
}

/** PATH に実行ファイルがあるか。 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await runCommand(process.platform === 'win32' ? 'where' : 'which', [command], {
      timeoutMs: 5_000
    })
    return result.code === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * CLI 系プロバイダの共通実装。
 *
 * 注意（設計 §6.5）:
 * - CLI のフラグと JSON 出力形式はバージョンで変わる。動かない場合は
 *   `<command> --help` で現行仕様を確認して buildArgs を直すこと。
 * - サブスク認証を他アプリのバックエンドとして使えるかは各サービスの規約次第。
 *   利用は各自の責任で。
 */
export class CliProvider implements AIProvider {
  readonly id: string
  readonly label: string

  constructor(private readonly config: CliProviderConfig) {
    this.id = config.id
    this.label = config.label
  }

  async isAvailable(): Promise<boolean> {
    return commandExists(this.config.command)
  }

  async generateValues(fields: Field[], ctx: PageContext): Promise<GeneratedValues> {
    const { system, user } = buildMessages(fields, ctx)
    const prompt = `${system}\n\n---\n\n${user}`

    const result = await runCommand(
      this.config.command,
      this.config.buildArgs(prompt),
      {
        input: this.config.useStdin ? prompt : undefined,
        env: this.config.env,
        timeoutMs: this.config.timeoutMs
      }
    )

    if (result.code !== 0) {
      throw new Error(
        `${this.config.label} の実行に失敗しました (exit ${result.code}): ${result.stderr.slice(0, 500)}`
      )
    }

    const text = this.config.extractText
      ? this.config.extractText(result.stdout)
      : result.stdout

    return parseResponse(text, fields, this.id)
  }
}
