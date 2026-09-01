import type { CvtestApi } from './index'

declare global {
  interface Window {
    api: CvtestApi
  }
}

export {}
