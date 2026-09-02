import { useState } from 'react'
import type { Scenario, Step } from '../../../types/scenario'
import type { ExtractResult, Field } from '../../../types/field'
import { PickerPane } from '../components/PickerPane'

interface Props {
  onCreated: (scenario: Scenario) => void
}

export function Recorder({ onCreated }: Props): JSX.Element {
  const [url, setUrl] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [pageTitle, setPageTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const extract = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = (await window.api.extract.fields()) as ExtractResult
      setFields(result.fields)
      setPageTitle(result.title)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const save = (): void => {
    if (!url) return
    const now = new Date().toISOString()
    let name = pageTitle
    if (!name) {
      try {
        name = new URL(url).hostname
      } catch {
        name = '新しいシナリオ'
      }
    }
    onCreated({ version: 1, name, url, steps, createdAt: now, updatedAt: now })
  }

  return (
    <>
      {error && <div className="banner danger">{error}</div>}

      <PickerPane
        url={url}
        onUrlChange={setUrl}
        onStep={(step) => setSteps((prev) => [...prev, step])}
        title="1. ページを開いて項目を選ぶ"
      />

      {url && (
        <div className="panel">
          <h2>2. 項目の自動抽出（任意）</h2>
          <div className="row">
            <button onClick={() => void extract()} disabled={busy}>
              項目を自動抽出
            </button>
            <span className="muted grow">
              {fields.length > 0
                ? `${fields.filter((f) => !f.isHoneypot).length} 項目を検出（ハニーポット ${
                    fields.filter((f) => f.isHoneypot).length
                  } 件は除外）`
                : 'AI生成を使う場合は、編集画面から読み込むこともできます'}
            </span>
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <div className="panel">
          <h2>3. ステップ（{steps.length}）</h2>
          <table className="steps-table">
            <colgroup>
              <col className="c-num" />
              <col className="c-type" />
              <col className="c-label" />
              <col className="c-actions" />
            </colgroup>
            <tbody>
              {steps.map((step, index) => (
                <tr key={step.id}>
                  <td className="muted">{index + 1}</td>
                  <td>
                    <span className="pill">{step.type}</span>
                  </td>
                  <td className="ellipsis" title={step.label ?? ''}>
                    {step.label ?? ''}
                  </td>
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
