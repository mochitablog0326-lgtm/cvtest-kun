import { useState } from 'react'
import { ScenarioList } from './views/ScenarioList'
import { Recorder } from './views/Recorder'
import { ScenarioEditor } from './views/ScenarioEditor'
import { RunResultView } from './views/RunResult'
import type { Scenario } from '../../types/scenario'

export type View = 'list' | 'recorder' | 'editor' | 'result'

export function App(): JSX.Element {
  const [view, setView] = useState<View>('list')
  const [scenario, setScenario] = useState<Scenario | undefined>()
  const [scenarioPath, setScenarioPath] = useState<string | undefined>()

  const openEditor = (next: Scenario, path?: string): void => {
    setScenario(next)
    setScenarioPath(path)
    setView('editor')
  }

  const nav = (target: View, label: string, enabled = true): JSX.Element => (
    <button
      className={`nav-item ${view === target ? 'active' : ''}`}
      onClick={() => setView(target)}
      disabled={!enabled}
    >
      {label}
    </button>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>CVテスト君</h1>
        {nav('list', 'シナリオ')}
        {nav('recorder', '録画・ピッカー')}
        {nav('editor', '編集', Boolean(scenario))}
        {nav('result', '実行結果')}
      </aside>

      <main className="main">
        {view === 'list' && <ScenarioList onOpen={openEditor} onNew={() => setView('recorder')} />}
        {view === 'recorder' && <Recorder onCreated={openEditor} />}
        {view === 'editor' && scenario && (
          <ScenarioEditor
            scenario={scenario}
            path={scenarioPath}
            onChange={setScenario}
            onSaved={setScenarioPath}
            onFinished={() => setView('result')}
          />
        )}
        {view === 'result' && <RunResultView />}
      </main>
    </div>
  )
}
