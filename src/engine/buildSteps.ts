import type { Field } from '../types/field'
import type { Step } from '../types/scenario'
import { radioOptionSelector } from './extract'
import type { ValueMap } from '../ai/provider'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}${counter}-${Math.random().toString(36).slice(2, 7)}`
}

export interface BuildStepsOptions {
  /** 送信ボタンの ref。指定すると click ステップを末尾に足す */
  submit?: string
  /** 送信前後にスクショを撮る */
  screenshots?: boolean
}

/**
 * 抽出した Field と生成された値から実行ステップを組み立てる。
 *
 * ここが AI の ref を実セレクタへ写す唯一の場所（設計 §6.1）。
 * Field.selector は決定的な抽出で得たものだけなので、
 * 存在しない要素を指すステップは原理的に作られない。
 */
export function buildSteps(
  fields: Field[],
  values: ValueMap,
  options: BuildStepsOptions = {}
): Step[] {
  const steps: Step[] = []
  const byRef = new Map(fields.map((f) => [f.ref, f]))

  for (const [ref, value] of Object.entries(values)) {
    const field = byRef.get(ref)
    if (!field) continue
    if (field.isHoneypot) continue
    if (field.type === 'button') continue

    const base = { id: nextId('s'), label: field.label || field.ref, frame: field.frame }

    switch (field.type) {
      case 'checkbox':
        steps.push({ ...base, type: 'check', selector: field.selector, checked: value === true })
        break

      case 'radio': {
        const option = field.options?.find(
          (o) => o.label === String(value) || o.value === String(value)
        )
        if (!option) break
        steps.push({
          ...base,
          type: 'check',
          selector: radioOptionSelector(field, option.value),
          checked: true
        })
        break
      }

      case 'select':
        steps.push({ ...base, type: 'select', selector: field.selector, value: String(value) })
        break

      default:
        if (typeof value !== 'string') break
        steps.push({ ...base, type: 'fill', selector: field.selector, value })
        break
    }
  }

  if (options.screenshots) {
    steps.push({ id: nextId('s'), type: 'screenshot', name: 'before-submit' })
  }

  if (options.submit) {
    const button = byRef.get(options.submit)
    if (button) {
      steps.push({
        id: nextId('s'),
        type: 'click',
        label: button.label || '送信',
        selector: button.selector,
        frame: button.frame
      })
    }
  }

  if (options.screenshots) {
    steps.push({ id: nextId('s'), type: 'screenshot', name: 'after-submit' })
  }

  return steps
}
