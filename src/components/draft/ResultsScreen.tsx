import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import PennantPursuitLogo from '../PennantPursuitLogo'
import GameMenu from '../GameMenu'
import type {
  DevelopmentResultJourneyData,
} from '../../features/leaderboard/leaderboardFixtures'
import type { ResultLeaderboardJourneyProps } from '../leaderboard/ResultLeaderboardJourney'
import type { NavigationBlocker } from '../../appNavigation'
import { ROSTER_SLOTS, type DraftResult, type Roster, type ScoringCategoryKey } from '../../types/draft'
import { buildCompleteShareText, getFeedbackUrl, shareResult } from '../../utils/appActions'
import ShareFallbackDialog from './ShareFallbackDialog'
import RuntimeResultLeaderboardJourney from '../leaderboard/RuntimeResultLeaderboardJourney'
import type { DraftTranscript } from '../../game/DraftTranscript'
import type { DraftTicket } from '../../features/leaderboard/pennantApi'
import type { RuntimeIdentityState } from '../../features/leaderboard/useRuntimeIdentity'

interface ResultsScreenProps {
  roster: Roster
  result: DraftResult
  onPlayAgain: () => void
  onHome: () => void
  onLeaderboard: () => void
  onGameUpdates: () => void
  developmentJourney?: DevelopmentResultJourneyData
  DevelopmentJourneyComponent?: ComponentType<ResultLeaderboardJourneyProps>
  runtimeJourney?: Readonly<{
    ticket: DraftTicket | null
    transcript: DraftTranscript
    identityState: RuntimeIdentityState
    onIdentityChanged: () => void
  }>
  registerNavigationBlocker: (blocker: NavigationBlocker | null) => void
}

function formatCategoryLabel(category: ScoringCategoryKey): string {
  return category
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

export default function ResultsScreen({
  roster,
  result,
  onPlayAgain,
  onHome,
  onLeaderboard,
  onGameUpdates,
  developmentJourney,
  DevelopmentJourneyComponent,
  runtimeJourney,
  registerNavigationBlocker,
}: ResultsScreenProps) {
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [fallbackShareText, setFallbackShareText] = useState<string | null>(null)
  const [leaderboardJourneyBlocking, setLeaderboardJourneyBlocking] = useState(() => (
    Boolean(developmentJourney && DevelopmentJourneyComponent)
  ))
  const resultsFocus = useRef<HTMLElement>(null)
  const mounted = useRef(false)
  const handleLeaderboardBlockingChange = useCallback((blocking: boolean) => setLeaderboardJourneyBlocking(blocking), [])
  const feedbackContext = { screen: 'results', projectedRecord: `${result.wins}-${result.losses}` }
  const feedbackUrl = getFeedbackUrl(feedbackContext)
  const handleShare = async () => {
    if (isSharing) return
    setIsSharing(true)
    setShareStatus(null)
    try {
      const outcome = await shareResult(result)
      if (mounted.current) setShareStatus(outcome === 'copied' ? 'RESULT COPIED' : 'RESULT SHARED')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (mounted.current) setFallbackShareText(buildCompleteShareText(result))
    } finally {
      if (mounted.current) setIsSharing(false)
    }
  }
  const grades = [
    ['Offense', 'offense'],
    ['Defense', 'defense'],
    ['Starting Pitching', 'startingPitching'],
    ['Relief Pitching', 'reliefPitching'],
    ['Roster Balance', 'rosterBalance'],
  ] as const

  useEffect(() => {
    mounted.current = true
    const frame = window.requestAnimationFrame(() => {
      document.title = 'Results | Pennant Pursuit'
      resultsFocus.current?.focus()
    })
    return () => {
      mounted.current = false
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <main className="results-screen" data-route-focus ref={resultsFocus} tabIndex={-1}>
      <div className="results-screen__glow" aria-hidden="true" />
      <div className="results-particles" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="results-shell">
        {!leaderboardJourneyBlocking && (
          <>
            <GameMenu className="results-game-menu" confirmHome={false} onHome={onHome} onRestart={onPlayAgain} onGameUpdates={onGameUpdates} feedbackContext={feedbackContext} />
            <button className="results-home" type="button" onClick={onHome}>Home</button>
          </>
        )}
        <section className="projected-record" aria-label={`Projected record ${result.wins} wins and ${result.losses} losses`}>
          <div className="results-trophy" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M14 7h20v10c0 8-4 14-10 14s-10-6-10-14V7Zm4 25h12M24 31v8M17 41h14M14 11H7v4c0 5 3 8 8 8m19-12h7v4c0 5-3 8-8 8" /></svg>
          </div>
          <span className="results-kicker">Season Complete</span>
          <small>Projected record</small>
          <h1>{result.wins}–{result.losses}</h1>
          <div className="results-honors">
            <div className="results-overall">
              <span>Overall grade</span>
              <strong>{result.overallGrade}</strong>
              <small>Team strength {result.overallScore}</small>
            </div>
            <div className="results-tier">
              <span>Season tier</span>
              <strong>{result.tierLabel}</strong>
            </div>
          </div>
        </section>
        <PennantPursuitLogo className="results-logo" compact />
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
          <p><span>Strongest category</span><strong>{formatCategoryLabel(result.strongestCategory)}</strong></p>
          <p><span>Weakest category</span><strong>{formatCategoryLabel(result.weakestCategory)}</strong></p>
        </section>
        {runtimeJourney ? (
          <RuntimeResultLeaderboardJourney
            {...runtimeJourney}
            onBlockingChange={handleLeaderboardBlockingChange}
            registerNavigationBlocker={registerNavigationBlocker}
          />
        ) : developmentJourney && DevelopmentJourneyComponent ? (
          <DevelopmentJourneyComponent
            data={developmentJourney}
            onBlockingChange={handleLeaderboardBlockingChange}
            onLeave={onHome}
            registerNavigationBlocker={registerNavigationBlocker}
          />
        ) : (
          <section className="result-lb result-lb--disabled" aria-label="Leaderboard status">
            <div className="result-lb__signal" aria-hidden="true">◇</div>
            <div>
              <span>Leaderboards coming soon</span>
              <h2>Keep chasing your best season</h2>
              <p>Public placement and result claims are off. This projected season remains yours to replay and improve.</p>
            </div>
          </section>
        )}
        {!leaderboardJourneyBlocking && (
          <div className="results-actions">
            <button className="results-play-again" type="button" onClick={onPlayAgain}>Play Again</button>
            <button type="button" onClick={onLeaderboard}>Leaderboards</button>
            <button type="button" aria-label="Share Pennant Pursuit result" aria-busy={isSharing} disabled={isSharing} onClick={handleShare}>
              {isSharing ? 'Sharing…' : 'Share Result'}
            </button>
            <button type="button" onClick={onHome}>Home</button>
            {feedbackUrl && <a href={feedbackUrl} target="_blank" rel="noreferrer">Send Feedback</a>}
          </div>
        )}
        <p className="results-share-status" role="status" aria-live="polite">{shareStatus}</p>
        <section className="results-roster">
          <div className="results-roster__heading"><h2>Completed roster</h2><span>14 / 14</span></div>
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
      </div>
      {fallbackShareText && <ShareFallbackDialog text={fallbackShareText} onClose={() => setFallbackShareText(null)} />}
    </main>
  )
}
