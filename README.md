# CVテスト君

> フォームは送れているのに、CVが計測されていない。
> 気づくのは、月末のレポートを見たときです。

CVフォーム（問い合わせ・予約）の入力から送信までを自動化し、**計測タグが本当に発火しているか**まで確認するデスクトップアプリです。

- **形態**: Electron ローカルアプリ（サーバーなし。データはすべて手元に残ります）
- **実行エンジン**: Playwright
- **ライセンス**: MIT

English README: [README.en.md](README.en.md)
（`CV` = conversion, **not** curriculum vitae）

---

## ⚠️ 最初に読んでください

**このツールは実際にフォームを送信し、実際に予約を入れます。**

- 第三者が運営するサイトに使う場合は、**必ず事前に運営者の許可を得てください**
- 本番環境での使用によって生じた損害について、作者は責任を負いません
- **CAPTCHA / reCAPTCHA を回避する機能は持ちません。今後も実装しません**
  （regexps ではなく規約の問題です。ステージング環境への差し替え、または IP allowlist で運用してください）

---

## できること

- URLを開いて、フォーム項目を**GUIでクリックして選ぶ**だけでシナリオが作れる
- 相対日付（`{{today+7}}`）と**空き枠の自動選択**に対応した予約カレンダー操作
- AIによるシナリオ自動生成（**人間のレビューを必ず挟む**）
- **計測タグの発火検証** — 発火の有無だけでなく**回数**まで数える
- 実行ごとにスクリーンショット・Playwright trace・結果JSONを保存
- **媒体別テストCVプリセット** — qualva / Dairin / Gunosy Ads のルールを内蔵

## できないこと（明記します）

| できないこと | 理由 |
|---|---|
| CAPTCHA / reCAPTCHA の回避 | 規約違反になるため。実装しません |
| ログイン必須ページの突破 | 認証情報は `{{secret.*}}` で渡せますが、多要素認証などは対象外 |
| closed Shadow DOM 内の要素操作 | ブラウザから触れないため |
| サーバー同期・アカウント機能 | ローカル完結の設計です |

---

## インストール

### GUI版（Homebrew Cask）

```bash
brew tap mochitablog0326-lgtm/cvtest-kun
brew install --cask cvtest-kun
```

### CLI版（npm）

```bash
npm install -g cvtest-kun
cvtest --help
```

### ブラウザについて

`playwright-core` を使っているためブラウザは同梱していません。
**Google Chrome がインストールされていればそのまま動きます。**
無い場合は次のどちらかで用意してください。

```bash
npx playwright install chromium
```

---

## 使い方（GUI）

1. **シナリオ** → 「新規作成」
2. URLを入力して「開く」→ ブラウザが起動します
3. 「ピッカーを開始」→ ブラウザ上で入力したい項目をクリック
   （ピッカー中のクリックは**送信されません**。ESCで解除）
4. 「編集画面へ」→ 値を入れるか、AIに生成させる
5. **生成された値を確認・修正してから**「実行する」

### 予約カレンダーの操作

カレンダーのセルをクリックすると、扱い方を聞かれます。

```
この日付をどう扱いますか？
 ○ この日付で固定する
 ○ 相対日付にする（今日から [ 7 ] 日後）
 ● 空いている枠から自動で選ぶ   ← 推奨
```

「空いている枠から自動で選ぶ」を選ぶと、**空き判定ルールの学習**に入ります。

1. 「空いている枠を1つクリックしてください」
2. 「埋まっている枠を1つクリックしてください」
3. 2つの差分（class / 属性 / `○△×` / リンクの有無）からルールを自動生成

サイトごとに空き表現がバラバラなので、決め打ちせず**その場で学習**します。

---

## 使い方（CLI）

```bash
# シナリオを実行する
cvtest run contact-form.json

# フォームの項目を抽出して確認する
cvtest extract https://example.com/contact

# 媒体プリセット一覧
cvtest presets

# シナリオの形式チェック
cvtest validate contact-form.json
```

| オプション | 意味 |
|---|---|
| `--headless` | ブラウザを表示せずに実行 |
| `--out <dir>` | 実行結果の保存先（既定 `~/.cvtest-kun/runs`） |
| `--no-trace` | Playwright trace を録らない |
| `--timeout <ms>` | ステップのタイムアウト（既定 15000） |
| `--delay <ms>` | ステップ間のウェイト（既定 400） |
| `--json` | 結果をJSONで標準出力へ |
| `--channel <name>` | 使うブラウザ（`chrome` / `msedge`） |

終了コードは成功で `0`、失敗で `1` です。CIに組み込めます。

---

## シナリオJSONの仕様

**この仕様は公開しています。** 他のツールから生成・変換して構いません。

```json
{
  "version": 1,
  "name": "お問い合わせフォーム",
  "url": "https://example.com/contact",
  "variables": { "company": "サンプル" },
  "stepDelayMs": 400,
  "presetId": "qualva",
  "steps": [
    { "id": "s1", "type": "fill", "label": "会社名", "selector": "#company",
      "value": "【テスト】{{var.company}}株式会社" },
    { "id": "s2", "type": "fill", "label": "メール", "selector": "#email",
      "value": "test+{{timestamp}}@example.com" },
    { "id": "s3", "type": "check", "selector": "#agree", "checked": true },
    { "id": "s4", "type": "screenshot", "name": "before-submit" },
    { "id": "s5", "type": "click", "label": "確認画面へ", "selector": "button[type=submit]" },
    { "id": "s6", "type": "assert", "selector": "h1", "mode": "text", "value": "送信完了" },
    { "id": "s7", "type": "assertTracking", "provider": "GA4",
      "eventName": "generate_lead", "expectedCount": 1 }
  ],
  "createdAt": "2026-09-01T00:00:00.000Z",
  "updatedAt": "2026-09-01T00:00:00.000Z"
}
```

### ステップの種類

| type | 必須フィールド | 説明 |
|---|---|---|
| `fill` | `selector`, `value` | テキスト入力 |
| `click` | `selector` | クリック。`waitAfter` で追加待機 |
| `select` | `selector`, `value` | プルダウン選択（value / ラベルどちらでも可） |
| `check` | `selector`, `checked` | チェックボックス・ラジオ |
| `pickDate` | `selector` | 日付を固定・相対指定でクリック |
| `pickSlot` | `grid`, `cell`, `available`, `strategy` | **空き枠の自動選択** |
| `wait` | `ms` または `selector` | 待機 |
| `assert` | `selector`, `mode` | 到達確認（`text` / `visible` / `url`） |
| `assertTracking` | `provider` | **計測タグの発火検証** |
| `screenshot` | `name` | スクリーンショット |

共通の任意フィールド: `label`（UI表示用）、`frame`（iframeセレクタ）、`optional`（失敗しても続行）。

### `pickSlot` の空き判定ルール

```json
{
  "type": "pickSlot",
  "grid": "#calendar table",
  "cell": "td.day",
  "available": {
    "notClass": ["full"],
    "notAttr": ["aria-disabled"],
    "textNotIn": ["×", "満"]
  },
  "range": { "minDaysAhead": 3, "maxDaysAhead": 30 },
  "strategy": "random",
  "nextMonth": "#next-month",
  "maxMonthNav": 3
}
```

| フィールド | 説明 |
|---|---|
| `hasClass` / `notClass` | 必要な/あってはならない class |
| `notAttr` | 立っていたら満席とみなす属性（`aria-disabled` など。値 `"false"` は無効扱いしない） |
| `textIn` / `textNotIn` | セルのテキストに含まれる/含まれない記号 |
| `hasChild` | 子要素セレクタ（空き枠だけリンクになっている場合） |
| `strategy` | `first` / `last` / `random`。**`random` にすると毎回同じ枠を潰しません** |
| `minDaysAhead` | 直近の枠を避ける |

### テンプレート記法

日付計算はすべて **JST固定**です（実行マシンのタイムゾーンに依存しません）。

| 記法 | 展開結果 |
|---|---|
| `{{timestamp}}` | `20260901143022` |
| `{{today\|YYYY-MM-DD}}` | `2026-09-01` |
| `{{today+7\|YYYY-MM-DD}}` | `2026-09-08` |
| `{{today+2w\|YYYY-MM-DD}}` | 2週間後（`d`/`w`/`m`/`y` が使えます） |
| `{{nextMonday\|M/D}}` | `9/7` |
| `{{random:6}}` | `a3f9k2` |
| `{{env.PASSWORD}}` | 環境変数 |
| `{{secret.LOGIN_PW}}` | safeStorage（OSキーチェーン）から復号 |
| `{{var.company}}` | `variables` の値 |

未定義の参照は**実行前に失敗します**。空文字を実フォームに送らないためです。

---

## 計測タグの検証

「フォームは送れているのにCVが計測されていない」は頻発する事故です。
ブラウザのリクエストを直接見るので、**管理画面の反映を待たずに即座に**判定できます。

検出対象:

| provider | パターン |
|---|---|
| GA4 | `google-analytics.com/g/collect` |
| Google Ads | `googleadservices.com/pagead/conversion` |
| Yahoo広告 | `b.yjtag.jp`, `s.yimg.jp/images/listing/tool/cv` |
| Meta | `facebook.com/tr` |
| GTM | `googletagmanager.com/gtm.js` |
| LINE / X / Microsoft Ads | それぞれのタグURL |

### 発火「回数」も数えます

GTMのトリガー設定でCSSセレクタの「一致する / しない」を取り違え、
資料請求ボタンだけを計測するはずが**ページ内の全ボタンで発火してCV数が水増しされる**、
という事故が実際にあります。`expectedCount` を書いておけば検出できます。

```json
{ "type": "assertTracking", "provider": "GA4",
  "eventName": "generate_lead", "expectedCount": 1 }
```

期待と違えば、水増しの可能性がある旨を添えて失敗します。

---

## 媒体別テストCVプリセット

媒体ごとに「テストCVと認識させる方法」は既に確立しています。内蔵しているので調べ直す必要はありません。

| 媒体 | テストCVと認識させる条件 | 事後処理 |
|---|---|---|
| **qualva** | 姓名入力欄のいずれかに「テスト」または「てすと」を含める | 毎日2時に自動削除。成果対象から除外される |
| **Dairin** | 特になし（通常CVとして計上される） | 管理画面の成果確認から**手動で非承認**にする必要あり |
| **Gunosy Ads** | 専用のコンバージョンURL経由でアクセス | 同一タグIDで成功済みなら再実施不要 |

**挙動:**

1. 実行時にURLから媒体を自動判定してプリセットを提案
2. AI生成・手動入力どちらでも、プリセットのルールを**後段で強制適用**
   （姓名に「テスト」が無ければ自動で付与。「会社名」は姓名欄と誤認しません）
3. ルールを満たさない値が残っていれば実行前に警告

> **重要**: qualva は「テストにもかかわらず途中で離脱するとダッシュボードの数値に影響する」とされています。
> **一度入力を開始したら必ず最後まで到達させてください。** 中断時はその旨を警告します。

プリセットは [`src/presets/data/presets.json`](src/presets/data/presets.json) にJSONで持っています。
**媒体の追加PRを歓迎します。**

---

## 後始末チェックリスト

実行後、結果と適用プリセットから「やるべき後始末」を自動生成して `cleanup.md` に保存します。

```
✅ 送信完了（2026-09-01 14:30）
⚠️ 後始末が必要です
   □ Dairin管理画面 > 成果確認 > 中間CV/最終CV から非承認にする
   □ 予約枠 2026-09-08 をキャンセルする
```

**選んだ予約枠は必ず記録されます。** 何を予約したか分からないと片付けられないためです。

---

## 保存されるもの

すべてローカルです。サーバーには何も送りません。

```
~/Library/Application Support/cvtest-kun/
  config.json
  presets/                       # 自分で追加した媒体プリセット
  cache/ai/                      # AI生成のキャッシュ
  runs/2026-09-01T14-30-22/
    before-submit.png
    after-submit.png
    trace.zip                    # npx playwright show-trace で開けます
    result.json
    cleanup.md
```

シナリオの保存先は**任意のフォルダを指定できます**。Git管理やクラウド同期は各自でどうぞ。

```
~/Documents/cvtest-scenarios/
  contact-form.json
  reservation.json
```

---

## AIによる値の生成

### 設計方針: **AIにセレクタを書かせません**

- セレクタの抽出は決定的なコードで実DOMから行う
- AIは「各項目に何を入れるか」だけを決める
- AIには `f1` `f2` … の仮IDで答えさせ、コード側で実セレクタに戻す

これによりAIが存在しない要素を指すことが**原理的に起きません**。
AI出力はスキーマ検証に加えて、未知のID・ハニーポット・選択肢外の値・長さ超過を破棄します。

### 対応プロバイダ

| プロバイダ | 備考 |
|---|---|
| **Ollama**（ローカル） | DOM情報を外部に出せない社内フォーム向け |
| Claude Code CLI | `claude` コマンド |
| Codex CLI | `codex` コマンド |
| Gemini CLI | `gemini` コマンド |
| OpenAI API | APIキーは safeStorage か環境変数から |

> **AIプロバイダを使うと、フォームの項目情報（ラベル・型）が外部に送信されます。**
> シナリオはローカル、解析は外部、という区別を理解して使ってください。
> 外部に出せない場合は Ollama を使ってください。
>
> CLI系プロバイダについて: サブスク認証を他アプリのバックエンドとして使えるかは
> **各サービスの利用規約次第**です。各自で確認のうえ自己責任でお使いください。
> また CLI のフラグはバージョンで変わります。動かない場合は `<command> --help` で確認してください。

### 「生成」と「実行」は別のボタンです

AI出力は必ずUIに表示され、**人間が確認・修正してからでないと実行できません**。

---

## 安全のための作り

| リスク | 対策 |
|---|---|
| 本番フォームへの誤送信 | 氏名・会社名に `【テスト】` を付けるテンプレを標準提供。メールは `+{{timestamp}}` |
| AI生成のまま送信 | **生成ボタンと実行ボタンを分離。** レビュー必須 |
| 予約枠を潰す | `minDaysAhead` で直近を避ける。`strategy: random` で分散。後始末リストに枠を記載 |
| ハニーポット | hidden / `display:none` / 幅0 / 画面外の項目は**入力しません** |
| 送信速度制限 | ステップ間に既定 400ms のウェイト |
| プロンプトインジェクション | AI出力はスキーマで縛り、セレクタは自前抽出のものにしか対応付けない |
| 秘密情報の平文保存 | `safeStorage`（OSキーチェーン）か `{{env.*}}` 参照 |
| テスト成果の残留 | 後始末チェックリストを自動生成 |

---

## 動作確認済みのフォームサービス

| サービス | 状況 |
|---|---|
| 素のHTMLフォーム（table / dl レイアウト含む） | ✅ |
| 確認画面を挟む2ページ構成 | ✅ |
| iframe埋め込みフォーム | ✅ |

formrun / HubSpot / Google Forms などの報告を歓迎します。
[動作報告のIssue](https://github.com/mochitablog0326-lgtm/cvtest-kun/issues/new/choose) からどうぞ。

---

## 開発

```bash
npm install
npm run dev          # Electron を開発モードで起動
npm test             # テスト（実ブラウザを使います）
npm run typecheck
npm run build        # electron-vite build
npm run build:cli    # CLI版をビルド
npm run dist:mac     # DMG を作る
```

ディレクトリ構成は [docs/DESIGN.md](docs/DESIGN.md) を参照してください。
`src/engine/` をGUI版とCLI版で共有しています。

---

## コントリビュート

特に歓迎するもの:

- **媒体プリセットの追加**（`src/presets/data/presets.json`）
- **動作確認済みフォームサービスの報告**
- セレクタ生成・ラベル解決が効かなかったフォームの報告

CAPTCHA回避に関するIssue・PRはお受けできません。

## ライセンス

MIT — [LICENSE](LICENSE)
