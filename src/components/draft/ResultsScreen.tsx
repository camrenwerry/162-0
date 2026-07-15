import { useState } from 'react'
import DiamondDraftLogo from '../DiamondDraftLogo'
import GameMenu from '../GameMenu'
import { ROSTER_SLOTS, type DraftResult, type Roster, type ScoringCategoryKey } from '../../types/draft'
import { buildCompleteShareText, getFeedbackUrl, shareResult } from '../../utils/betaActions'
import ShareFallbackDialog from './ShareFallbackDialog'

interface ResultsScreenProps {
  roster: Roster
  result: DraftResult
  onPlayAgain: () => void
  onHome: () => void
}

export default function ResultsScreen({ roster, result, onPlayAgain, onHome }: ResultsScreenProps) {
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [fallbackShareText, setFallbackShareText] = useState<string | null>(null)
  const feedbackContext = { screen: 'results', projectedRecord: `${result.wins}-${result.losses}` }
  const feedbackUrl = getFeedbackUrl(feedbackContext)
  const handleShare = async () => {
    if (isSharing) return
    setIsSharing(true)
    setShareStatus(null)
    try {
      const outcome = await shareResult(result)
      setShareStatus(outcome === 'copied' ? 'RESULT COPIED' : 'RESULT SHARED')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFallbackShareText(buildCompleteShareText(result))
    } finally {
      setIsSharing(false)
    }
  }
  const categoryLabel: Partial<Record<ScoringCategoryKey, string>> = {
    offense: 'Offense', defense: 'Defense',
    startingPitching: 'Starting Pitching', reliefPitching: 'Relief Pitching', rosterBalance: 'Roster Balance', overall: 'Overall',
  }
  const grades = [
    ['Offense', 'offense'],
    ['Defense', 'defense'],
    ['Starting Pitching', 'startingPitching'],
    ['Relief Pitching', 'reliefPitching'],
    ['Roster Balance', 'rosterBalance'],
  ] as const

  return (
    <main className="results-screen">
      <div className="results-screen__glow" aria-hidden="true" />
      <div className="results-particles" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="results-shell">
        <GameMenu className="results-game-menu" confirmHome={false} onHome={onHome} onRestart={onPlayAgain} feedbackContext={feedbackContext} />
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
          <span>Overall grade {result.overallGrade} · Team strength {result.overallScore}</span>
        </section>
        <section className="results-grades" aria-label="Team category grades">
          {grades.map(([label, key]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{result.categoryGrades[key]}</strong>
              <small>{result.categoryScores[key]}</small>
            </div>
          ))}
        </section>
        <section className="results-highlights" aria-label="Team scoring highlights">
          <p><span>Strongest category</span><strong>{categoryLabel[result.strongestCategory] ?? 'Overall'}</strong></p>
          <p><span>Weakest category</span><strong>{categoryLabel[result.weakestCategory] ?? 'Overall'}</strong></p>
        </section>
        <section className="results-roster">
          <div className="results-roster__heading"><h1>Completed roster</h1><span>14 / 14</span></div>
          <div className="results-roster__list">
            {ROSTER_SLOTS.map((slot) => (
              <div key={slot.id}>
                <strong>{slot.id}</strong>
                <span>{roster[slot.id]?.name ?? '—'}</span>
                <small>{roster[slot.id]?.team} {roster[slot.id]?.decade}</small>
              </div>
            ))}
          </div>
        </section>
        <div className="results-actions">
          <button className="results-play-again" type="button" onClick={onPlayAgain}>Play Again</button>
          <button type="button" aria-label="Share Diamond Draft result" aria-busy={isSharing} disabled={isSharing} onClick={handleShare}>
            {isSharing ? 'Sharing…' : 'Share Result'}
          </button>
          <button type="button" onClick={onHome}>Home</button>
          {feedbackUrl && <a href={feedbackUrl} target="_blank" rel="noreferrer">Send Feedback</a>}
        </div>
        <p className="results-share-status" role="status" aria-live="polite">{shareStatus}</p>
      </div>
      {fallbackShareText && <ShareFallbackDialog text={fallbackShareText} onClose={() => setFallbackShareText(null)} />}
    </main>
  )
}
