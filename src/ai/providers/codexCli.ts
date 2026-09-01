import { CliProvider } from './cliBase'

/**
 * OpenAI Codex CLI をバックエンドに使う。
 *
 * 注意（設計 §6.5）: `codex exec` はバージョンでフラグとJSON出力形式が変わる。
 * 動かない場合は `codex exec --help` で現行仕様を確認して buildArgs を直すこと。
 * ワークスペースのファイルを触りに行かないよう、サンドボックスを読み取り専用に絞る。
 */
export function createCodexCliProvider(model?: string): CliProvider {
  return new CliProvider({
    id: 'codex-cli',
    label: 'Codex CLI',
    command: 'codex',
    buildArgs: (prompt) => {
      const args = ['exec', '--sandbox', 'read-only']
      if (model) args.push('--model', model)
      args.push(prompt)
      return args
    },
    timeoutMs: 180_000
  })
}
