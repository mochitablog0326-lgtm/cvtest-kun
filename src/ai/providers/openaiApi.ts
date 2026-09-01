import type { Field } from '../../types/field'
import { buildMessages } from '../prompt'
import { parseResponse, type AIProvider, type GeneratedValues, type PageContext } from '../provider'

export interface OpenAiConfig {
  apiKey?: string
  /** 既定 https://api.openai.com/v1。互換APIを使う場合に差し替える */
  baseUrl?: string
  model?: string
  timeoutMs?: number
}

/**
 * OpenAI 互換の Chat Completions API を使う。
 *
 * APIキーは safeStorage か環境変数から渡す。シナリオには直書きさせない（設計 §11）。
 */
export class OpenAiApiProvider implements AIProvider {
  readonly id = 'openai-api'
  readonly label = 'OpenAI API'

  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly apiKey: string | undefined

  constructor(config: OpenAiConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['OPENAI_API_KEY']
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    this.model = config.model ?? 'gpt-4o-mini'
    this.timeoutMs = config.timeoutMs ?? 120_000
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey)
  }

  async generateValues(fields: Field[], ctx: PageContext): Promise<GeneratedValues> {
    if (!this.apiKey) {
      throw new Error('OpenAI APIキーが設定されていません')
    }

    const { system, user } = buildMessages(fields, ctx)

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI API の呼び出しに失敗しました (${res.status}): ${body.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = json.choices?.[0]?.message?.content
    if (!text) {
      throw new Error('OpenAI API の返答が空でした')
    }

    return parseResponse(text, fields, this.id)
  }
}
