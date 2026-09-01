import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/** main 側の handle() が返す形。 */
import type { PickedElement } from '../types/picker'
import type { NavState } from '../types/browser'
import type { RunResult, StepResult } from '../types/result'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * 失敗を例外に戻す。renderer 側は try/catch で書ける。
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** main → renderer のイベント購読。解除関数を返す。 */
function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(args[0] as T)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.off(channel, wrapped)
  }
}

const api = {
  config: {
    load: () => invoke('config:load'),
    save: (config: unknown) => invoke('config:save', config)
  },
  scenario: {
    list: () => invoke('scenario:list'),
    load: (path: string) => invoke('scenario:load', path),
    save: (scenario: unknown, path?: string) => invoke('scenario:save', scenario, path),
    delete: (path: string) => invoke('scenario:delete', path),
    chooseDir: () => invoke('scenario:chooseDir')
  },
  browser: {
    open: (url: string) => invoke('browser:open', url),
    close: () => invoke('browser:close'),
    screenshot: () => invoke('browser:screenshot'),
    /** 埋め込みビューの表示位置。renderer 側のプレースホルダの座標を渡す */
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      invoke('browser:setBounds', bounds),
    setVisible: (visible: boolean) => invoke('browser:setVisible', visible),
    back: () => invoke('browser:back'),
    forward: () => invoke('browser:forward'),
    reload: () => invoke('browser:reload'),
    startPicker: () => invoke('picker:start'),
    stopPicker: () => invoke('picker:stop'),
    learnRule: (available: unknown, full: unknown) =>
      invoke('picker:learnRule', available, full)
  },
  extract: {
    fields: () => invoke('extract:fields')
  },
  ai: {
    listProviders: () => invoke('ai:listProviders'),
    generate: (payload: unknown) => invoke('ai:generate', payload),
    toSteps: (payload: unknown) => invoke('ai:toSteps', payload)
  },
  presets: {
    list: () => invoke('presets:list'),
    detect: (url: string) => invoke('presets:detect', url)
  },
  run: {
    start: (scenario: unknown) => invoke('run:start', scenario),
    abort: () => invoke('run:abort'),
    list: () => invoke('run:list'),
    load: (dir: string) => invoke('run:load', dir),
    reveal: (dir: string) => invoke('run:reveal', dir),
    openTrace: (dir: string) => invoke('run:openTrace', dir)
  },
  secrets: {
    set: (key: string, value: string) => invoke('secrets:set', key, value),
    has: (key: string) => invoke('secrets:has', key),
    keys: () => invoke('secrets:keys'),
    delete: (key: string) => invoke('secrets:delete', key),
    available: () => invoke('secrets:available')
  },
  events: {
    onPickerSelected: (fn: (payload: PickedElement) => void) => on('picker:selected', fn),
    onBrowserNav: (fn: (payload: NavState) => void) => on('browser:nav', fn),
    /** ページ側でピッカーが解除された（ESC等）ときにUIを同期する */
    onPickerState: (fn: (active: boolean) => void) => on('picker:state', fn),
    onRunStep: (fn: (payload: StepResult) => void) => on('run:step', fn),
    onRunLog: (fn: (payload: string) => void) => on('run:log', fn),
    onRunFinished: (fn: (payload: RunResult) => void) => on('run:finished', fn)
  }
}

export type CvtestApi = typeof api

contextBridge.exposeInMainWorld('api', api)
