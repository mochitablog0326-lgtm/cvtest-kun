import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Scenario } from '../types/scenario'
import type { Field } from '../types/field'
import { buildAvailableRule } from '../engine/picker'
import { EmbeddedBrowser, type Bounds } from './embedded'
import type { PickedElement } from '../types/picker'
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

/** 実行状態をまとめる。録画用ブラウザは EmbeddedBrowser 側が持つ。 */
class AppState {
  aborting = false
  running = false
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
    const config = await store.loadConfig()
    return { codex: { model: config.aiModel } }
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

  // --- browser（アプリ内に埋め込んだビュー） ---
  //
  // 録画・ピッカー・項目抽出はこの埋め込みビューで行う。
  // 実行だけは Playwright のまま（設計 §2 の理由は変わっていない）。
  let embedded: EmbeddedBrowser | undefined

  const browser = (): EmbeddedBrowser => {
    if (embedded) return embedded
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('ウィンドウがありません')

    embedded = new EmbeddedBrowser(
      win,
      (picked) => send('picker:selected', picked),
      (navState) => send('browser:nav', navState),
      (active) => send('picker:state', active)
    )
    return embedded
  }

  // 対象ページ（信用できない）からのピック通知。検証は EmbeddedBrowser 側で行う
  ipcMain.on('cvtest:picked', (_event, payload: unknown) => {
    embedded?.handlePicked(payload)
  })

  ipcMain.on('cvtest:picker-state', (_event, payload: unknown) => {
    embedded?.handlePickerState(payload)
  })

  handle('browser:open', (url: string) => browser().open(url))
  handle('browser:setBounds', (bounds: Bounds) => {
    browser().setBounds(bounds)
    return true
  })
  handle('browser:setVisible', (visible: boolean) => {
    if (embedded) embedded.setVisible(visible)
    return true
  })
  handle('browser:back', () => browser().goBack().then(() => true))
  handle('browser:forward', () => browser().goForward().then(() => true))
  handle('browser:reload', () => browser().reload().then(() => true))
  handle('browser:screenshot', () => browser().screenshot())

  handle('browser:close', () => {
    embedded?.destroy()
    embedded = undefined
    return true
  })

  // --- picker ---
  handle('picker:start', () => browser().startPicker().then(() => true))
  handle('picker:stop', () => browser().stopPicker().then(() => true))

  /** 空き枠と満席枠の2要素からルールを学習する（設計 §7）。 */
  handle('picker:learnRule', (available: PickedElement, full: PickedElement) =>
    buildAvailableRule(available, full)
  )

  // --- extract ---
  handle('extract:fields', () => browser().extractFields())

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
