import { CliProvider } from './cliBase'

/**
 * Claude Code CLI をバックエンドに使う。
 *
 * フラグは `claude --help` で確認済み（--print / --output-format json）。
 * バージョンで変わりうるので、動かなくなったら再確認すること（設計 §6.5）。
 *
 * `--output-format json` の戻りは { result: "<本文>" , ... } の形。
 */
export function createClaudeCodeProvider(model?: string): CliProvider {
  return new CliProvider({
    id: 'claude-code',
    label: 'Claude Code CLI',
    command: 'claude',
    buildArgs: (prompt) => {
      const args = ['--print', '--output-format', 'json']
      if (model) args.push('--model', model)
      args.push(prompt)
      return args
    },
    extractText: (stdout) => {
      try {
        const parsed = JSON.parse(stdout) as { result?: unknown }
        if (typeof parsed.result === 'string') return parsed.result
      } catch {
        // JSON でなければ素のテキストとして扱う
      }
      return stdout
    },
    timeoutMs: 180_000
  })
}
