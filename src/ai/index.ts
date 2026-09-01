import type { Field } from '../types/field'
import { AiCache, cacheKey } from './cache'
import type { AIProvider, GeneratedValues, PageContext } from './provider'
import { createClaudeCodeProvider } from './providers/claudeCode'
import { createCodexCliProvider } from './providers/codexCli'
import { createGeminiCliProvider } from './providers/geminiCli'
import { OllamaProvider } from './providers/ollama'
import { OpenAiApiProvider } from './providers/openaiApi'

export * from './provider'
export * from './prompt'
export * from './cache'

export interface ProviderSettings {
  openai?: { apiKey?: string; baseUrl?: string; model?: string }
  ollama?: { baseUrl?: string; model?: string }
  claudeCode?: { model?: string }
  codex?: { model?: string }
  gemini?: { model?: string }
}

/** 利用可能な全プロバイダ。UIの選択肢になる。 */
export function allProviders(settings: ProviderSettings = {}): AIProvider[] {
  return [
    new OllamaProvider(settings.ollama),
    createClaudeCodeProvider(settings.claudeCode?.model),
    createCodexCliProvider(settings.codex?.model),
    createGeminiCliProvider(settings.gemini?.model),
    new OpenAiApiProvider(settings.openai)
  ]
}

export interface ProviderInfo {
  id: string
  label: string
  available: boolean
}

/** 各プロバイダが今使えるかを一覧にする。 */
export async function listProviders(settings: ProviderSettings = {}): Promise<ProviderInfo[]> {
  const providers = allProviders(settings)
  return Promise.all(
    providers.map(async (p) => ({
      id: p.id,
      label: p.label,
      available: await p.isAvailable().catch(() => false)
    }))
  )
}

export function findProvider(
  id: string,
  settings: ProviderSettings = {}
): AIProvider | undefined {
  return allProviders(settings).find((p) => p.id === id)
}

export interface GenerateOptions {
  cacheDir?: string
  /** キャッシュを無視して生成し直す */
  refresh?: boolean
}

/**
 * 値を生成する。キャッシュがあればそれを返す（設計 §6.6）。
 *
 * 生成しただけでは何も実行されない。UIでレビューしてから実行する
 * ── 「生成」と「実行」のボタンを分ける設計（§11）の土台。
 */
export async function generateValues(
  provider: AIProvider,
  fields: Field[],
  ctx: PageContext,
  options: GenerateOptions = {}
): Promise<GeneratedValues & { fromCache: boolean }> {
  const cache = options.cacheDir ? new AiCache(options.cacheDir) : undefined
  const key = cacheKey(ctx.url, fields, provider.id)

  if (cache && !options.refresh) {
    const hit = await cache.get(key)
    if (hit) return { ...hit, fromCache: true }
  }

  const result = await provider.generateValues(fields, ctx)
  if (cache) await cache.set(key, ctx.url, result)

  return { ...result, fromCache: false }
}
