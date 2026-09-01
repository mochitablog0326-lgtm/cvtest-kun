import { join } from 'node:path'
import type { ScreenshotStep } from '../../types/scenario'
import type { StepContext, StepDetail } from './context'

/** ファイル名に使えない文字を落とす。 */
function safeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80) || 'screenshot'
}

/**
 * スクショを撮る。
 * ローカルアプリなので容量を気にせず残す（設計 §12）。失敗調査が楽になる。
 */
export async function screenshot(step: ScreenshotStep, ctx: StepContext): Promise<StepDetail> {
  const path = join(ctx.runDir, `${safeName(step.name)}.png`)
  await ctx.page.screenshot({ path, fullPage: true })
  ctx.screenshots.push(path)
  return { path }
}
