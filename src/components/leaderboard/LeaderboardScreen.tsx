import { useEffect, useRef, useState } from 'react'
import PennantPursuitLogo from '../PennantPursuitLogo'
import { documentTitleForRoute } from '../../appNavigation'
import {
  LEADERBOARD_PERIODS,
  createLeaderboardStateSnapshot,
  type LeaderboardPeriod,
  type LeaderboardSnapshot,
  type PublicLeaderboardEntry,
  type ReadyLeaderboardSnapshot,
} from '../../features/leaderboard/leaderboardFixtures'
import type {
  DevelopmentLeaderboardScenario,
  DevelopmentLeaderboardView,
} from '../../features/leaderboard/developmentResultPreview'
import './Leaderboard.css'

interface LeaderboardScreenProps {
  onHome: () => void
  onPlay: () => void
}

const PERIOD_LABELS: Readonly<Record<LeaderboardPeriod, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  'all-time': 'All-Time',
}

function RankingRow({ entry }: {
  entry: PublicLeaderboardEntry
}) {
  return (
    <tr className={entry.isPersonal ? 'is-personal' : undefined} aria-current={entry.isPersonal ? 'true' : undefined}>
      <td data-label="Rank"><strong>#{entry.rank}</strong></td>
      <th data-label="Player" scope="row">
        <span className="lb-row__player-name">{entry.displayName}</span>
        {entry.isPersonal && <span className="lb-row__you">You</span>}
      </th>
      <td data-label="Projected wins"><strong>{entry.projectedWins}</strong><span> wins</span></td>
      <td data-label="Overall score">{entry.overallScore.toFixed(1)}</td>
      <td data-label="When">{entry.timeContext}</td>
      <td data-label="Mode">{entry.mode}</td>
    </tr>
  )
}

function RankingColumns() {
  return (
    <colgroup>
      <col className="lb-table__rank" />
      <col className="lb-table__player" />
      <col className="lb-table__projected" />
      <col className="lb-table__score" />
      <col className="lb-table__when" />
      <col className="lb-table__mode" />
    </colgroup>
  )
}

function RankingTable({ snapshot }: { snapshot: ReadyLeaderboardSnapshot }) {
  return (
    <>
      <div className="lb-table-wrap">
        <table className="lb-table">
          <caption className="sr-only">{PERIOD_LABELS[snapshot.period]} Pennant Pursuit leaderboard</caption>
          <RankingColumns />
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Projected</th>
              <th scope="col">Score</th>
              <th scope="col">When</th>
              <th scope="col">Mode</th>
            </tr>
          </thead>
          <tbody>{snapshot.entries.map((entry, index) => <RankingRow entry={entry} key={`${entry.rank}-${entry.displayName}-${index}`} />)}</tbody>
        </table>
      </div>
      {snapshot.personalEntry && (
        <section className="lb-personal-anchor" aria-labelledby="personal-position-title">
          <div>
            <span>Your position</span>
            <h2 id="personal-position-title">Still in the chase</h2>
          </div>
          <div className="lb-table-wrap">
            <table className="lb-table">
              <caption className="sr-only">Your {PERIOD_LABELS[snapshot.period]} position</caption>
              <RankingColumns />
              <tbody><RankingRow entry={snapshot.personalEntry} /></tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function ScoreboardState({ snapshot, onPlay, onRetry }: {
  snapshot: Exclude<LeaderboardSnapshot, ReadyLeaderboardSnapshot>
  onPlay: () => void
  onRetry: () => void
}) {
  if (snapshot.kind === 'loading') {
    return (
      <section className="lb-state lb-state--loading" aria-live="polite" aria-busy="true">
        <span className="lb-state__mark" aria-hidden="true">◇</span>
        <h2>Loading the board…</h2>
        <p>Bringing the latest pennant chase into view.</p>
        <div className="lb-skeleton" aria-hidden="true"><i /><i /><i /><i /></div>
      </section>
    )
  }
  const stateCopy = {
    empty: {
      mark: '0',
      eyebrow: 'First pitch',
      title: 'The board is wide open',
      body: 'No qualifying Classic results are on this board yet. Your next roster could set the pace.',
      action: 'Play Classic',
    },
    error: {
      mark: '!',
      eyebrow: 'Signal missed',
      title: 'The scoreboard needs another look',
      body: 'Your game is safe. Try loading these standings again.',
      action: 'Try Again',
    },
    offline: {
      mark: '⌁',
      eyebrow: 'You’re offline',
      title: 'The pennant chase will be here',
      body: 'Reconnect to refresh the board. You can still build a roster while you wait.',
      action: 'Try Again',
    },
    disabled: {
      mark: '◇',
      eyebrow: 'Coming soon',
      title: 'Leaderboards aren’t open yet',
      body: 'Public standings and result claims are off. Classic drafts and projected seasons are ready to play.',
      action: 'Play Classic',
    },
  } as const
  const copy = stateCopy[snapshot.kind]
  return (
    <section className={`lb-state lb-state--${snapshot.kind}`} aria-live="polite">
      <span className="lb-state__mark" aria-hidden="true">{copy.mark}</span>
      <small>{copy.eyebrow}</small>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      <button type="button" onClick={snapshot.kind === 'error' || snapshot.kind === 'offline' ? onRetry : onPlay}>
        {copy.action}
      </button>
    </section>
  )
}

export default function LeaderboardScreen({ onHome, onPlay }: LeaderboardScreenProps) {
  type DevelopmentRuntime = typeof import('../../features/leaderboard/developmentResultPreview')
  const [runtime, setRuntime] = useState<DevelopmentRuntime | null>(null)
  const [view, setView] = useState<DevelopmentLeaderboardView>(() => Object.freeze({
    scenario: import.meta.env.DEV ? 'loading' : 'disabled',
    snapshot: createLeaderboardStateSnapshot(import.meta.env.DEV ? 'loading' : 'disabled'),
    developmentNotice: null,
    personalDisplayName: null,
  }))
  const pageFocus = useRef<HTMLElement>(null)
  const { scenario, snapshot } = view

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.title = documentTitleForRoute('/leaderboard')
      pageFocus.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let active = true
    void import('../../features/leaderboard/developmentResultPreview')
      .then((developmentRuntime) => {
        if (!active) return
        setRuntime(developmentRuntime)
        setView(developmentRuntime.resolveDevelopmentLeaderboard(
          window.location.search,
          navigator.onLine,
          window.localStorage,
        ))
      })
      .catch(() => {
        if (active) {
          setView(Object.freeze({
            scenario: 'error',
            snapshot: createLeaderboardStateSnapshot('error'),
            developmentNotice: 'The local sample standings could not be prepared. Public standings remain off.',
            personalDisplayName: null,
          }))
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!runtime) return
    const refreshConnectivity = () => {
      setView(runtime.resolveDevelopmentLeaderboard(
        window.location.search,
        navigator.onLine,
        window.localStorage,
      ))
    }
    window.addEventListener('online', refreshConnectivity)
    window.addEventListener('offline', refreshConnectivity)
    return () => {
      window.removeEventListener('online', refreshConnectivity)
      window.removeEventListener('offline', refreshConnectivity)
    }
  }, [runtime])

  const selectPeriod = (period: LeaderboardPeriod) => {
    if (!runtime) {
      setView(Object.freeze({
        scenario: 'disabled',
        snapshot: createLeaderboardStateSnapshot('disabled', period),
        developmentNotice: null,
        personalDisplayName: null,
      }))
      return
    }
    setView((current) => Object.freeze({
      ...current,
      snapshot: runtime.developmentLeaderboardFixture(
        current.scenario,
        period,
        current.personalDisplayName ?? undefined,
      ),
    }))
  }

  const movePeriodFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % LEADERBOARD_PERIODS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + LEADERBOARD_PERIODS.length) % LEADERBOARD_PERIODS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = LEADERBOARD_PERIODS.length - 1
    else return
    event.preventDefault()
    const nextPeriod = LEADERBOARD_PERIODS[nextIndex]
    selectPeriod(nextPeriod)
    document.getElementById(`leaderboard-tab-${nextPeriod}`)?.focus()
  }

  const retry = () => {
    if (!runtime) return
    const nextScenario: DevelopmentLeaderboardScenario = navigator.onLine ? 'ready' : 'offline'
    setView(Object.freeze({
      scenario: nextScenario,
      snapshot: runtime.developmentLeaderboardFixture(
        nextScenario,
        snapshot.period,
        view.personalDisplayName ?? undefined,
      ),
      developmentNotice: 'These sample standings exist only in this local preview. Public standings remain off.',
      personalDisplayName: view.personalDisplayName,
    }))
  }

  return (
    <main className="lb-page" data-route-focus ref={pageFocus} tabIndex={-1}>
      <div className="lb-page__lights" aria-hidden="true" />
      <header className="lb-header">
        <button className="lb-header__home" type="button" onClick={onHome} aria-label="Return home">← <span>Home</span></button>
        <PennantPursuitLogo className="lb-header__logo" compact priority />
        <div className="lb-header__title">
          <span>The pennant chase</span>
          <h1>Pennant Board</h1>
          <p>Best Classic seasons. One player can hold up to three places on each board.</p>
        </div>
        {snapshot.kind === 'ready' && <button className="lb-header__play" type="button" onClick={onPlay}>Play Classic</button>}
      </header>

      <section className="lb-shell" aria-labelledby="leaderboard-period-title">
        <h2 className="sr-only" id="leaderboard-period-title">Leaderboard period</h2>
        <div className="lb-periods" role="tablist" aria-label="Leaderboard period">
          {LEADERBOARD_PERIODS.map((period, index) => (
            <button
              aria-controls="leaderboard-panel"
              aria-selected={snapshot.period === period}
              className={snapshot.period === period ? 'is-active' : undefined}
              id={`leaderboard-tab-${period}`}
              key={period}
              onClick={() => selectPeriod(period)}
              onKeyDown={(event) => movePeriodFocus(event, index)}
              role="tab"
              tabIndex={snapshot.period === period ? 0 : -1}
              type="button"
            >
              {PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
        <div
          aria-labelledby={`leaderboard-tab-${snapshot.period}`}
          className="lb-panel"
          id="leaderboard-panel"
          role="tabpanel"
          tabIndex={0}
        >
          <div className="lb-panel__heading">
            <div><span>{PERIOD_LABELS[snapshot.period]}</span><h2>Best Run</h2></div>
            {snapshot.kind === 'ready' && <small>{snapshot.updatedLabel}</small>}
          </div>
          {view.developmentNotice && scenario !== 'disabled' && (
            <aside className="lb-local-notice" aria-label="Local preview status">
              <strong>Local preview</strong>
              <span>{view.developmentNotice}</span>
            </aside>
          )}
          {snapshot.kind === 'ready' ? (
            <>
              {snapshot.personalStatus === 'none' && (
                <aside className="lb-no-personal">
                  <span aria-hidden="true">＋</span>
                  <p><strong>Your line is waiting.</strong> Finish a qualifying Classic roster to enter the chase.</p>
                </aside>
              )}
              <RankingTable snapshot={snapshot} />
            </>
          ) : (
            <ScoreboardState snapshot={snapshot} onPlay={onPlay} onRetry={retry} />
          )}
        </div>
      </section>
    </main>
  )
}
