# CVテスト君 設計書

CVフォーム（問い合わせ・予約）の入力〜送信を自動化・定期実行するデスクトップアプリ。

| 項目 | 値 |
|---|---|
| 表示名 | CVテスト君 |
| 英語名 | CV Test Kun |
| コマンド | `cvtest` |
| GitHub | `yourname/cvtest-kun` |
| brew | `brew install --cask cvtest-kun` |
| 英語説明 | An automated CV (conversion) form testing tool for Japanese websites |

- **形態**: Electron ローカルアプリ（サーバーなし）
- **配布**: GitHub OSS（MIT）+ Homebrew Cask 独自tap
- **実行エンジン**: Playwright

> 命名の背景: `CVPilot` `FormPulse` などの英語名は既存サービスで飽和していた。また英語圏では CV = curriculum vitae（履歴書）と解釈されるため、`cv〜` 系の英語名はレジュメツール群に埋もれる。「CV=コンバージョン」は日本のマーケ業界特有の用法であり、本ツールも日本のフォーム事情（確認画面・和暦・`○△×`カレンダー・formrun等）に特化するため、**国内向けと割り切った日本語名**を採用する。英語READMEを併記して海外からの発見性を確保する。
>
> 実装フェーズ8に入る前に `npm view cvtest` で空きを確認すること。埋まっていれば `cvtest-kun` にする。

---

## 1. スコープ

### やること

- URLを開き、フォーム項目をGUIでピッキングしてシナリオを作る
- 相対日付・空き枠自動選択に対応した予約カレンダー操作
- AIによるシナリオ自動生成（人間のレビューを必ず挟む）
- 実行結果のスクショ・trace・計測タグ発火ログの保存

### やらないこと（明記して実装しない）

- **CAPTCHA / reCAPTCHA の回避** — 規約違反。ステージング差し替えかIP allowlistで運用する旨をREADMEに書く
- サーバー同期・アカウント機能
- Shadow DOM (closed) 内の要素操作

---

## 2. 技術スタック

| 領域 | 選定 | 備考 |
|---|---|---|
| シェル | Electron | Main / Renderer / Preload の3層 |
| UI | React + TypeScript + Vite | |
| 自動化 | `playwright-core` | ブラウザは初回DLか `channel: 'chrome'` |
| 日付 | dayjs + customParseFormat + timezone | **JST固定**。`9/15` や和暦のパースにカスタムパーサを噛ませる |
| 検証 | zod | シナリオJSON・AI出力のスキーマ検証 |
| ビルド | electron-builder | |

Playwrightを使う理由: 自動待機・iframe対応・trace・スクショが標準装備。`<webview>` 単体だとReact制御コンポーネントへの入力にネイティブsetterを叩く小細工が必要になり、割に合わない。

---

## 3. ディレクトリ構成

```
cvtest-kun/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts
│   │   ├── ipc.ts               # IPC ハンドラ登録
│   │   ├── store.ts             # シナリオの読み書き
│   │   └── secrets.ts           # safeStorage ラッパ
│   ├── preload/
│   │   └── index.ts             # contextBridge で API 公開
│   ├── renderer/                # React UI
│   │   ├── App.tsx
│   │   ├── views/
│   │   │   ├── ScenarioList.tsx
│   │   │   ├── Recorder.tsx     # 録画・ピッカー
│   │   │   ├── ScenarioEditor.tsx
│   │   │   └── RunResult.tsx
│   │   └── components/
│   ├── engine/                  # Playwright 層（mainから呼ぶ / CLIからも呼ぶ）
│   │   ├── browser.ts           # 起動・終了・コンテキスト管理
│   │   ├── extract.ts           # フィールド抽出
│   │   ├── selector.ts          # セレクタ生成
│   │   ├── picker.ts            # 要素ピッカー注入スクリプト
│   │   ├── runner.ts            # シナリオ実行
│   │   ├── steps/
│   │   │   ├── fill.ts
│   │   │   ├── click.ts
│   │   │   ├── select.ts
│   │   │   ├── pickDate.ts
│   │   │   ├── pickSlot.ts
│   │   │   └── assert.ts
│   │   ├── tracking.ts          # 計測タグ発火の監視
│   │   └── template.ts          # {{timestamp}} 等の展開
│   ├── ai/
│   │   ├── provider.ts          # AIProvider インターフェース
│   │   ├── providers/
│   │   │   ├── codexCli.ts
│   │   │   ├── claudeCode.ts
│   │   │   ├── geminiCli.ts
│   │   │   ├── openaiApi.ts
│   │   │   └── ollama.ts
│   │   ├── prompt.ts            # プロンプト組み立て
│   │   └── cache.ts            # DOMハッシュキーのローカルキャッシュ
│   ├── presets/
│   │   └── testcv.ts            # 媒体別テストCV判定ルール（section 11.1）
│   ├── cli/
│   │   └── index.ts             # npx cvtest run scenario.json
│   └── types/
│       ├── scenario.ts
│       ├── field.ts
│       └── result.ts
├── build/                       # アイコン、entitlements.plist
├── .github/workflows/release.yml
└── DESIGN.md
```

GUI版とCLI版で `engine/` を共有する。CLI版はnpm、GUI版はHomebrew Caskで配る（Electronアプリをnpmで配ると数百MBになるため分離）。

---

## 4. 型定義

### 4.1 シナリオ

```ts
// types/scenario.ts

export interface Scenario {
  version: 1;
  name: string;
  url: string;
  variables?: Record<string, string>;   // {{key}} で参照
  steps: Step[];
  createdAt: string;
  updatedAt: string;
}

export type Step =
  | FillStep | ClickStep | SelectStep | CheckStep
  | PickDateStep | PickSlotStep
  | WaitStep | AssertStep | ScreenshotStep;

interface BaseStep {
  id: string;
  label?: string;          // UI表示用（例: "会社名を入力"）
  frame?: string;          // iframe セレクタ。指定時は frameLocator 経由
  optional?: boolean;      // 失敗しても続行
}

export interface FillStep extends BaseStep {
  type: 'fill';
  selector: string;
  value: string;           // テンプレート展開対象
}

export interface ClickStep extends BaseStep {
  type: 'click';
  selector: string;
  waitAfter?: number;
}

export interface SelectStep extends BaseStep {
  type: 'select';
  selector: string;
  value: string;           // option の value か label
}

export interface CheckStep extends BaseStep {
  type: 'check';
  selector: string;
  checked: boolean;
}

export interface WaitStep extends BaseStep {
  type: 'wait';
  ms?: number;
  selector?: string;       // 要素の出現待ち
}

export interface AssertStep extends BaseStep {
  type: 'assert';
  selector: string;
  mode: 'text' | 'visible' | 'url';
  value?: string;
}

export interface ScreenshotStep extends BaseStep {
  type: 'screenshot';
  name: string;
}
```

### 4.2 日付・予約枠

```ts
export interface PickDateStep extends BaseStep {
  type: 'pickDate';
  selector: string;        // 例: "[data-date='{{today+7|YYYY-MM-DD}}']"
}

export interface PickSlotStep extends BaseStep {
  type: 'pickSlot';
  grid: string;            // カレンダー全体
  cell: string;            // 各セル
  available: AvailableRule;
  range?: { minDaysAhead?: number; maxDaysAhead?: number };
  strategy: 'first' | 'last' | 'random';
  nextMonth?: string;      // 翌月ボタン
  maxMonthNav?: number;    // デフォルト 3
}

export interface AvailableRule {
  hasClass?: string[];
  notClass?: string[];
  notAttr?: string[];      // 例: ["disabled", "aria-disabled"]
  textIn?: string[];       // 例: ["○", "△"]
  textNotIn?: string[];    // 例: ["×", "-", "満"]
  hasChild?: string;       // 例: "a, button"
}
```

### 4.3 フィールド抽出結果

```ts
// types/field.ts
export interface Field {
  ref: string;             // "f1", "f2" ... AIとのやり取りに使う仮ID
  selector: string;        // 実セレクタ（AIには渡さない）
  frame?: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea'
      | 'select' | 'checkbox' | 'radio' | 'button' | 'unknown';
  name?: string;
  required: boolean;
  placeholder?: string;
  pattern?: string;
  maxLength?: number;
  options?: { label: string; value: string }[];
  isHoneypot: boolean;     // hidden / display:none / 幅0 → 入力しない
}
```

### 4.4 実行結果

```ts
// types/result.ts
export interface RunResult {
  scenarioName: string;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'failed' | 'aborted';
  steps: StepResult[];
  pickedDate?: string;         // pickSlot が何を選んだか（必須で記録）
  screenshots: string[];
  tracePath?: string;
  trackingEvents: TrackingEvent[];
}

export interface TrackingEvent {
  provider: string;            // "GA4" | "Google Ads" | "Yahoo" | "Meta" | "unknown"
  url: string;
  eventName?: string;
  count: number;               // 発火回数。重複発火の検出に使う
  at: string;
}
```

---

## 5. セレクタ生成

優先順位。日本のフォームは `name` が安定していることが多いので高めに置く。

1. `[data-testid]` / `[data-test]` / `[data-cy]`
2. `#id` （自動生成っぽいもの ─ ランダム文字列や連番のみ ─ は除外）
3. `[name="..."]`
4. `getByLabel()` 相当のラベル文字列
5. `getByRole(role, { name })`
6. 最短のCSSパス（`nth-child` を含む。最後の手段）

ラベル解決の探索順:

1. `label[for=id]`
2. 祖先の `<label>`
3. `aria-label` / `aria-labelledby`
4. `<th>` や親 `<tr>` 内のテキスト（テーブルレイアウトのフォーム）
5. 直前の兄弟テキストノード
6. `placeholder`

---

## 6. フィールド抽出 → AI連携

### 6.1 原則

**AIにセレクタを書かせない。** 幻覚したセレクタで不安定になる。

- セレクタ抽出は決定的なコードで実DOMから取る
- AIは「各項目に何を入れるか」だけ決める
- AIには `ref`（f1, f2...）で答えさせ、コード側で実セレクタに戻す

これによりAIが存在しない要素を指すことが原理的に起きない。

### 6.2 AIに渡す圧縮表現

生HTMLではなく、`extract.ts` の結果をこの形式に整形して渡す（トークンが1/100程度になる）。

```
f1:  label:"会社名"        type:text     required  name:company
f2:  label:"お名前"        type:text     required  name:name
f3:  label:"メールアドレス" type:email    required  name:email
f4:  label:"電話番号"      type:tel      pattern:"[0-9-]+"
f5:  label:"ご相談内容"    type:select   options:["選択してください","料金について","導入相談","その他"]
f6:  label:"詳細"          type:textarea maxlength:1000
f7:  label:"個人情報の取扱いに同意する" type:checkbox required
b1:  button:"確認画面へ"
```

`isHoneypot: true` のフィールドは渡さない。

### 6.3 AIの返答スキーマ

```json
{
  "values": {
    "f1": "【テスト】株式会社サンプル",
    "f2": "【テスト】山田太郎",
    "f3": "test+{{timestamp}}@example.com",
    "f5": "導入相談",
    "f7": true
  },
  "submit": "b1"
}
```

zodで検証し、未知の `ref` は破棄する。

### 6.4 複数ページ

確認画面がある場合、1ページ目の時点で2ページ目のDOMは見えない。
**全体を一度に生成させず、ページ遷移のたびに再抽出してAIに投げ直すループにする。**

### 6.5 プロバイダ抽象

```ts
// ai/provider.ts
export interface AIProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  generateValues(fields: Field[], ctx: PageContext): Promise<ValueMap>;
}

export interface PageContext {
  url: string;
  title: string;
  pageHeading?: string;
  purpose?: string;        // ユーザーが指定した用途（例: "資料請求"）
}
```

実装: `CodexCliProvider` / `ClaudeCodeProvider` / `GeminiCliProvider` / `OpenAiApiProvider` / `OllamaProvider`

CLI系プロバイダの注意:

- `codex exec` などはバージョンでフラグとJSON出力形式が変わる。**実装前に `--help` で現行仕様を確認する**
- コーディングエージェントはワークスペースのファイルを触りに行くので、サンドボックス設定を絞る
- **サブスク認証を他アプリのバックエンドとして使うのは各サービスの規約次第**。READMEに「各自の利用規約を確認のうえ自己責任で」と明記
- Ollamaを入れておくと、社内フォームでDOM情報を外部に出せないケースに対応できる

### 6.6 キャッシュ

`hash(url + DOM構造)` をキーに `userData` 配下へローカル保存。同じフォームで毎回AIを呼ばない。

---

## 7. 要素ピッカー（録画UI）

`page.addInitScript()` でオーバーレイ用スクリプトを注入、`page.exposeBinding()` でクリック結果をmainへ返す。

- ホバーで要素をハイライト（outline + ラベル表示）
- クリックでセレクタ確定、元のクリックイベントは `preventDefault`
- ESCでピッカー解除

### カレンダーセルをクリックしたときのダイアログ

```
この日付をどう扱いますか？
 ○ この日付で固定する
 ○ 相対日付にする（今日から [ 7 ] 日後）
 ● 空いている枠から自動で選ぶ   ← 推奨
```

「空いている枠から自動で選ぶ」を選んだら、**空き判定ルールの学習フロー**に入る:

1. 「**空いている枠**を1つクリックしてください」
2. 「**埋まっている枠**を1つクリックしてください」
3. 2要素の class / 属性 / テキスト / 子要素の差分から `AvailableRule` を自動生成
4. 生成したルールでグリッド全体を判定し、結果をハイライト表示してユーザーに確認させる

サイトごとに空き表現がバラバラ（`disabled` / `.is-full` / `○△×` / `<a>の有無`）なので、決め打ちせず学習させる。

---

## 8. pickSlot の実行ロジック

```ts
async function pickSlot(page: Page, step: PickSlotStep): Promise<string> {
  const maxNav = step.maxMonthNav ?? 3;

  for (let m = 0; m <= maxNav; m++) {
    const cells = page.locator(step.grid).locator(step.cell);
    const candidates: Locator[] = [];

    for (let i = 0; i < await cells.count(); i++) {
      const c = cells.nth(i);
      if (!(await isAvailable(c, step.available))) continue;
      const d = await dateOf(c);              // data-date / テキスト / aria-label から解決
      if (!inRange(d, step.range)) continue;
      candidates.push(c);
    }

    if (candidates.length > 0) {
      const target =
        step.strategy === 'random' ? candidates[Math.floor(Math.random() * candidates.length)] :
        step.strategy === 'last'   ? candidates[candidates.length - 1] :
                                     candidates[0];
      const picked = await dateOf(target);
      await target.click();
      return picked;                          // RunResult.pickedDate に必ず記録
    }

    if (!step.nextMonth || m === maxNav) break;
    await page.click(step.nextMonth);
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  throw new Error('条件に合う空き枠が見つかりませんでした');
}
```

`strategy: 'random'` を選べるようにして、毎回同じ枠を潰さないようにする。

---

## 9. テンプレート展開

`template.ts` で以下を解決する。日付計算は **JST固定**。

| 記法 | 展開結果 |
|---|---|
| `{{timestamp}}` | `20260901143022` |
| `{{today\|YYYY-MM-DD}}` | `2026-09-01` |
| `{{today+7\|YYYY-MM-DD}}` | `2026-09-08` |
| `{{nextMonday\|M/D}}` | `9/7` |
| `{{random:6}}` | `a3f9k2` |
| `{{env.PASSWORD}}` | 環境変数 |
| `{{secret.LOGIN_PW}}` | safeStorage から復号 |
| `{{var.company}}` | `Scenario.variables` |

---

## 10. 計測タグ検証（差別化機能）

`page.on('request')` でリクエストを監視し、CVタグの発火を検出する。
「フォームは送れているのにCVが計測されていない」は頻発する事故で、ここを自動で見られるツールは少ない。

**この機能が解決する実務課題:**

- 媒体管理画面でのテストCV確認は**反映に1時間程度かかる**ものがある（例: Gunosy Ads）。さらにコンバージョンログが最新1回分しか表示されず、iOS/Androidを順番にテストする必要がある。ブラウザ側でリクエストを直接見れば**即座に**判定できる
- GTMのトリガー設定でCSSセレクタの「一致する / しない」を取り違え、資料請求ボタンだけを計測するはずが**ページ内の全ボタンで発火してCV数が水増しされる**、という事故が実際に報告されている。発火**回数**も記録して、想定回数と一致するか検証する
- タグの発火順序（入口タグ → CVタグ）や、ページ間のCookie引き継ぎが正常かも `document.cookie` のスナップショットで確認できると価値が高い

検出対象:

| provider | パターン |
|---|---|
| GA4 | `google-analytics.com/g/collect`, `analytics.google.com/g/collect` |
| Google Ads | `googleadservices.com/pagead/conversion` |
| Yahoo広告 | `b.yjtag.jp`, `s.yimg.jp/images/listing/tool/cv` |
| Meta | `facebook.com/tr` |
| GTM | `googletagmanager.com/gtm.js` |

`en=` パラメータからイベント名を拾い、期待イベントが飛んだかを `assert` できるようにする。

---

## 11. 安全設計（妥協しない箇所）

**このツールは実際にフォームを送信し、実際に予約を入れる。**

| リスク | 対策 |
|---|---|
| 本番フォームへの誤送信 | 氏名・会社名に `【テスト】` を付けるテンプレを標準提供。メールは `+{{timestamp}}` |
| AI生成のまま送信 | **「生成」ボタンと「実行」ボタンを分離。** AI出力は必ずUIに表示し、人間の確認・修正後にのみ実行 |
| 予約枠を潰す | シナリオ末尾に「キャンセル」ステップを組めるようにする。`minDaysAhead` で直近を避ける |
| ハニーポット | `isHoneypot` 判定した hidden / display:none / 幅0 のフィールドには入力しない |
| 送信速度制限 | ステップ間にウェイトを設定可能に。デフォルトで人間らしい間隔を入れる |
| プロンプトインジェクション | AI出力はzodスキーマで縛り、セレクタは自前抽出のものにしかマッピングしない。値の中身もバリデーション |
| 秘密情報の平文保存 | `safeStorage`（OSキーチェーン）か `{{env.*}}` 参照。「機密情報をシナリオに直書きしない」と警告表示 |
| テスト成果の残留 | 後始末チェックリストを生成（11.2） |

---

### 11.1 媒体別テストCVプリセット

**業界の実務ルールとして、テストCVを識別させる方法は既に確立している。** これをプリセットとして内蔵すれば、ユーザーが媒体ごとのルールを調べる手間が消える。差別化ポイントにもなる。

確認済みの例:

| 媒体 | テストCVと認識させる条件 | 事後処理 |
|---|---|---|
| qualva | 姓名入力欄のいずれかに「テスト」または「てすと」を含める | 毎日2時に自動削除。成果対象から除外される |
| Dairin | 特になし（通常CVとして計上される） | 管理画面の成果確認から**手動で非承認**にする必要あり |
| Gunosy Ads | 専用のコンバージョンURL経由でアクセス | 同一タグIDで成功済みなら再実施不要 |

```ts
// presets/testcv.ts
export interface TestCvPreset {
  id: string;                    // "qualva" | "dairin" | ...
  label: string;
  detect?: { urlIncludes?: string[] };   // URLから自動判定
  rules: {
    nameFieldMustInclude?: string[];     // 例: ["テスト"]
    emailSuffix?: string;                // 例: "+test"
    forceValues?: Record<string, string>;
  };
  cleanup: {
    auto: boolean;
    note: string;                        // 手動対応が必要な場合の手順
  };
}
```

**挙動:**

1. シナリオ実行時、URLから媒体を自動判定してプリセットを提案
2. AI生成・手動入力どちらの場合も、プリセットのルールを**後段で強制適用**する（姓名に「テスト」が入っていなければ自動で付与）
3. ルールを満たさない値が残っている場合、実行前に警告を出す

> **重要**: qualvaのドキュメントには「テストにもかかわらず途中で離脱するとダッシュボードの数値に影響する」との記載がある。**一度入力を開始したら必ず最後まで到達させること。** 実行中断時のリカバリ（可能なら完了まで進めてからキャンセル）を runner に組み込む。

プリセットはハードコードせず JSON で持ち、コミュニティがPRで追加できる形にする。これはOSSとして最も伸びやすい部分。

### 11.2 後始末チェックリスト

実行後、`RunResult` と適用プリセットから「やるべき後始末」を生成して表示・保存する。

```
✅ 送信完了（2026-09-01 14:30）
⚠️ 後始末が必要です
   □ Dairin管理画面 > 成果確認 > 中間CV/最終CV から非承認にする
     （非承認理由に「テスト」と入力）
   □ 予約枠 2026-09-08 10:00 をキャンセルする
   □ 問い合わせ先へテスト送信した旨を連絡（設定でON時）
```

予約シナリオの場合は、選択した枠（`pickedDate`）を必ずこのリストに載せる。**何を予約したか分からないと片付けられない。**

---

## 12. 保存とデータ

サーバーなし。すべてローカル。

```
~/Library/Application Support/cvtest-kun/    # app.getPath('userData')
  config.json
  presets/                                   # 媒体別テストCVプリセット
  cache/ai/
  runs/2026-09-01T14-30-22/
    before-submit.png
    after-submit.png
    trace.zip
    result.json
    cleanup.md                               # 後始末チェックリスト
```

シナリオの保存先は**ユーザーが任意のフォルダを指定できる**ようにする。共有機能を作らなくても、Git管理やクラウド同期を利用者側で勝手にやれる。

```
~/Documents/cvtest-scenarios/
  contact-form.json
  reservation.json
```

ローカルアプリの利点として、スクショとPlaywright traceは容量を気にせず残す。失敗調査が大幅に楽になる。

---

## 13. IPC 設計

`contextIsolation: true` / `nodeIntegration: false`。preloadで最小限だけ公開。

```ts
// preload
window.api = {
  scenario: { list, load, save, delete, chooseDir },
  browser:  { open, close, startPicker, stopPicker },
  extract:  { fields },
  run:      { start, abort },
  ai:       { listProviders, generate },
  secrets:  { set, has, delete },
};

// main → renderer （イベント）
'picker:selected'   // 要素が選ばれた
'run:step'          // ステップ進捗
'run:log'
'run:finished'
```

---

## 14. 配布

### Homebrew

homebrew-core は実績が必要で最初は通らない。**独自tapから始める。**

```
brew tap yourname/cvtest-kun
brew install --cask cvtest-kun
```

`homebrew-cvtest-kun` リポジトリに `Casks/cvtest-kun.rb`:

```ruby
cask "cvtest-kun" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "...",
         intel: "..."

  url "https://github.com/yourname/cvtest-kun/releases/download/v#{version}/CVTestKun-#{version}-#{arch}.dmg"
  name "CVテスト君"
  name "CV Test Kun"
  desc "Automated CV (conversion) form testing tool for Japanese websites"
  homepage "https://github.com/yourname/cvtest-kun"

  app "CVTestKun.app"
end
```

`.app` のファイル名は英字にする（日本語名だとパス周りで事故りやすい）。表示名の日本語化は `Info.plist` の `CFBundleDisplayName` で行う。

### 署名・公証

**OSSでも必須。** 未署名だとCask経由のインストールでGatekeeperに弾かれる。

- macOS: Apple Developer Program（年99ドル）+ `electron-builder` の notarize 設定
- Windows: コード署名証明書（年200〜500ドル程度）。未署名だとSmartScreen警告

### CI

GitHub Actions で `git tag` を打つと以下が走るようにする。

1. `electron-builder` でビルド・署名・公証
2. GitHub Releases にDMG/exeをアップロード
3. tapリポジトリの `version` と `sha256` を自動書き換えしてPR

---

## 15. ライセンス・README

MIT（Playwright: Apache-2.0、Electron: MIT と衝突しない）。

READMEの上部と LICENSE の両方に明記すること:

- 第三者のサイトに使う場合は必ず許可を得ること
- 本番環境での使用による損害について責任を負わない
- **CAPTCHA回避機能は持たない**（変な要求のIssueが減る）

READMEに最初から書く:

- できないこと一覧（CAPTCHA、認証必須ページ、closed Shadow DOM）
- **シナリオJSONの仕様**（公開しておくと他の人がツールを作れて採用が広がる）
- 動作確認済みフォームサービス一覧（formrun / HubSpot / Google Forms など）
- **対応済み媒体プリセット一覧**（qualva / Dairin / Gunosy Ads …）
- AIプロバイダを使うとDOM情報が外部に送信される旨（シナリオはローカル、解析は外部、の区別）

日本語READMEを主、英語READMEを `README.en.md` として併記。冒頭で「CV = conversion, not curriculum vitae」と明示しておくと海外からの誤解を防げる。

**訴求の軸**（実際の業界課題に基づく）:

> フォームは送れているのに、CVが計測されていない。
> 気づくのは、月末のレポートを見たときです。

対応サイト・媒体プリセットはIssueテンプレートを用意しておくと利用者報告で勝手に育つ。ここがOSSにした最大の利点。

---

## 16. 実装フェーズ

Claude Code に渡す順序。各フェーズで動く状態にしてからコミットする。

| # | 内容 | 完了条件 |
|---|---|---|
| 1 | Electron + Playwright 骨格 | URL入力 → ブラウザ起動 → スクショがUIに出る |
| 2 | `extract.ts` + `selector.ts` | 任意のフォームで `Field[]` と圧縮表現が出力される |
| 3 | 要素ピッカー | ホバーでハイライト、クリックでステップが追加される |
| 4 | `runner.ts` + 基本ステップ | fill/click/select/assert が通る。スクショとtraceが残る |
| 5 | `pickSlot` + 空き判定学習 | 予約カレンダーで空き枠を自動選択、`pickedDate` が記録される |
| 6 | AIプロバイダ抽象 + Ollama | 生成→レビューUI→実行のフローが通る |
| 7 | 計測タグ検証 + 発火回数チェック | GA4/広告タグの発火が `RunResult` に記録される |
| 8 | 媒体プリセット + 後始末チェックリスト | qualva形式のルールが自動適用され、cleanup.md が出力される |
| 9 | 他AIプロバイダ | |
| 10 | CLI版 + electron-builder + tap | `brew install --cask cvtest-kun` が通る |

### リリース前チェック

- `npm view cvtest` で名前の空きを確認（埋まっていれば `cvtest-kun`）
- `npx asar extract` で中身を確認（asarは暗号化ではない）
- sourcemapが同梱されていないか
- 署名・公証済みのビルドをクリーンなMacで起動確認
- 日本語ファイル名・パスで動作するか（`~/Documents/資料/` 等での実行テスト）
