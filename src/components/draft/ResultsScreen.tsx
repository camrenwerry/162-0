import DiamondDraftLogo from '../DiamondDraftLogo'
import GameMenu from '../GameMenu'
import { POSITIONS, type Roster } from '../../types/draft'

interface ResultsScreenProps {
  roster: Roster
  onPlayAgain: () => void
  onHome: () => void
}

export default function ResultsScreen({ roster, onPlayAgain, onHome }: ResultsScreenProps) {
  return (
    <main className="results-screen">
      <div className="results-screen__glow" aria-hidden="true" />
      <div className="results-particles" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="results-shell">
        <GameMenu className="results-game-menu" confirmHome={false} onHome={onHome} onRestart={onPlayAgain} />
        <button className="results-home" type="button" onClick={onHome}>Home</button>
        <DiamondDraftLogo className="results-logo" compact />
        <span className="results-kicker">Season Complete</span>
        <section className="projected-record" aria-label="Placeholder projected record">
          <div className="results-trophy" aria-hidden="true">
            <span>⚾</span>
            <svg viewBox="0 0 48 48"><path d="M14 7h20v10c0 8-4 14-10 14s-10-6-10-14V7Zm4 25h12M24 31v8M17 41h14M14 11H7v4c0 5 3 8 8 8m19-12h7v4c0 5-3 8-8 8" /></svg>
          </div>
          <small>Projected record</small>
          <strong>98–64</strong>
          <b>Championship Contender</b>
          <span>Prototype projection</span>
        </section>
        <section className="results-roster">
          <div className="results-roster__heading"><h1>Completed roster</h1><span>11 / 11</span></div>
          <div className="results-roster__list">
            {POSITIONS.map((position) => (
              <div key={position}>
                <strong>{position}</strong>
                <span>{roster[position]?.name ?? '—'}</span>
                <small>{roster[position]?.team} {roster[position]?.decade}</small>
              </div>
            ))}
          </div>
        </section>
        <button className="results-play-again" type="button" onClick={onPlayAgain}>New Game</button>
      </div>
    </main>
  )
}
