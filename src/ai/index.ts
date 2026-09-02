import type { Field } from '../types/field'
import { AiCache, cacheKey } from './cache'
import type { AIProvider, GeneratedValues, PageContext } from './provider'
import { createCodexCliProvider } from './providers/codexCli'

export * from './provider'
export * from './prompt'
export * from './cache'

export interface ProviderSettings {
  codex?: { model?: string }
}

/**
 * 利用できるプロバイダ。現在は Codex CLI のみ。
 *
 * 抽象（AIProvider）は残してあるので、増やしたくなったらここに足すだけでよい。
 */
export function allProviders(settings: ProviderSettings = {}): AIProvider[] {
  return [createCodexCliProvider(settings.codex?.model)]
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
