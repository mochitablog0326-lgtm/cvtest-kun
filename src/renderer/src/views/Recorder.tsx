import { useEffect, useRef, useState } from 'react'
import type { Scenario, Step, AvailableRule } from '../../../types/scenario'
import type { ExtractResult, Field } from '../../../types/field'
import type { PickedElement } from '../../../types/picker'

interface Props {
  onCreated: (scenario: Scenario) => void
}

/** カレンダーセルをクリックしたときの選択肢（設計 §7）。 */
type DateMode = 'fixed' | 'relative' | 'auto'

interface LearnState {
  /** 空き枠と満席枠を1つずつクリックさせる学習フロー */
  stage: 'available' | 'full'
  grid: string
  cell: string
  available?: PickedElement
}

let stepSeq = 0
const newId = (): string => `s${++stepSeq}-${Math.random().toString(36).slice(2, 6)}`

export function Recorder({ onCreated }: Props): JSX.Element {
  const [url, setUrl] = useState('')
  const [opened, setOpened] = useState(false)
  const [picking, setPicking] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [dialog, setDialog] = useState<PickedElement | undefined>()
  const [dateMode, setDateMode] = useState<DateMode>('auto')
  const [daysAhead, setDaysAhead] = useState(7)
  const [learn, setLearn] = useState<LearnState | undefined>()

  const [fields, setFields] = useState<Field[]>([])
  const [pageInfo, setPageInfo] = useState<{ title: string; url: string; pageHeading?: string }>()

  // 状態をイベントハンドラから参照するため ref に写す
  const learnRef = useRef<LearnState | undefined>(undefined)
  learnRef.current = learn

  useEffect(() => {
    const off = window.api.events.onPickerSelected((picked) => {
      const learning = learnRef.current
      if (learning) {
        void handleLearnPick(picked, learning)
        return
      }
      if (picked.looksLikeCalendarCell) {
        setDialog(picked)
        return
      }
      addStepFor(picked)
    })
    return off
  }, [])

  const fail = (err: unknown): void => setError(err instanceof Error ? err.message : String(err))

  const open = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.browser.open(url)
      setOpened(true)
      setError('')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const togglePicker = async (): Promise<void> => {
    try {
      if (picking) {
        await window.api.browser.stopPicker()
        setPicking(false)
        setLearn(undefined)
      } else {
        await window.api.browser.startPicker()
        setPicking(true)
      }
    } catch (err) {
      fail(err)
    }
  }

  const extract = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = (await window.api.extract.fields()) as ExtractResult
      setFields(result.fields)
      setPageInfo({ title: result.title, url: result.url, pageHeading: result.pageHeading })
      setError('')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /** 通常の要素 → 型に応じたステップを足す。 */
  const addStepFor = (picked: PickedElement): void => {
    const label = picked.label || picked.text || picked.tagName
    const base = { id: newId(), label }

    const type = (picked.inputType ?? '').toLowerCase()
    if (picked.tagName === 'select') {
      setSteps((prev) => [...prev, { ...base, type: 'select', selector: picked.selector, value: '' }])
      return
    }
    if (type === 'checkbox' || type === 'radio') {
      setSteps((prev) => [
        ...prev,
        { ...base, type: 'check', selector: picked.selector, checked: true }
      ])
      return
    }
    if (picked.tagName === 'button' || ['submit', 'button'].includes(type)) {
      setSteps((prev) => [...prev, { ...base, type: 'click', selector: picked.selector }])
      return
    }
    setSteps((prev) => [...prev, { ...base, type: 'fill', selector: picked.selector, value: '' }])
  }

  /** カレンダーダイアログの決定。 */
  const confirmDate = (): void => {
    if (!dialog) return
    const label = `日付を選ぶ（${dialog.text || dialog.selector}）`

    if (dateMode === 'fixed') {
      const date = dialog.attrs['data-date']
      setSteps((prev) => [
        ...prev,
        {
          id: newId(),
          label,
          type: 'pickDate',
          selector: date ? `[data-date="${date}"]` : dialog.selector
        }
      ])
      setDialog(undefined)
      return
    }

    if (dateMode === 'relative') {
      setSteps((prev) => [
        ...prev,
        {
          id: newId(),
          label: `${daysAhead}日後を選ぶ`,
          type: 'pickDate',
          selector: `[data-date="{{today+${daysAhead}|YYYY-MM-DD}}"]`
        }
      ])
      setDialog(undefined)
      return
    }

    // 空き枠の自動選択 → 判定ルールの学習フローへ（設計 §7）
    setLearn({
      stage: 'available',
      grid: guessGrid(dialog),
      cell: guessCell(dialog)
    })
    setDialog(undefined)
  }

  const handleLearnPick = async (picked: PickedElement, current: LearnState): Promise<void> => {
    if (current.stage === 'available') {
      setLearn({ ...current, stage: 'full', available: picked })
      return
    }

    if (!current.available) return
    try {
      const rule = (await window.api.browser.learnRule(current.available, picked)) as AvailableRule

      if (Object.keys(rule).length === 0) {
        setError(
          '2つの枠の見た目に違いが見つかりませんでした。空き枠と満席枠をもう一度選び直してください。'
        )
        setLearn({ stage: 'available', grid: current.grid, cell: current.cell })
        return
      }

      setSteps((prev) => [
        ...prev,
        {
          id: newId(),
          label: '空いている枠を自動で選ぶ',
          type: 'pickSlot',
          grid: current.grid,
          cell: current.cell,
          available: rule,
          // 直近の枠を避けるのを既定にする（設計 §11）
          range: { minDaysAhead: 1 },
          strategy: 'random',
          maxMonthNav: 3
        }
      ])
      setLearn(undefined)
      setError('')
    } catch (err) {
      fail(err)
    }
  }

  const save = (): void => {
    if (!url) return
    const now = new Date().toISOString()
    onCreated({
      version: 1,
      name: pageInfo?.title || new URL(url).hostname,
      url,
      steps,
      createdAt: now,
      updatedAt: now
    })
  }

  return (
    <>
      {error && <div className="banner danger">{error}</div>}

      <div className="panel">
        <h2>1. ページを開く</h2>
        <div className="row">
          <input
            className="grow"
            placeholder="https://example.com/contact"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="primary" onClick={() => void open()} disabled={!url || busy}>
            開く
          </button>
        </div>
      </div>

      {opened && (
        <div className="panel">
          <h2>2. 項目を選ぶ</h2>
          <div className="row">
            <button onClick={() => void togglePicker()}>
              {picking ? 'ピッカーを止める' : 'ピッカーを開始'}
            </button>
            <button onClick={() => void extract()} disabled={busy}>
              項目を自動抽出
            </button>
            <span className="muted grow">
              {picking
                ? 'ブラウザ上で要素をクリックしてください（ESCで解除）'
                : 'ピッカー中のクリックは送信されません'}
            </span>
          </div>

          {learn && (
            <div className="banner warn" style={{ marginTop: 12 }}>
              {learn.stage === 'available'
                ? '空いている枠を1つクリックしてください'
                : '埋まっている枠を1つクリックしてください'}
            </div>
          )}

          {fields.length > 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              {fields.filter((f) => !f.isHoneypot).length} 項目を検出（ハニーポット
              {fields.filter((f) => f.isHoneypot).length} 件は除外）
            </p>
          )}
        </div>
      )}

      {dialog && (
        <div className="panel">
          <h2>この日付をどう扱いますか？</h2>
          <div className="row">
            <label>
              <input
                type="radio"
                checked={dateMode === 'fixed'}
                onChange={() => setDateMode('fixed')}
              />{' '}
              この日付で固定する
            </label>
          </div>
          <div className="row">
            <label>
              <input
                type="radio"
                checked={dateMode === 'relative'}
                onChange={() => setDateMode('relative')}
              />{' '}
              相対日付にする（今日から
              <input
                type="number"
                style={{ width: 70, display: 'inline-block', margin: '0 6px' }}
                value={daysAhead}
                onChange={(e) => setDaysAhead(Number(e.target.value))}
              />
              日後）
            </label>
          </div>
          <div className="row">
            <label>
              <input
                type="radio"
                checked={dateMode === 'auto'}
                onChange={() => setDateMode('auto')}
              />{' '}
              空いている枠から自動で選ぶ（推奨）
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={confirmDate}>
              決定
            </button>
            <button onClick={() => setDialog(undefined)}>やめる</button>
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <div className="panel">
          <h2>3. ステップ（{steps.length}）</h2>
          <table>
            <tbody>
              {steps.map((step, index) => (
                <tr key={step.id}>
                  <td className="muted">{index + 1}</td>
                  <td>
                    <span className="pill">{step.type}</span>
                  </td>
                  <td>{step.label ?? ''}</td>
                  <td>
                    <button onClick={() => setSteps((prev) => prev.filter((s) => s.id !== step.id))}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={save}>
              編集画面へ
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** カレンダー全体のセレクタを推測する。ユーザーが編集画面で直せる。 */
function guessGrid(picked: PickedElement): string {
  const classes = picked.classes.filter((c) => /calendar|cal|schedule|month/i.test(c))
  if (classes.length > 0) return `.${classes[0]}`
  return 'table'
}

/** セル1つのセレクタを推測する。 */
function guessCell(picked: PickedElement): string {
  const stable = picked.classes.filter((c) => !/selected|active|today|hover/i.test(c))
  if (stable.length > 0) return `${picked.tagName}.${stable[0]}`
  return picked.tagName
}
