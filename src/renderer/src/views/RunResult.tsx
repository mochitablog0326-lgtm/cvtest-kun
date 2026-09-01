import { useEffect, useState } from 'react'
import type { RunResult } from '../../../types/result'

interface RunEntry {
  dir: string
  at: string
}

export function RunResultView(): JSX.Element {
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [selected, setSelected] = useState<RunResult | undefined>()
  const [error, setError] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      const list = (await window.api.run.list()) as RunEntry[]
      setRuns(list)
      if (list[0]) await open(list[0].dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const open = async (dir: string): Promise<void> => {
    try {
      setSelected((await window.api.run.load(dir)) as RunResult)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <>
      {error && <div className="banner danger">{error}</div>}

      <div className="panel">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            実行結果
          </h2>
          <select
            style={{ maxWidth: 320 }}
            value={selected?.runDir ?? ''}
            onChange={(e) => void open(e.target.value)}
          >
            {runs.map((run) => (
              <option key={run.dir} value={run.dir}>
                {run.dir.split('/').pop()}
              </option>
            ))}
          </select>
          <button onClick={() => void refresh()}>再読込</button>
        </div>
      </div>

      {!selected ? (
        <div className="panel">
          <div className="empty">実行結果がありません。</div>
        </div>
      ) : (
        <>
          <div
            className={`banner ${selected.status === 'success' ? 'ok' : 'danger'}`}
          >
            {selected.status === 'success' ? '送信完了' : `失敗: ${selected.error ?? ''}`}
            （{selected.startedAt.slice(0, 19).replace('T', ' ')}）
          </div>

          {selected.pickedDate && (
            <div className="banner warn">
              選択した予約枠: <strong>{selected.pickedDate}</strong>
            </div>
          )}

          {selected.cleanup.length > 0 && (
            <div className="panel">
              <h2>後始末チェックリスト</h2>
              <ul className="checklist">
                {selected.cleanup.map((item, i) => (
                  <li key={i}>
                    <label>
                      <input type="checkbox" style={{ width: 'auto', marginRight: 8 }} />
                      {item.text}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel">
            <h2>計測タグ発火</h2>
            {selected.trackingEvents.length === 0 ? (
              <div className="banner danger">
                計測タグの発火が検出されませんでした。フォームは送れていても
                CVが計測されていない可能性があります。
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>提供元</th>
                    <th>イベント</th>
                    <th>回数</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.trackingEvents.map((event, i) => (
                    <tr key={i}>
                      <td>{event.provider}</td>
                      <td>{event.eventName ?? '—'}</td>
                      <td>
                        {event.count}
                        {event.count > 1 && (
                          <span className="muted"> 重複発火の可能性</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <h2>ステップ</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>種類</th>
                  <th>ラベル</th>
                  <th>状態</th>
                  <th>時間</th>
                  <th>メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {selected.steps.map((step, i) => (
                  <tr key={step.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <span className="pill">{step.type}</span>
                    </td>
                    <td>{step.label ?? ''}</td>
                    <td>
                      <span className={`pill ${step.status}`}>{step.status}</span>
                    </td>
                    <td className="muted">{step.durationMs}ms</td>
                    <td className="muted">{step.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h2>保存物</h2>
            <div className="row">
              <span className="muted grow">{selected.runDir}</span>
              <button onClick={() => void window.api.run.reveal(selected.runDir)}>
                フォルダを開く
              </button>
              {selected.tracePath && (
                <button onClick={() => void window.api.run.openTrace(selected.runDir)}>
                  trace を表示
                </button>
              )}
            </div>
            <p className="muted">
              スクリーンショット {selected.screenshots.length} 枚 / trace は
              <code> npx playwright show-trace </code>で開けます。
            </p>
          </div>
        </>
      )}
    </>
  )
}
