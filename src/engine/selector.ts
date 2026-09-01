/**
 * セレクタ生成とラベル解決（設計 §5）。
 *
 * この文字列はブラウザ内で評価されるため、Node側のモジュールを参照できない。
 * `extract.ts` / `picker.ts` から page.evaluate に埋め込んで使う。
 */
export const SELECTOR_SCRIPT = /* js */ `
(() => {
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];

  /** 自動生成っぽい id（ランダム文字列・連番のみ）は不安定なので使わない。 */
  function isStableId(id) {
    if (!id) return false;
    if (id.length > 40) return false;
    if (/^[0-9]/.test(id)) return false;
    // React/Emotion/Vue の自動生成: :r1:, css-1a2b3c, mui-1234, ember123, v-abc123
    if (/^(:|css-|mui-|ember|v-|sc-|jss|ant-|el-id-|radix-|headlessui-)/.test(id)) return false;
    // 16進やUUIDのみ
    if (/^[0-9a-f]{8,}$/i.test(id)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return false;
    // ランダム英数字（母音がなく記号もない長い塊）
    if (id.length >= 12 && !/[-_]/.test(id) && !/[aeiou]/i.test(id)) return false;
    return true;
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\\\' + c);
  }

  function isUnique(selector, root) {
    try {
      return (root || document).querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function textOf(node) {
    return (node && node.textContent ? node.textContent : '')
      .replace(/[\\s\\u3000]+/g, ' ')
      .trim();
  }

  /** 「必須」バッジなどラベルに混ざるノイズを落とす。 */
  function cleanLabel(text) {
    return text
      .replace(/[（(]?\\s*(必須|任意|required|optional)\\s*[）)]?/gi, '')
      .replace(/[*＊]/g, '')
      .replace(/[:：]\\s*$/, '')
      .replace(/[\\s\\u3000]+/g, ' ')
      .trim();
  }

  /** ラベル解決の探索順（設計 §5）。 */
  function resolveLabel(el) {
    // 1. label[for=id]
    if (el.id) {
      const forLabel = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (forLabel) {
        const t = cleanLabel(textOf(forLabel));
        if (t) return t;
      }
    }

    // 2. 祖先の <label>
    const ancestorLabel = el.closest('label');
    if (ancestorLabel) {
      const clone = ancestorLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
      const t = cleanLabel(textOf(clone));
      if (t) return t;
    }

    // 3. aria-label / aria-labelledby
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && cleanLabel(ariaLabel)) return cleanLabel(ariaLabel);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => textOf(n));
      const t = cleanLabel(parts.join(' '));
      if (t) return t;
    }

    // 4. <th> や親 <tr> 内のテキスト（テーブルレイアウトのフォーム）
    const cell = el.closest('td, th, dd');
    if (cell) {
      const row = cell.closest('tr');
      if (row) {
        const header = row.querySelector('th');
        if (header && !header.contains(el)) {
          const t = cleanLabel(textOf(header));
          if (t) return t;
        }
        const firstCell = row.querySelector('td');
        if (firstCell && !firstCell.contains(el)) {
          const t = cleanLabel(textOf(firstCell));
          if (t) return t;
        }
      }
      // dl レイアウト: <dt>ラベル</dt><dd>入力</dd>
      if (cell.tagName === 'DD') {
        let prev = cell.previousElementSibling;
        while (prev && prev.tagName !== 'DT') prev = prev.previousElementSibling;
        if (prev) {
          const t = cleanLabel(textOf(prev));
          if (t) return t;
        }
      }
    }

    // 5. 直前の兄弟テキストノード
    let node = el.previousSibling;
    let guard = 0;
    while (node && guard++ < 5) {
      const t = cleanLabel(textOf(node));
      if (t) return t;
      node = node.previousSibling;
    }

    // 6. placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && cleanLabel(placeholder)) return cleanLabel(placeholder);

    return '';
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'number') return 'spinbutton';
      return 'textbox';
    }
    return '';
  }

  /** 最短のCSSパス。最後の手段（設計 §5 の6番目）。 */
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && isStableId(node.id)) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += ':nth-child(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')';
        }
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (isUnique(candidate)) return candidate;
      node = parent;
    }
    return parts.join(' > ');
  }

  /**
   * 優先順位（設計 §5）:
   * 1. data-testid 系 / 2. 安定した #id / 3. [name] /
   * 4. ラベル文字列 / 5. role+name / 6. 最短CSSパス
   */
  function buildSelector(el) {
    const tag = el.tagName.toLowerCase();

    for (const attr of TEST_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) {
        const sel = '[' + attr + '="' + value.replace(/"/g, '\\\\"') + '"]';
        if (isUnique(sel)) return sel;
      }
    }

    if (el.id && isStableId(el.id)) {
      const sel = '#' + cssEscape(el.id);
      if (isUnique(sel)) return sel;
    }

    const name = el.getAttribute('name');
    if (name) {
      const base = tag + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
      if (isUnique(base)) return base;
      // radio/checkbox は同一 name が複数あるので value で絞る
      const value = el.getAttribute('value');
      if (value) {
        const withValue = base + '[value="' + value.replace(/"/g, '\\\\"') + '"]';
        if (isUnique(withValue)) return withValue;
      }
    }

    const label = resolveLabel(el);
    if (label && label.length <= 40) {
      // Playwright のラベル指定を文字列で表現する
      const sel = 'internal:label=' + JSON.stringify(label) + 's';
      return sel;
    }

    const role = roleOf(el);
    const accessibleName = label || textOf(el) || el.getAttribute('value') || '';
    if (role && accessibleName && accessibleName.length <= 40) {
      return 'internal:role=' + role + '[name=' + JSON.stringify(accessibleName) + 's]';
    }

    return cssPath(el);
  }

  return { buildSelector, resolveLabel, cssPath, isStableId, roleOf, cleanLabel, textOf };
})()
`

/**
 * `internal:` プレフィックスは Playwright のセレクタエンジン記法。
 * 人間に見せるときだけ読みやすい形へ落とす。
 */
export function describeSelector(selector: string): string {
  const label = /^internal:label=(.+)s$/.exec(selector)
  if (label) return `ラベル ${label[1]}`
  const role = /^internal:role=([a-z]+)\[name=(.+)s\]$/.exec(selector)
  if (role) return `${role[1]} ${role[2]}`
  return selector
}
