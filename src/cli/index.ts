import { readFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { scenarioSchema, type Scenario } from '../types/scenario'
import { run } from '../engine/runner'
import { launch } from '../engine/browser'
import { extractFields, toCompact } from '../engine/extract'
import { BUILTIN_PRESETS, detectPreset } from '../presets/testcv'

const VERSION = '0.1.0'

const USAGE = `CVテスト君 (cvtest) v${VERSION}

使い方:
  cvtest run <scenario.json>      シナリオを実行する
  cvtest extract <url>            フォームの項目を抽出して表示する
  cvtest presets                  同梱の媒体プリセット一覧を表示する
  cvtest validate <scenario.json> シナリオの形式を検証する

オプション:
  --headless            ブラウザを表示せずに実行する
  --out <dir>           実行結果の保存先（既定: ~/.cvtest-kun/runs）
  --no-trace            Playwright trace を録らない
  --timeout <ms>        ステップのタイムアウト（既定: 15000）
  --delay <ms>          ステップ間のウェイト（既定: 400）
  --json                結果を JSON で標準出力に出す
  --channel <name>      使うブラウザ（chrome / msedge）
  -h, --help            このヘルプ
  -v, --version         バージョン

注意:
  このツールは実際にフォームを送信します。第三者のサイトに対して使う場合は
  必ず事前に運営者の許可を得てください。
`

interface Options {
  headless: boolean
  out: string
  trace: boolean
  timeout?: number
  delay?: number
  json: boolean
  channel?: string
}

function parseArgs(argv: string[]): { command?: string; target?: string; options: Options } {
  const options: Options = {
    headless: false,
    out: join(homedir(), '.cvtest-kun', 'runs'),
    trace: true,
    json: false
  }

  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--headless':
        options.headless = true
        break
      case '--no-trace':
        options.trace = false
        break
      case '--json':
        options.json = true
        break
      case '--out':
        options.out = resolve(argv[++i] ?? options.out)
        break
      case '--timeout':
        options.timeout = Number(argv[++i])
        break
      case '--delay':
        options.delay = Number(argv[++i])
        break
      case '--channel':
        options.channel = argv[++i]
        break
      default:
        if (arg.startsWith('-')) throw new Error(`不明なオプション: ${arg}`)
        positional.push(arg)
    }
  }

  return { command: positional[0], target: positional[1], options }
}

async function loadScenario(path: string): Promise<Scenario> {
  const raw = await readFile(resolve(path), 'utf8')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    throw new Error(`JSON として読めません: ${path}\n${(err as Error).message}`)
  }

  const parsed = scenarioSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`シナリオの形式が正しくありません:\n${issues}`)
  }
  return parsed.data
}

async function cmdRun(target: string, options: Options): Promise<number> {
  const scenario = await loadScenario(target)
  await mkdir(options.out, { recursive: true })

  const preset = detectPreset(scenario.url)
  if (preset && !options.json) {
    console.log(`媒体プリセット: ${preset.label}`)
    if (preset.warning) console.log(`  注意: ${preset.warning}`)
  }

  const result = await run(scenario, {
    runsDir: options.out,
    launch: { headless: options.headless, channel: options.channel },
    trace: options.trace,
    timeoutMs: options.timeout,
    stepDelayMs: options.delay,
    template: { env: process.env },
    onLog: (message) => {
      if (!options.json) console.log(message)
    }
  })

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log('')
    console.log(`結果: ${result.status}`)
    if (result.pickedDate) console.log(`選択した予約枠: ${result.pickedDate}`)
    console.log(`保存先: ${result.runDir}`)

    if (result.trackingEvents.length > 0) {
      console.log('')
      console.log('計測タグ発火:')
      for (const e of result.trackingEvents) {
        console.log(`  ${e.provider}${e.eventName ? ` / ${e.eventName}` : ''}: ${e.count} 回`)
      }
    } else {
      console.log('')
      console.log('計測タグの発火は検出されませんでした。')
    }

    if (result.cleanup.length > 0) {
      console.log('')
      console.log('後始末が必要です:')
      for (const item of result.cleanup) {
        console.log(`  [ ] ${item.text}`)
      }
    }

    if (result.error) {
      console.log('')
      console.error(`エラー: ${result.error}`)
    }
  }

  return result.status === 'success' ? 0 : 1
}

async function cmdExtract(target: string, options: Options): Promise<number> {
  const session = await launch({ headless: options.headless, channel: options.channel })
  try {
    await session.page.goto(target, { waitUntil: 'domcontentloaded' })
    const result = await extractFields(session.page)

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`${result.title}`)
      console.log(`${result.url}`)
      console.log('')
      console.log(toCompact(result.fields))

      const honeypots = result.fields.filter((f) => f.isHoneypot)
      if (honeypots.length > 0) {
        console.log('')
        console.log(`（ハニーポットとして除外: ${honeypots.length} 件）`)
      }
    }
    return 0
  } finally {
    await session.close()
  }
}

function cmdPresets(options: Options): number {
  if (options.json) {
    console.log(JSON.stringify(BUILTIN_PRESETS, null, 2))
    return 0
  }

  for (const preset of BUILTIN_PRESETS) {
    console.log(`${preset.id}  (${preset.label})`)
    const markers = preset.rules.nameFieldMustInclude
    if (markers?.length) {
      console.log(`  テストCV判定: 姓名欄に「${markers.join('」または「')}」を含める`)
    }
    console.log(`  後始末: ${preset.cleanup.auto ? '自動' : '手動が必要'}`)
    console.log(`    ${preset.cleanup.note}`)
    if (preset.warning) console.log(`  注意: ${preset.warning}`)
    console.log('')
  }
  return 0
}

async function cmdValidate(target: string): Promise<number> {
  const scenario = await loadScenario(target)
  console.log(`OK: ${scenario.name}`)
  console.log(`  URL: ${scenario.url}`)
  console.log(`  ステップ数: ${scenario.steps.length}`)

  const preset = detectPreset(scenario.url)
  if (preset) console.log(`  媒体プリセット: ${preset.label}`)

  return 0
}

export async function main(argv: string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    console.log(USAGE)
    return 0
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(VERSION)
    return 0
  }

  const { command, target, options } = parseArgs(argv)

  switch (command) {
    case 'run':
      if (!target) throw new Error('シナリオファイルを指定してください')
      return cmdRun(target, options)
    case 'extract':
      if (!target) throw new Error('URL を指定してください')
      return cmdExtract(target, options)
    case 'presets':
      return cmdPresets(options)
    case 'validate':
      if (!target) throw new Error('シナリオファイルを指定してください')
      return cmdValidate(target)
    default:
      console.error(`不明なコマンド: ${command ?? '(なし)'}`)
      console.log(USAGE)
      return 2
  }
}

/** シナリオの雛形。README に載せる仕様と一致させる。 */
export const EXAMPLE_SCENARIO: Scenario = {
  version: 1,
  name: 'お問い合わせフォーム',
  url: 'https://example.com/contact',
  variables: { company: 'サンプル' },
  stepDelayMs: 400,
  steps: [
    { id: 's1', type: 'fill', label: '会社名', selector: '#company', value: '【テスト】{{var.company}}株式会社' },
    { id: 's2', type: 'fill', label: 'お名前', selector: '#name', value: '【テスト】山田太郎' },
    { id: 's3', type: 'fill', label: 'メール', selector: '#email', value: 'test+{{timestamp}}@example.com' },
    { id: 's4', type: 'check', label: '同意', selector: '#agree', checked: true },
    { id: 's5', type: 'screenshot', name: 'before-submit' },
    { id: 's6', type: 'click', label: '確認画面へ', selector: 'button[type="submit"]' },
    { id: 's7', type: 'assert', label: '完了確認', selector: 'h1', mode: 'text', value: '送信完了' },
    { id: 's8', type: 'assertTracking', label: 'CV計測', provider: 'GA4', eventName: 'generate_lead', expectedCount: 1 }
  ],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}
