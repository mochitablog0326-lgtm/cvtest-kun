import type { Locator } from 'playwright-core'
import type { Step } from '../../types/scenario'
import type { StepContext } from './context'

/** `internal:` は Playwright の内部記法。人に見せるときは言い換える。 */
export function describeSelector(selector: string): string {
  const label = /^internal:label=(.+)s$/.exec(selector)
  if (label) return `ラベル ${label[1]}`
  const role = /^internal:role=([a-z]+)\[name=(.+)s\]$/.exec(selector)
  if (role) return `${role[1]} ${role[2]}`
  return selector
}

function stepName(step: Step): string {
  return step.label ?? step.type
}

/**
 * 要素を待つ。失敗したら何が起きたのかを日本語で伝える。
 *
 * 素の TimeoutError では「セレクタが違う」のか「まだ表示されていない」のか
 * 区別できず、次に何をすればよいか分からない。件数を見て切り分ける。
 */
export async function waitForTarget(
  locator: Locator,
  state: 'visible' | 'attached',
  ctx: StepContext,
  step: Step,
  selector: string
): Promise<void> {
  try {
    await locator.waitFor({ state, timeout: ctx.timeoutMs })
    return
  } catch {
    // 下で理由を切り分ける
  }

  const count = await locator.page().locator(selector).count().catch(() => 0)
  const name = stepName(step)
  const shown = describeSelector(selector)

  if (count === 0) {
    throw new Error(
      `「${name}」の対象が見つかりません（${shown}）。` +
        'ページの作りが変わったか、セレクタが正しくない可能性があります。' +
        '編集画面の「取直」で選び直してください。'
    )
  }

  throw new Error(
    `「${name}」の対象は存在しますが表示されていません（${shown}、${count} 件一致）。` +
      '先に別の操作で表示させる必要があるか、対象を取り違えている可能性があります。' +
      '表の行やセルを指すステップになっていないか確認してください。'
  )
}
