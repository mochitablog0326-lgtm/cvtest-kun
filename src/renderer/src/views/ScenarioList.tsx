import { useEffect, useState } from 'react'
import type { Scenario } from '../../../types/scenario'

interface Summary {
  path: string
  name: string
  url: string
  updatedAt: string
  steps: number
}

interface Props {
  onOpen: (scenario: Scenario, path: string) => void
  onNew: () => void
}

export function ScenarioList({ onOpen, onNew }: Props): JSX.Element {
  const [items, setItems] = useState<Summary[]>([])
  const [dir, setDir] = useState<string>('')
  const [error, setError] = useState<string>('')

  const refresh = async (): Promise<void> => {
    try {
      const config = (await window.api.config.load()) as { scenarioDir: string }
      setDir(config.scenarioDir)
      setItems((await window.api.scenario.list()) as Summary[])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const open = async (path: string): Promise<void> => {
    try {
      const scenario = (await window.api.scenario.load(path)) as Scenario
      onOpen(scenario, path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async (path: string, name: string): Promise<void> => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return
    try {
      await window.api.scenario.delete(path)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const chooseDir = async (): Promise<void> => {
    const picked = await window.api.scenario.chooseDir()
    if (picked) await refresh()
  }

  return (
    <>
      <div className="banner warn">
        このツールは実際にフォームを送信し、実際に予約を入れます。第三者のサイトに使う場合は
        必ず事前に運営者の許可を得てください。
      </div>

      {error && <div className="banner danger">{error}</div>}

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }} className="grow">
            シナリオ
          </h2>
          <button onClick={() => void refresh()}>再読込</button>
          <button className="primary" onClick={onNew}>
            新規作成
          </button>
        </div>
        <div className="row">
          <span className="muted grow">保存先: {dir || '(未設定)'}</span>
          <button onClick={() => void chooseDir()}>保存先を変更</button>
        </div>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <div className="empty">
            シナリオがありません。「新規作成」からフォームを録画してください。
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>URL</th>
                <th>ステップ</th>
                <th>更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.path}>
                  <td>{item.name}</td>
                  <td className="muted">{item.url}</td>
                  <td>{item.steps}</td>
                  <td className="muted">{item.updatedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <div className="row">
                      <button onClick={() => void open(item.path)}>開く</button>
                      <button onClick={() => void remove(item.path, item.name)}>削除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
