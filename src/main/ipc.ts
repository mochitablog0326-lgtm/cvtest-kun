import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Scenario } from '../types/scenario'
import type { Field } from '../types/field'
import { launch, type Session } from '../engine/browser'
import { extractFields } from '../engine/extract'
import { startPicker, stopPicker, buildAvailableRule, type PickedElement } from '../engine/picker'
import { run } from '../engine/runner'
import { buildSteps } from '../engine/buildSteps'
import {
  listProviders,
  findProvider,
  generateValues,
  type ProviderSettings
} from '../ai'
import {
  BUILTIN_PRESETS,
  applyPreset,
  detectPreset,
  findPreset,
  presetsSchema,
  type TestCvPreset
} from '../presets/testcv'
import { Store } from './store'
import { SecretStore } from './secrets'

/** ブラウザセッションと実行状態を1つに束ねる。 */
class AppState {
  session: Session | undefined
  aborting = false
  running = false
  /** ピッカーで選ばれた最後の要素。空き判定の学習に使う */
  lastPicks: PickedElement[] = []

  async closeSession(): Promise<void> {
    await this.session?.close()
    this.session = undefined
  }
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** 例外を必ず {ok,...} 形に畳む。renderer 側で扱いやすくする。 */
type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await fn(...(args as never[]))
      return { ok: true, data } satisfies Result<T>
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      } satisfies Result<T>
    }
  })
}

export function registerIpc(): void {
  const store = new Store()
  const secrets = new SecretStore()
  const state = new AppState()

  const allPresets = async (): Promise<TestCvPreset[]> => {
    const user = await store.loadUserPresets()
    const parsed = presetsSchema.safeParse(user)
    return parsed.success ? [...BUILTIN_PRESETS, ...parsed.data] : BUILTIN_PRESETS
  }

  const providerSettings = async (): Promise<ProviderSettings> => {
    const secretValues = await secrets.all()
    return {
      openai: { apiKey: secretValues['OPENAI_API_KEY'] }
    }
  }

  // --- config ---
  handle('config:load', () => store.loadConfig())
  handle('config:save', (config: Partial<Awaited<ReturnType<Store['loadConfig']>>>) =>
    store.saveConfig(config)
  )

  // --- scenario ---
  handle('scenario:list', () => store.list())
  handle('scenario:load', (path: string) => store.load(path))
  handle('scenario:save', (scenario: Scenario, path?: string) => store.save(scenario, path))
  handle('scenario:delete', async (path: string) => {
    await store.assertInScenarioDir(path)
    await store.remove(path)
    return true
  })
  handle('scenario:chooseDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'シナリオの保存先を選ぶ',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return undefined
    await store.saveConfig({ scenarioDir: result.filePaths[0] })
    return result.filePaths[0]
  })

  // --- browser ---
  handle('browser:open', async (url: string) => {
    const config = await store.loadConfig()
    if (!state.session) {
      state.session = await launch({
        headless: false,
        channel: config.browserChannel
      })
      state.session.page.on('close', () => {
        state.session = undefined
      })
    }
    await state.session.page.goto(url, { waitUntil: 'domcontentloaded' })
    return state.session.page.url()
  })

  handle('browser:close', async () => {
    await state.closeSession()
    return true
  })

  handle('browser:screenshot', async () => {
    if (!state.session) throw new Error('ブラウザが開かれていません')
    const buffer = await state.session.page.screenshot({ type: 'png' })
    return `data:image/png;base64,${buffer.toString('base64')}`
  })

  // --- picker ---
  handle('picker:start', async () => {
    if (!state.session) throw new Error('ブラウザが開かれていません')
    state.lastPicks = []
    await startPicker(state.session.page, (picked) => {
      state.lastPicks.push(picked)
      send('picker:selected', picked)
    })
    return true
  })

  handle('picker:stop', async () => {
    if (state.session) await stopPicker(state.session.page)
    return true
  })

  /** 空き枠と満席枠の2要素からルールを学習する（設計 §7）。 */
  handle('picker:learnRule', (available: PickedElement, full: PickedElement) =>
    buildAvailableRule(available, full)
  )

  // --- extract ---
  handle('extract:fields', async () => {
    if (!state.session) throw new Error('ブラウザが開かれていません')
    return extractFields(state.session.page)
  })

  // --- ai ---
  handle('ai:listProviders', async () => listProviders(await providerSettings()))

  handle(
    'ai:generate',
    async (payload: {
      providerId: string
      fields: Field[]
      ctx: { url: string; title: string; pageHeading?: string; purpose?: string }
      presetId?: string
      refresh?: boolean
    }) => {
      const provider = findProvider(payload.providerId, await providerSettings())
      if (!provider) throw new Error(`不明なプロバイダ: ${payload.providerId}`)

      const generated = await generateValues(provider, payload.fields, payload.ctx, {
        cacheDir: store.cacheDir,
        refresh: payload.refresh
      })

      // 媒体プリセットのルールを後段で強制適用する（設計 §11.1）
      const presets = await allPresets()
      const preset =
        (payload.presetId ? findPreset(payload.presetId, presets) : undefined) ??
        detectPreset(payload.ctx.url, presets)

      if (!preset) return { ...generated, presetId: undefined, presetApplied: [] }

      const { values, applied } = applyPreset(generated.values, payload.fields, preset)
      return {
        ...generated,
        values,
        presetId: preset.id,
        presetApplied: applied,
        notes: [...generated.notes, ...applied.map((a) => a.reason)]
      }
    }
  )

  /** 生成された値をステップに変換する。実行はしない（設計 §11 の生成/実行分離）。 */
  handle(
    'ai:toSteps',
    (payload: {
      fields: Field[]
      values: Record<string, string | boolean>
      submit?: string
    }) => buildSteps(payload.fields, payload.values, { submit: payload.submit, screenshots: true })
  )

  // --- presets ---
  handle('presets:list', () => allPresets())
  handle('presets:detect', async (url: string) => detectPreset(url, await allPresets()))

  // --- run ---
  handle('run:start', async (scenario: Scenario) => {
    if (state.running) throw new Error('すでに実行中です')

    state.running = true
    state.aborting = false

    // 録画用のブラウザとは別セッションで実行する。
    // ピッカーが注入されたページで実送信すると挙動が読めないため。
    try {
      const config = await store.loadConfig()
      const result = await run(scenario, {
        runsDir: store.runsDir,
        presets: await allPresets(),
        launch: { headless: config.headless ?? false, channel: config.browserChannel },
        stepDelayMs: config.stepDelayMs,
        template: { env: process.env, secrets: await secrets.all() },
        onStep: (step) => send('run:step', step),
        onLog: (message) => send('run:log', message),
        shouldAbort: () => state.aborting
      })
      send('run:finished', result)
      return result
    } finally {
      state.running = false
    }
  })

  handle('run:abort', () => {
    state.aborting = true
    return true
  })

  handle('run:list', () => store.listRuns())
  handle('run:load', (dir: string) => store.loadRunResult(dir))
  handle('run:reveal', (dir: string) => {
    shell.openPath(dir)
    return true
  })
  handle('run:openTrace', (dir: string) => {
    shell.showItemInFolder(join(dir, 'trace.zip'))
    return true
  })

  // --- secrets ---
  handle('secrets:set', async (key: string, value: string) => {
    await secrets.set(key, value)
    return true
  })
  handle('secrets:has', (key: string) => secrets.has(key))
  handle('secrets:keys', () => secrets.keys())
  handle('secrets:delete', async (key: string) => {
    await secrets.delete(key)
    return true
  })
  handle('secrets:available', () => secrets.isEncryptionAvailable())
}
