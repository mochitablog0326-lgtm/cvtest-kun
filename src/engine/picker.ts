import type { Page } from 'playwright-core'
import type { AvailableRule } from '../types/scenario'
import type { PickedElement } from '../types/picker'

export type { PickedElement }

import { SELECTOR_SCRIPT } from './selector'

const PICKER_BINDING = '__cvtestPick'

/** ページに注入するオーバーレイ。ホバーでハイライト、クリックで確定、ESCで解除。 */
export const PICKER_SCRIPT = /* js */ `
(() => {
  if (window.__cvtestPickerInstalled) return;
  window.__cvtestPickerInstalled = true;

  const helpers = ${SELECTOR_SCRIPT};
  const { buildSelector, resolveLabel, textOf, associatedControl } = helpers;

  const STYLE_ID = '__cvtest_picker_style';
  const BOX_ID = '__cvtest_picker_box';
  const TAG_ID = '__cvtest_picker_tag';

  function ensureUi() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '#' + BOX_ID + '{position:fixed;z-index:2147483647;pointer-events:none;' +
        'border:2px solid #2563eb;background:rgba(37,99,235,.12);border-radius:3px;' +
        'transition:all .05s ease-out;display:none}' +
        '#' + TAG_ID + '{position:fixed;z-index:2147483647;pointer-events:none;' +
        'background:#2563eb;color:#fff;font:12px/1.5 -apple-system,sans-serif;' +
        'padding:2px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;' +
        'overflow:hidden;text-overflow:ellipsis;display:none}';
      document.documentElement.appendChild(style);
    }
    if (!document.getElementById(BOX_ID)) {
      const box = document.createElement('div');
      box.id = BOX_ID;
      document.documentElement.appendChild(box);
    }
    if (!document.getElementById(TAG_ID)) {
      const tag = document.createElement('div');
      tag.id = TAG_ID;
      document.documentElement.appendChild(tag);
    }
  }

  function isOwnUi(el) {
    return el && (el.id === BOX_ID || el.id === TAG_ID || el.id === STYLE_ID);
  }

  function highlight(el) {
    ensureUi();
    const box = document.getElementById(BOX_ID);
    const tag = document.getElementById(TAG_ID);
    const rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';

    const name = resolveLabel(el) || displayText(el) || el.tagName.toLowerCase();
    tag.textContent = name.slice(0, 60);
    tag.style.display = 'block';
    // 要素の上に出す。上端に余白がなければ下に回す
    const top = rect.top > 24 ? rect.top - 22 : rect.bottom + 4;
    tag.style.left = rect.left + 'px';
    tag.style.top = top + 'px';
  }

  function clearHighlight() {
    const box = document.getElementById(BOX_ID);
    const tag = document.getElementById(TAG_ID);
    if (box) box.style.display = 'none';
    if (tag) tag.style.display = 'none';
  }

  var DATE_ATTRS = ['data-date', 'datetime', 'data-day'];
  var TIME_ATTRS = ['data-time', 'data-slot', 'data-hour'];

  function hasAnyAttr(el, names) {
    if (!el || !el.hasAttribute) return false;
    for (var i = 0; i < names.length; i++) {
      if (el.hasAttribute(names[i])) return true;
    }
    return false;
  }

  function inCalendarContainer(el) {
    return Boolean(
      el.closest(
        'table, [class*="calendar"], [class*="Calendar"], [id*="calendar"],' +
          '[class*="schedule"], [id*="schedule"], [class*="reserve"], [id*="reserve"]'
      )
    );
  }

  /** カレンダーのセルらしいか。日付ダイアログを出すかの判断に使う。 */
  function looksLikeCalendarCell(el) {
    const tag = el.tagName.toLowerCase();
    const text = textOf(el);
    if (hasAnyAttr(el, DATE_ATTRS)) return true;
    if (tag !== 'td' && tag !== 'li' && tag !== 'div' && tag !== 'button' && tag !== 'a') return false;
    if (!inCalendarContainer(el)) return false;
    return /^\\s*\\d{1,2}\\s*[^\\d]{0,4}$/.test(text);
  }

  /**
   * 時間枠らしいか。
   *
   * <tr data-time="10:00"><th>10:00</th><td>○</td></tr> のように
   * 行そのものが1枠になっている作りが多い。
   */
  function looksLikeTimeSlot(el) {
    const tag = el.tagName.toLowerCase();
    if (hasAnyAttr(el, TIME_ATTRS)) return true;
    if (['tr', 'td', 'li', 'div', 'button', 'a'].indexOf(tag) < 0) return false;
    if (!inCalendarContainer(el)) return false;
    // "10:00 ○" のように時刻と空き記号だけで構成されている
    return /^\\s*\\d{1,2}\\s*[:：]\\s*\\d{2}\\s*[^\\d]{0,4}$/.test(textOf(el));
  }

  /**
   * ユーザーはセルの中の日付文字（span や a）をクリックする。
   * 意図しているのは外側のセルなので、カレンダーセルらしい祖先があればそちらを採る。
   */
  function resolveTarget(el) {
    /*
     * ラベルや、その中の装飾用の要素を押したときは、対応する入力要素を対象にする。
     * 実体の input が隠されている作りでは、押せるのは常にラベル側なので、
     * 押された物をそのまま記録すると「不可視の要素を待つ」ステップになってしまう。
     */
    const control = associatedControl(el);
    if (control) return control;

    /*
     * 日付・時刻の属性を持つ要素を最優先する。
     * <th>10:00</th> 自体も時刻に見えるが、空き状況を持っているのは
     * 親の <tr data-time> の方なので、そちらを対象にする必要がある。
     */
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth++ < 5) {
      if (hasAnyAttr(node, DATE_ATTRS) || hasAnyAttr(node, TIME_ATTRS)) return node;
      node = node.parentElement;
    }

    if (looksLikeCalendarCell(el) || looksLikeTimeSlot(el)) return el;

    node = el.parentElement;
    depth = 0;
    while (node && depth++ < 4) {
      if (looksLikeCalendarCell(node) || looksLikeTimeSlot(node)) return node;
      node = node.parentElement;
    }
    return el;
  }

  /**
   * 表示用のテキスト。
   *
   * <select> の textContent は option の全文が連結されたものになる。
   * これをラベルに使うと「年 2010年 2009年 …」のような文字列になり、
   * UIの一覧が読めなくなるので、選択肢の羅列は返さない。
   */
  function displayText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return '';
    if (tag === 'textarea') return '';
    return textOf(el);
  }

  /**
   * 枠を含む表・リストのセレクタ。
   *
   * 枠の id や class は行側ではなく親のコンテナに付いていることが多い
   * （<table id="calendar-time"> の中の <tr data-time>）。
   * ページ内でしか祖先を辿れないので、ここで求めて渡す。
   */
  function gridSelectorFor(el) {
    // tbody は入れない。ブラウザが自動で挿入するうえ、
    // table より近いので #calendar-time > tbody のような冗長な指定になる
    var container = el.closest(
      'table, ul, ol,' +
        '[class*="calendar"], [id*="calendar"],' +
        '[class*="schedule"], [id*="schedule"],' +
        '[class*="timetable"], [id*="timetable"],' +
        '[class*="reserve"], [id*="reserve"]'
    );
    if (!container || container === el) return '';
    try {
      return buildSelector(container);
    } catch (e) {
      return '';
    }
  }

  function describe(el) {
    const attrs = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    return {
      selector: buildSelector(el),
      label: resolveLabel(el),
      tagName: el.tagName.toLowerCase(),
      inputType: el.getAttribute('type') || undefined,
      classes: Array.from(el.classList),
      attrs: attrs,
      text: displayText(el),
      hasChildLink: Boolean(el.querySelector('a, button')),
      looksLikeCalendarCell: looksLikeCalendarCell(el),
      looksLikeTimeSlot: looksLikeTimeSlot(el),
      gridSelector: gridSelectorFor(el)
    };
  }

  /**
   * 「ピッカーを動かしたい」という意思はページ遷移で消えてはいけない。
   * ただし stop したら遷移後も止まっていてほしいので、
   * ドキュメントを跨いで残る sessionStorage に置く。
   */
  const ACTIVE_KEY = '__cvtest_picker_active';

  function setActiveFlag(on) {
    try {
      if (on) window.sessionStorage.setItem(ACTIVE_KEY, '1');
      else window.sessionStorage.removeItem(ACTIVE_KEY);
    } catch (e) {
      // sessionStorage が使えない環境（file:// 等）では諦める
    }
  }

  function activeFlag() {
    try {
      return window.sessionStorage.getItem(ACTIVE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  window.__cvtestPickerWanted = activeFlag;

  function onMove(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1 || isOwnUi(el)) return;
    highlight(el);
  }

  function onClick(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1 || isOwnUi(el)) return;
    // 元のクリックは通さない。送信ボタンを踏んで実送信するのを防ぐ
    e.preventDefault();
    e.stopPropagation();
    window.${PICKER_BINDING}(describe(resolveTarget(el)));
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.__cvtestStopPicker();
    }
  }

  /** 状態変化を外へ知らせる。ESCでの解除をUIに反映するために要る。 */
  function notifyState(active) {
    try {
      if (window.__cvtestPickerEvent) window.__cvtestPickerEvent({ active: active });
    } catch (e) {
      // 通知先が無くてもピッカー自体は動く
    }
  }

  window.__cvtestStopPicker = function () {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    clearHighlight();
    window.__cvtestPickerActive = false;
    setActiveFlag(false);
    notifyState(false);
  };

  window.__cvtestStartPicker = function () {
    ensureUi();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.__cvtestPickerActive = true;
    setActiveFlag(true);
    notifyState(true);
  };

  /** ページ遷移後の自動復帰。stop 済みなら復帰しない。 */
  window.__cvtestResumePicker = function () {
    if (activeFlag()) window.__cvtestStartPicker();
  };

  /** 学習したルールの当たり判定を可視化する（設計 §7 の手順4）。 */
  window.__cvtestPreview = function (grid, cell, matched) {
    ensureUi();
    const cells = Array.from(document.querySelectorAll(grid + ' ' + cell));
    cells.forEach((c, i) => {
      c.style.outline = matched[i] ? '2px solid #16a34a' : '2px solid #dc2626';
      c.style.outlineOffset = '-2px';
    });
  };

  window.__cvtestClearPreview = function (grid, cell) {
    Array.from(document.querySelectorAll(grid + ' ' + cell)).forEach((c) => {
      c.style.outline = '';
      c.style.outlineOffset = '';
    });
  };
})()
`

export interface PickerHandle {
  stop(): Promise<void>
}

/**
 * ピッカーの通知先。
 *
 * `exposeBinding` と `addInitScript` はページから取り消せないので、
 * 一度だけ登録し、実際の通知先はここを見て差し替える。
 * これをしないと2回目の startPicker が1回目のハンドラへ配ってしまう。
 */
const handlers = new WeakMap<Page, (picked: PickedElement) => void>()
const installed = new WeakSet<Page>()

/**
 * 要素ピッカーを起動する（設計 §7）。
 *
 * `addInitScript` で再読み込み後も生き残らせ、`exposeBinding` で
 * クリック結果を main プロセスへ返す。
 */
export async function startPicker(
  page: Page,
  onSelected: (picked: PickedElement) => void
): Promise<PickerHandle> {
  handlers.set(page, onSelected)

  if (!installed.has(page)) {
    installed.add(page)
    await page.exposeBinding(PICKER_BINDING, (_source, picked: PickedElement) => {
      handlers.get(page)?.(picked)
    })
    // リロードを跨いでもピッカーが生き続けるようにする。
    // stop 済みかは sessionStorage のフラグで判断するので、復帰は安全。
    await page.addInitScript(PICKER_SCRIPT)
    await page.addInitScript(
      'window.addEventListener("load", () => window.__cvtestResumePicker && window.__cvtestResumePicker())'
    )
  }

  await page.evaluate(PICKER_SCRIPT)
  await page.evaluate('window.__cvtestStartPicker()')

  return {
    stop: () => stopPicker(page)
  }
}

export async function stopPicker(page: Page): Promise<void> {
  await page.evaluate('window.__cvtestStopPicker && window.__cvtestStopPicker()').catch(() => {})
}

/** 「空いている枠」「埋まっている枠」の見た目の差を可視化する。 */
export async function previewRule(
  page: Page,
  grid: string,
  cell: string,
  matched: boolean[]
): Promise<void> {
  await page.evaluate(
    ([g, c, m]) =>
      (window as unknown as { __cvtestPreview: (g: string, c: string, m: boolean[]) => void })
        .__cvtestPreview(g as string, c as string, m as boolean[]),
    [grid, cell, matched] as const
  )
}

/** テキストから空き記号だけを抜く。日付の数字は落とす。 */
function symbolsOf(text: string): string[] {
  const stripped = text.replace(/[\d\s　]/g, '')
  return Array.from(new Set(Array.from(stripped))).filter((c) => c.length > 0)
}

/** 属性が「立っている」か。値が "false" のときは立っていないとみなす。 */
function attrIsSet(attrs: Record<string, string>, name: string): boolean {
  const value = attrs[name]
  if (value === undefined) return false
  return value !== 'false'
}

/**
 * 空いている枠と埋まっている枠の差分から `AvailableRule` を作る（設計 §7）。
 *
 * サイトごとに空き表現がバラバラ（disabled / .is-full / ○△× / <a>の有無）なので
 * 決め打ちせず、ユーザーに2つクリックさせて学習する。
 */
export function buildAvailableRule(
  available: PickedElement,
  full: PickedElement
): AvailableRule {
  const rule: AvailableRule = {}

  // class の差分
  const onlyAvailable = available.classes.filter((c) => !full.classes.includes(c))
  const onlyFull = full.classes.filter((c) => !available.classes.includes(c))
  if (onlyAvailable.length > 0) rule.hasClass = onlyAvailable
  if (onlyFull.length > 0) rule.notClass = onlyFull

  // 属性の差分（埋まっている側にだけ立っているもの = 無効化の印）
  const attrNames = new Set([...Object.keys(available.attrs), ...Object.keys(full.attrs)])
  const disablingAttrs: string[] = []
  for (const name of attrNames) {
    if (name === 'class' || name === 'style') continue
    // 日付など値が個別に違うだけの属性は無視する
    if (attrIsSet(full.attrs, name) && !attrIsSet(available.attrs, name)) {
      disablingAttrs.push(name)
    }
  }
  if (disablingAttrs.length > 0) rule.notAttr = disablingAttrs

  // テキスト記号の差分（○△ と × など）。
  //
  // 除外（textNotIn）だけを学習し、textIn は作らない。
  // 空き記号は ○ △ ◎ 残1 … と複数あるのが普通で、ユーザーがクリックした
  // 1つ（例: ○）を必須条件にすると △ の枠まで満席扱いになってしまう。
  // 満席記号（×）を除外する方が、取りこぼしが少なく安全側に倒れる。
  const availableSymbols = symbolsOf(available.text)
  const fullSymbols = symbolsOf(full.text)
  const uniqueFull = fullSymbols.filter((s) => !availableSymbols.includes(s))
  if (uniqueFull.length > 0) rule.textNotIn = uniqueFull

  // 子要素の差分（空きだけリンクになっている）
  if (available.hasChildLink && !full.hasChildLink) rule.hasChild = 'a, button'

  return rule
}

/** 学習したルールで判定できているかを確かめる（設計 §7 の手順4）。 */
export function ruleIsUsable(rule: AvailableRule): boolean {
  return Object.keys(rule).length > 0
}
