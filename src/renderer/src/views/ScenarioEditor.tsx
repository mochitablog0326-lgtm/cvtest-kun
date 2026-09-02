import { useEffect, useState } from 'react'
import type { Scenario, Step } from '../../../types/scenario'
import type { ExtractResult, Field } from '../../../types/field'
import type { RunResult, StepResult } from '../../../types/result'
import type { TestCvPreset } from '../../../types/preset'

interface Props {
  scenario: Scenario
  path?: string
  onChange: (scenario: Scenario) => void
  onSaved: (path: string) => void
  onFinished: () => void
}

interface ProviderInfo {
  id: string
  label: string
  available: boolean
}

interface GenerateResult {
  values: Record<string, string | boolean>
  submit?: string
  notes: string[]
  fromCache: boolean
  presetId?: string
}

export function ScenarioEditor({
  scenario,
  path,
  onChange,
  onSaved,
  onFinished
}: Props): JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [providerId, setProviderId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [fields, setFields] = useState<Field[]>([])
  const [generated, setGenerated] = useState<GenerateResult | undefined>()
  const [preset, setPreset] = useState<TestCvPreset | undefined>()
  const [log, setLog] = useState<string[]>([])
  const [stepResults, setStepResults] = useState<StepResult[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const list = (await window.api.ai.listProviders()) as ProviderInfo[]
        setProviders(list)
        setProviderId(list.find((p) => p.available)?.id ?? '')
        const detected = (await window.api.presets.detect(scenario.url)) as
          | TestCvPreset
          | undefined
        setPreset(detected)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [scenario.url])

  useEffect(() => {
    const offLog = window.api.events.onRunLog((message) =>
      setLog((prev) => [...prev, message])
    )
    const offStep = window.api.events.onRunStep((step) =>
      setStepResults((prev) => [...prev, step])
    )
    const offFinished = window.api.events.onRunFinished(() => setRunning(false))
    return () => {
      offLog()
      offStep()
      offFinished()
    }
  }, [])

  const fail = (err: unknown): void => setError(err instanceof Error ? err.message : String(err))

  const update = (patch: Partial<Scenario>): void => onChange({ ...scenario, ...patch })

  const save = async (): Promise<void> => {
    try {
      const saved = (await window.api.scenario.save(scenario, path)) as string
      onSaved(saved)
      setError('')
    } catch (err) {
      fail(err)
    }
  }

  const loadFields = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.browser.open(scenario.url)
      const result = (await window.api.extract.fields()) as ExtractResult
      setFields(result.fields)
      setError('')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 生成するだけ。実行はしない（設計 §11）。
   * AI出力は必ずここで人間が確認・修正してから実行に進む。
   */
  const generate = async (refresh = false): Promise<void> => {
    if (fields.length === 0) {
      setError('先に「項目を読み込む」を実行してください')
      return
    }
    setBusy(true)
    try {
      const result = (await window.api.ai.generate({
        providerId,
        fields,
        ctx: { url: scenario.url, title: scenario.name, purpose },
        presetId: preset?.id,
        refresh
      })) as GenerateResult
      setGenerated(result)
      setError('')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /** レビュー済みの値をステップに反映する。 */
  const applyGenerated = async (): Promise<void> => {
    if (!generated) return
    try {
      const steps = (await window.api.ai.toSteps({
        fields,
        values: generated.values,
        submit: generated.submit
      })) as Step[]
      update({ steps })
      setGenerated(undefined)
    } catch (err) {
      fail(err)
    }
  }

  const start = async (): Promise<void> => {
    if (
      !window.confirm(
        `「${scenario.name}」を実行します。\n\n実際にフォームが送信されます。よろしいですか？`
      )
    ) {
      return
    }
    setLog([])
    setStepResults([])
    setRunning(true)
    try {
      await window.api.run.start(scenario)
      onFinished()
    } catch (err) {
      fail(err)
    } finally {
      setRunning(false)
    }
  }

  const editValue = (ref: string, value: string | boolean): void => {
    if (!generated) return
    setGenerated({ ...generated, values: { ...generated.values, [ref]: value } })
  }

  const fieldOf = (ref: string): Field | undefined => fields.find((f) => f.ref === ref)

  return (
    <>
      {error && <div className="banner danger">{error}</div>}

      {preset && (
        <div className="banner warn">
          <strong>{preset.label}</strong> のテストCVルールを適用します。
          {preset.warning && <div>{preset.warning}</div>}
          {!preset.cleanup.auto && <div>実行後に手動の後始末が必要です。</div>}
        </div>
      )}

      <div className="panel">
        <h2>シナリオ</h2>
        <div className="row">
          <input
            className="grow"
            value={scenario.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="シナリオ名"
          />
        </div>
        <div className="row">
          <input
            className="grow"
            value={scenario.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="URL"
          />
        </div>
        <div className="row">
          <button onClick={() => void save()}>保存</button>
          <button onClick={() => void loadFields()} disabled={busy}>
            項目を読み込む
          </button>
          <span className="grow" />
          <button className="primary" onClick={() => void start()} disabled={running}>
            {running ? '実行中…' : '実行する'}
          </button>
          {running && (
            <button className="danger" onClick={() => void window.api.run.abort()}>
              中断
            </button>
          )}
        </div>
      </div>

      {fields.length > 0 && (
        <div className="panel">
          <h2>AIで値を生成</h2>
          <div className="row">
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              style={{ maxWidth: 260 }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? '' : '（利用不可）'}
                </option>
              ))}
            </select>
            <input
              className="grow"
              placeholder="用途（例: 資料請求）"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
            <button onClick={() => void generate(false)} disabled={!providerId || busy}>
              生成
            </button>
            <button onClick={() => void generate(true)} disabled={!providerId || busy}>
              再生成
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            生成しただけでは送信されません。内容を確認してから「ステップに反映」してください。
          </p>
        </div>
      )}

      {generated && (
        <div className="panel">
          <h2>生成結果のレビュー{generated.fromCache && '（キャッシュ）'}</h2>

          {generated.notes.length > 0 && (
            <div className="banner warn">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {generated.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>値</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(generated.values).map(([ref, value]) => {
                const field = fieldOf(ref)
                return (
                  <tr key={ref}>
                    <td>
                      {field?.label || ref}
                      {field?.required && <span className="muted"> 必須</span>}
                    </td>
                    <td>
                      {typeof value === 'boolean' ? (
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={value}
                          onChange={(e) => editValue(ref, e.target.checked)}
                        />
                      ) : (
                        <input value={value} onChange={(e) => editValue(ref, e.target.value)} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => void applyGenerated()}>
              ステップに反映
            </button>
            <button onClick={() => setGenerated(undefined)}>破棄</button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>ステップ（{scenario.steps.length}）</h2>
        {scenario.steps.length === 0 ? (
          <div className="empty">ステップがありません。</div>
        ) : (
          <table className="steps-table">
            <colgroup>
              <col className="c-num" />
              <col className="c-type" />
              <col className="c-label" />
              <col className="c-value" />
              <col className="c-status" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>種類</th>
                <th>ラベル</th>
                <th>値</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {scenario.steps.map((step, index) => {
                const result = stepResults.find((r) => r.id === step.id)
                return (
                  <tr key={step.id}>
                    <td className="muted">{index + 1}</td>
                    <td>
                      <span className="pill">{step.type}</span>
                    </td>
                    <td className="ellipsis" title={step.label ?? ''}>
                      {step.label ?? ''}
                    </td>
                    <td>
                      {'value' in step ? (
                        <input
                          value={String(step.value ?? '')}
                          onChange={(e) => {
                            const steps = scenario.steps.map((s) =>
                              s.id === step.id ? { ...s, value: e.target.value } : s
                            )
                            update({ steps: steps as Step[] })
                          }}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {result && <span className={`pill ${result.status}`}>{result.status}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {log.length > 0 && (
        <div className="panel">
          <h2>実行ログ</h2>
          <pre className="log">{log.join('\n')}</pre>
        </div>
      )}
    </>
  )
}

export type { RunResult }
