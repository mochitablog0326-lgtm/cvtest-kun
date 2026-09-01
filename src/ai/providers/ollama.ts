import type { Field } from '../../types/field'
import { buildMessages } from '../prompt'
import { parseResponse, type AIProvider, type GeneratedValues, type PageContext } from '../provider'

export interface OllamaConfig {
  /** 既定 http://127.0.0.1:11434 */
  baseUrl?: string
  model?: string
  timeoutMs?: number
}

/**
 * ローカルの Ollama を使う。
 *
 * 社内フォームなど、DOM情報を外部に出せないケース向け（設計 §6.5）。
 * これを入れておくと「解析も外部に出さない」構成が取れる。
 */
export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  readonly label = 'Ollama（ローカル）'

  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = config.model ?? 'qwen2.5:7b'
    this.timeoutMs = config.timeoutMs ?? 180_000
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2_000)
      })
      return res.ok
    } catch {
      return false
    }
  }

  async generateValues(fields: Field[], ctx: PageContext): Promise<GeneratedValues> {
    const { system, user } = buildMessages(fields, ctx)

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        // JSON で返させる。小さいモデルでも形式が安定する
        format: 'json',
        options: { temperature: 0.3 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })

    if (!res.ok) {
      throw new Error(`Ollama の呼び出しに失敗しました (${res.status}): ${await res.text()}`)
    }

    const json = (await res.json()) as { message?: { content?: string } }
    const text = json.message?.content
    if (!text) {
      throw new Error('Ollama の返答が空でした')
    }

    return parseResponse(text, fields, this.id)
  }
}
