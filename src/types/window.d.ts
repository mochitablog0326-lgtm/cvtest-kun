import type { CvtestApi } from '../preload/index'

/**
 * preload が contextBridge で公開する API の型。
 *
 * ファイル名を index.d.ts にすると、同名の index.ts の出力物とみなされて
 * TypeScript のプロジェクトから自動で外れてしまうため、ここに置いている。
 */
declare global {
  interface Window {
    api: CvtestApi
  }
}

export {}
