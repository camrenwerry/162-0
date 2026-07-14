import { useMemo } from 'react'
import DiamondDraftLogo from '../DiamondDraftLogo'
import GameMenu from '../GameMenu'
import { ROSTER_SLOTS, type Roster } from '../../types/draft'
import { projectRoster } from '../../game/scoring'

interface ResultsScreenProps {
  roster: Roster
  onPlayAgain: () => void
  onHome: () => void
}

export default function ResultsScreen({ roster, onPlayAgain, onHome }: ResultsScreenProps) {
  const result = useMemo(() => projectRoster(roster), [roster])
  const grades = [
    ['Offense', result.offense],
    ['Defense', result.defense],
    ['Starting', result.startingPitching],
    ['Relief', result.reliefPitching],
    ['Pitching', result.pitching],
    ['Speed', result.speed],
    ['Balance', result.rosterBalance],
  ] as const

  return (
    <main className="results-screen">
      <div className="results-screen__glow" aria-hidden="true" />
      <div className="results-particles" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="results-shell">
        <GameMenu className="results-game-menu" confirmHome={false} onHome={onHome} onRestart={onPlayAgain} />
        <button className="results-home" type="button" onClick={onHome}>Home</button>
        <DiamondDraftLogo className="results-logo" compact />
        <span className="results-kicker">Season Complete</span>
        <section className="projected-record" aria-label={`Projected record ${result.wins} wins and ${result.losses} losses`}>
          <div className="results-trophy" aria-hidden="true">
            <span>⚾</span>
            <svg viewBox="0 0 48 48"><path d="M14 7h20v10c0 8-4 14-10 14s-10-6-10-14V7Zm4 25h12M24 31v8M17 41h14M14 11H7v4c0 5 3 8 8 8m19-12h7v4c0 5-3 8-8 8" /></svg>
          </div>
          <small>Projected record</small>
          <strong>{result.wins}–{result.losses}</strong>
          <b>{result.tierLabel}</b>
          <span>Overall grade {result.letterGrade}</span>
        </section>
        <section className="results-grades" aria-label="Team category grades">
          {grades.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value.grade}</strong>
              <small>{value.score}</small>
            </div>
          ))}
        </section>
        <section className="results-roster">
          <div className="results-roster__heading"><h1>Completed roster</h1><span>14 / 14</span></div>
          <div className="results-roster__list">
            {ROSTER_SLOTS.map((slot) => (
              <div key={slot.id}>
                <strong>{slot.label}</strong>
                <span>{roster[slot.id]?.name ?? '—'}</span>
                <small>{roster[slot.id]?.team} {roster[slot.id]?.decade}</small>
              </div>
            ))}
          </div>
        </section>
        <button className="results-play-again" type="button" onClick={onPlayAgain}>New Game</button>
      </div>
    </main>
  )
}
