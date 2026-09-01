import { contextBridge, ipcRenderer } from 'electron'

/**
 * 埋め込みブラウザで開く「対象ページ」用の preload。
 *
 * 対象ページは第三者のサイトであり信用できない。ここで公開するのは
 * ピッカーの通知窓口ひとつだけに絞る。Node の機能は一切渡さない。
 * 受け取った値は main 側でスキーマ検証してから使う。
 */
contextBridge.exposeInMainWorld('__cvtestPick', (payload: unknown) => {
  ipcRenderer.send('cvtest:picked', payload)
})
