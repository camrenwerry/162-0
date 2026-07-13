import Logo162 from '../Logo162'
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
      <div className="results-shell">
        <button className="results-home" type="button" onClick={onHome}>Home</button>
        <Logo162 className="results-logo" />
        <span className="results-kicker">Classic draft complete</span>
        <section className="projected-record" aria-label="Placeholder projected record">
          <small>Projected record</small>
          <strong>98–64</strong>
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
        <button className="results-play-again" type="button" onClick={onPlayAgain}>Play Again</button>
      </div>
    </main>
  )
}
