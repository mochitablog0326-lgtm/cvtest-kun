import { CliProvider } from './cliBase'

/**
 * Gemini CLI をバックエンドに使う。プロンプトは stdin から渡す。
 *
 * 注意（設計 §6.5）: フラグはバージョンで変わる。動かない場合は
 * `gemini --help` で現行仕様を確認して buildArgs を直すこと。
 */
export function createGeminiCliProvider(model?: string): CliProvider {
  return new CliProvider({
    id: 'gemini-cli',
    label: 'Gemini CLI',
    command: 'gemini',
    buildArgs: () => (model ? ['--model', model] : []),
    useStdin: true,
    timeoutMs: 180_000
  })
}
