import type { Frame, Page } from 'playwright-core'
import type { ExtractResult, Field } from '../types/field'
import { SELECTOR_SCRIPT } from './selector'

/** ページ内で走る抽出スクリプト本体。戻り値は selector 付きの生データ。 */
const EXTRACT_SCRIPT = /* js */ `
(() => {
  const helpers = ${SELECTOR_SCRIPT};
  const { buildSelector, resolveLabel, roleOf, textOf, cleanLabel } = helpers;

  /**
   * ハニーポット判定（設計 §11）。
   * 見えない入力欄はボットよけの罠なので、絶対に入力しない。
   */
  function isHoneypot(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') return true;

    // 祖先も含めて不可視かを見る
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth++ < 20) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none') return true;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
      if (parseFloat(style.opacity) === 0) return true;
      node = node.parentElement;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;

    // 画面外に飛ばす典型パターン
    const style = window.getComputedStyle(el);
    if (style.position === 'absolute' || style.position === 'fixed') {
      if (rect.right < -500 || rect.bottom < -500 || rect.left > 20000) return true;
    }
    if (parseInt(style.textIndent, 10) < -900) return true;

    // よくある罠の名前（人間には見えない前提の欄）
    const name = (el.getAttribute('name') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    if (/^(honeypot|hp|trap|bot|nickname_confirm|url_confirm)$/.test(name)) return true;
    if (/honeypot|hny-|bot-field/.test(name + ' ' + id)) return true;

    return false;
  }

  function fieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (['text','email','tel','number','date','checkbox','radio'].includes(t)) return t;
      if (t === 'password' || t === 'search' || t === 'url') return 'text';
      if (t === 'datetime-local' || t === 'month') return 'date';
      return 'unknown';
    }
    return 'unknown';
  }

  /** required は属性だけでなく aria と「必須」バッジからも拾う。 */
  function isRequired(el) {
    if (el.hasAttribute('required')) return true;
    if (el.getAttribute('aria-required') === 'true') return true;

    const container = el.closest('tr, li, dd, .form-group, .form-row, [class*="field"]');
    if (container) {
      const scope = container.closest('tr') || container;
      const text = textOf(scope);
      if (/必\\s*須/.test(text)) return true;
    }
    const cell = el.closest('td, dd');
    if (cell) {
      const row = cell.closest('tr');
      const header = row ? row.querySelector('th') : null;
      if (header && /必\\s*須/.test(textOf(header))) return true;
    }
    return false;
  }

  function optionsOf(el) {
    if (el.tagName.toLowerCase() !== 'select') return undefined;
    return Array.from(el.options).map((o) => ({
      label: (o.textContent || '').trim(),
      value: o.value
    }));
  }

  const nodes = Array.from(
    document.querySelectorAll('input, textarea, select, button, [role="button"]')
  );

  const results = [];
  const seenRadioGroups = new Set();
  let fieldIndex = 0;
  let buttonIndex = 0;

  for (const el of nodes) {
    const type = fieldType(el);
    const honeypot = isHoneypot(el);

    if (type === 'button') {
      if (honeypot) continue;
      const name =
        cleanLabel(textOf(el)) ||
        cleanLabel(el.getAttribute('value') || '') ||
        cleanLabel(el.getAttribute('aria-label') || '');
      // 「クリア」「リセット」は送信ボタンと紛らわしいので除外しない（AIに判断させる）
      results.push({
        ref: 'b' + ++buttonIndex,
        selector: buildSelector(el),
        label: name,
        type: 'button',
        name: el.getAttribute('name') || undefined,
        required: false,
        isHoneypot: false
      });
      continue;
    }

    // radio は name 単位で1項目にまとめる
    if (type === 'radio') {
      const groupName = el.getAttribute('name');
      if (groupName) {
        if (seenRadioGroups.has(groupName)) continue;
        seenRadioGroups.add(groupName);

        const members = Array.from(
          document.querySelectorAll('input[type="radio"][name="' + groupName.replace(/"/g, '\\\\"') + '"]')
        );
        const options = members.map((m) => ({
          label: resolveLabel(m) || m.value,
          value: m.value
        }));
        // グループのラベルは fieldset > legend か、行の見出しから取る
        const fieldset = el.closest('fieldset');
        const legend = fieldset ? fieldset.querySelector('legend') : null;
        const groupLabel =
          (legend ? cleanLabel(textOf(legend)) : '') ||
          (() => {
            const row = el.closest('tr');
            const th = row ? row.querySelector('th') : null;
            return th ? cleanLabel(textOf(th)) : '';
          })() ||
          groupName;

        results.push({
          ref: 'f' + ++fieldIndex,
          selector: 'input[type="radio"][name="' + groupName + '"]',
          label: groupLabel,
          type: 'radio',
          name: groupName,
          required: members.some(isRequired),
          options,
          isHoneypot: members.every(isHoneypot),
          groupRef: groupName
        });
        continue;
      }
    }

    const label = resolveLabel(el);
    const maxLengthAttr = el.getAttribute('maxlength');
    const maxLength = maxLengthAttr ? parseInt(maxLengthAttr, 10) : undefined;

    results.push({
      ref: 'f' + ++fieldIndex,
      selector: buildSelector(el),
      label: label,
      type: type,
      name: el.getAttribute('name') || undefined,
      required: isRequired(el),
      placeholder: el.getAttribute('placeholder') || undefined,
      pattern: el.getAttribute('pattern') || undefined,
      maxLength: Number.isFinite(maxLength) ? maxLength : undefined,
      options: optionsOf(el),
      isHoneypot: honeypot
    });
  }

  const heading = document.querySelector('h1, h2, [role="heading"]');

  return {
    title: document.title,
    pageHeading: heading ? textOf(heading) : undefined,
    fields: results
  };
})()
`

interface RawExtract {
  title: string
  pageHeading?: string
  fields: Omit<Field, 'frame'>[]
}

/** iframe セレクタを求める。フォームが iframe 内にあるケース（formrun 等）向け。 */
async function frameSelector(page: Page, frame: Frame): Promise<string | undefined> {
  try {
    const element = await frame.frameElement()
    const selector = await element.evaluate((el) => {
      const iframe = el as HTMLIFrameElement
      if (iframe.id) return `iframe#${CSS.escape(iframe.id)}`
      if (iframe.name) return `iframe[name="${iframe.name}"]`
      const src = iframe.getAttribute('src')
      if (src) return `iframe[src="${src}"]`
      const all = Array.from(document.querySelectorAll('iframe'))
      return `iframe:nth-of-type(${all.indexOf(iframe) + 1})`
    })
    await element.dispose()
    return selector
  } catch {
    return undefined
  }
}

/**
 * ページ内の入力項目を抽出する（設計 §6.1）。
 * セレクタは決定的なコードで実DOMから取る。AIには書かせない。
 */
export async function extractFields(page: Page): Promise<ExtractResult> {
  const main = (await page.evaluate(EXTRACT_SCRIPT)) as RawExtract
  const fields: Field[] = main.fields.map((f) => ({ ...f }))

  // 子フレームも走査し、ref が衝突しないよう振り直す
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    let raw: RawExtract
    try {
      raw = (await frame.evaluate(EXTRACT_SCRIPT)) as RawExtract
    } catch {
      continue // cross-origin などで読めないフレームは飛ばす
    }
    if (raw.fields.length === 0) continue

    const selector = await frameSelector(page, frame)
    if (!selector) continue

    for (const f of raw.fields) {
      fields.push({ ...f, frame: selector })
    }
  }

  return renumber({
    url: page.url(),
    title: main.title,
    pageHeading: main.pageHeading,
    fields
  })
}

/** ref を f1.. / b1.. で通し番号に振り直す（フレーム横断で一意にする）。 */
function renumber(result: ExtractResult): ExtractResult {
  let fieldIndex = 0
  let buttonIndex = 0
  const fields = result.fields.map((f) =>
    f.type === 'button'
      ? { ...f, ref: `b${++buttonIndex}` }
      : { ...f, ref: `f${++fieldIndex}` }
  )
  return { ...result, fields }
}

/** radio グループの特定の選択肢を指すセレクタ。 */
export function radioOptionSelector(field: Field, value: string): string {
  return `${field.selector}[value="${value.replace(/"/g, '\\"')}"]`
}

/**
 * AIに渡す圧縮表現（設計 §6.2）。生HTMLの1/100程度のトークン量になる。
 * セレクタは含めない。ハニーポットは渡さない。
 */
export function toCompact(fields: Field[]): string {
  const lines: string[] = []

  for (const f of fields) {
    if (f.isHoneypot) continue

    if (f.type === 'button') {
      lines.push(`${f.ref}:  button:${JSON.stringify(f.label)}`)
      continue
    }

    const parts = [`label:${JSON.stringify(f.label)}`, `type:${f.type}`]
    if (f.required) parts.push('required')
    if (f.name) parts.push(`name:${f.name}`)
    if (f.pattern) parts.push(`pattern:${JSON.stringify(f.pattern)}`)
    if (f.maxLength) parts.push(`maxlength:${f.maxLength}`)
    if (f.options?.length) {
      parts.push(`options:[${f.options.map((o) => JSON.stringify(o.label)).join(',')}]`)
    }
    lines.push(`${f.ref}:  ${parts.join(' ')}`)
  }

  return lines.join('\n')
}
