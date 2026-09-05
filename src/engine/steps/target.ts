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

/** 要素の種類を調べる。ステップの種類が合っているかの判定に使う。 */
async function tagOf(locator: Locator): Promise<{ tag: string; editable: boolean }> {
  return locator
    .evaluate((el) => {
      const element = el as HTMLElement
      const tag = element.tagName.toLowerCase()
      return {
        tag,
        editable:
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          element.isContentEditable === true
      }
    })
    .catch(() => ({ tag: '', editable: false }))
}

/**
 * 入力できる要素かを先に確かめる。
 *
 * <tr> や <td> に fill を投げると Playwright の英語エラーになり、
 * 「ステップの種類が違う」ことに気づけない。予約枠を fill しようと
 * しているケースが実際にあったので、日本語で次の一手まで示す。
 */
export async function assertFillable(
  locator: Locator,
  ctx: StepContext,
  step: Step,
  selector: string
): Promise<void> {
  const { tag, editable } = await tagOf(locator)
  if (editable || tag === '') return

  const isSlotLike = /^(tr|td|th|li)$/.test(tag)
  throw new Error(
    `「${stepName(step)}」の対象は入力欄ではありません（<${tag}>、${describeSelector(selector)}）。` +
      'ステップの種類が合っていません。' +
      (isSlotLike
        ? '予約枠のようです。このステップを削除し、ピッカーで枠をクリックして' +
          '「空いている枠から自動で選ぶ」で作り直してください。'
        : 'ピッカーで対象を選び直すか、ステップを作り直してください。')
  )
}

/** プルダウンかを確かめる。 */
export async function assertSelectable(
  locator: Locator,
  ctx: StepContext,
  step: Step,
  selector: string
): Promise<void> {
  const { tag } = await tagOf(locator)
  if (tag === 'select' || tag === '') return

  throw new Error(
    `「${stepName(step)}」の対象はプルダウンではありません（<${tag}>、${describeSelector(selector)}）。` +
      'ステップの種類が合っていません。ピッカーで作り直してください。'
  )
}

/** チェックボックス・ラジオかを確かめる。 */
export async function assertCheckable(
  locator: Locator,
  ctx: StepContext,
  step: Step,
  selector: string
): Promise<void> {
  const kind = await locator
    .evaluate((el) => {
      const element = el as HTMLInputElement
      return {
        tag: element.tagName.toLowerCase(),
        type: (element.getAttribute('type') ?? '').toLowerCase(),
        role: element.getAttribute('role') ?? ''
      }
    })
    .catch(() => null)

  if (!kind) return
  if (kind.tag === 'input' && (kind.type === 'checkbox' || kind.type === 'radio')) return
  if (kind.role === 'checkbox' || kind.role === 'radio' || kind.role === 'switch') return

  throw new Error(
    `「${stepName(step)}」の対象はチェックボックス・ラジオではありません` +
      `（<${kind.tag}>、${describeSelector(selector)}）。` +
      'ステップの種類が合っていません。ピッカーで作り直してください。'
  )
}
