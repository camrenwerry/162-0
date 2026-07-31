import { useEffect, useRef, useState } from 'react'
import PennantPursuitLogo from '../PennantPursuitLogo'
import { documentTitleForRoute } from '../../appNavigation'
import {
  LEADERBOARD_PERIODS,
  createPublicLeaderboardEntryStableKey,
  createLeaderboardStateSnapshot,
  type LeaderboardPeriod,
  type LeaderboardSnapshot,
  type PublicLeaderboardEntry,
  type ReadyLeaderboardSnapshot,
} from '../../features/leaderboard/leaderboardRuntimeModel'
import {
  PennantApi,
  playerFacingApiMessage,
  type LeaderboardPage,
} from '../../features/leaderboard/pennantApi'
import {
  localLeaderboardFixturesAreEnabled,
  runtimeFeatureIsEnabled,
} from '../../features/leaderboard/runtimeConfig'
import { useRuntimeIdentity } from '../../features/leaderboard/useRuntimeIdentity'
import RuntimeIdentityControls from './RuntimeIdentityControls'
import type { NavigationBlocker } from '../../appNavigation'
import './Leaderboard.css'

interface LeaderboardScreenProps {
  onHome: () => void
  onPlay: () => void
  registerNavigationBlocker: (blocker: NavigationBlocker | null) => void
}

interface LeaderboardView {
  readonly snapshot: LeaderboardSnapshot
  readonly notice: string | null
  readonly message: string | null
  readonly nextCursor: string | null
  readonly stale: boolean
}

interface InFlightRead {
  readonly key: string
  readonly controller: AbortController
  promise: Promise<LeaderboardView>
  abortTimer: number | null
}

const PERIOD_LABELS: Readonly<Record<LeaderboardPeriod, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  'all-time': 'All-Time',
}

const api = new PennantApi()
const DEVELOPMENT_FIXTURES_ENABLED = import.meta.env.DEV && localLeaderboardFixturesAreEnabled()
const DEVELOPMENT_RESULT_MODULE_PATH = import.meta.env.DEV
  ? '/src/features/leaderboard/developmentResultPreview.ts'
  : ''
const DEVELOPMENT_FIXTURE_QUERY = import.meta.env.DEV ? 'leaderboardFixture' : ''

function formatSubmittedAt(value: string): string {
  const submitted = Date.parse(value)
  if (!Number.isFinite(submitted)) return 'Verified'
  const difference = Date.now() - submitted
  if (difference >= 0 && difference < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.floor(difference / 60_000))
    return `${minutes}m ago`
  }
  if (difference >= 0 && difference < 24 * 60 * 60 * 1000) {
    return `${Math.floor(difference / 3_600_000)}h ago`
  }
  return new Date(submitted).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function mapEntry(
  entry: LeaderboardPage['entries'][number],
  personalDisplayName: string | null,
): PublicLeaderboardEntry {
  return Object.freeze({
    stableKey: createPublicLeaderboardEntryStableKey(entry),
    rank: entry.rank,
    displayName: entry.playerLabel,
    projectedWins: entry.projectedWins,
    overallScore: entry.overallScore,
    timeContext: formatSubmittedAt(entry.submittedAt),
    mode: 'Classic',
    isPersonal: personalDisplayName !== null && entry.playerLabel === personalDisplayName,
  })
}

function readySnapshot(
  page: LeaderboardPage,
  personalDisplayName: string | null,
  personalEntry: PublicLeaderboardEntry | null,
  personalSearchIncomplete = false,
): ReadyLeaderboardSnapshot {
  const entries = Object.freeze(page.entries.map((entry) => mapEntry(entry, personalDisplayName)))
  const personalIsVisible = entries.some(({ isPersonal }) => isPersonal)
  return Object.freeze({
    kind: 'ready',
    period: page.period,
    entries,
    personalEntry: personalIsVisible ? null : personalEntry,
    personalStatus: personalIsVisible
      ? 'visible'
      : personalEntry
        ? 'anchored'
        : personalDisplayName !== null && personalSearchIncomplete ? 'unavailable' : 'none',
    updatedLabel: `Verified ${formatSubmittedAt(page.generatedAt)}`,
  })
}

function emptyView(period: LeaderboardPeriod, kind: Exclude<LeaderboardSnapshot['kind'], 'ready'>): LeaderboardView {
  return Object.freeze({
    snapshot: createLeaderboardStateSnapshot(kind, period),
    notice: null,
    message: null,
    nextCursor: null,
    stale: false,
  })
}

async function loadRuntimeView(
  period: LeaderboardPeriod,
  personalDisplayName: string | null,
  signal: AbortSignal,
): Promise<LeaderboardView> {
  const first = await api.readLeaderboard(period, null, signal)
  if (!first.ok) {
    const kind = first.error.kind === 'offline' ? 'offline' : first.error.kind === 'disabled' ? 'disabled' : 'error'
    return Object.freeze({
      ...emptyView(period, kind),
      message: playerFacingApiMessage(first.error, 'leaderboard'),
    })
  }
  if (first.value.entries.length === 0) return emptyView(period, 'empty')

  let personalEntry: PublicLeaderboardEntry | null = null
  let personalSearchIncomplete = false
  if (
    personalDisplayName !== null
    && !first.value.entries.some(({ playerLabel }) => playerLabel === personalDisplayName)
  ) {
    let cursor = first.value.nextCursor
    for (let pageNumber = 0; pageNumber < 3 && cursor !== null && personalEntry === null; pageNumber += 1) {
      const searched = await api.readLeaderboard(period, cursor, signal)
      if (!searched.ok) {
        personalSearchIncomplete = searched.error.kind !== 'aborted'
        break
      }
      const match = searched.value.entries.find(({ playerLabel }) => playerLabel === personalDisplayName)
      if (match) personalEntry = mapEntry(match, personalDisplayName)
      cursor = searched.value.nextCursor
    }
    if (personalEntry === null && cursor !== null) personalSearchIncomplete = true
  }
  return Object.freeze({
    snapshot: readySnapshot(first.value, personalDisplayName, personalEntry, personalSearchIncomplete),
    notice: null,
    message: null,
    nextCursor: first.value.nextCursor,
    stale: false,
  })
}

function RankingRow({ entry }: { entry: PublicLeaderboardEntry }) {
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
          <tbody>{snapshot.entries.map((entry) => <RankingRow entry={entry} key={entry.stableKey} />)}</tbody>
        </table>
      </div>
      {snapshot.personalEntry && (
        <section className="lb-personal-anchor" aria-labelledby="personal-position-title">
          <div><span>Your position</span><h2 id="personal-position-title">Still in the chase</h2></div>
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

function ScoreboardState({
  snapshot,
  message,
  stale,
  onPlay,
  onRetry,
}: {
  snapshot: Exclude<LeaderboardSnapshot, ReadyLeaderboardSnapshot>
  message: string | null
  stale: boolean
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
      eyebrow: stale ? 'Board updated' : 'Signal missed',
      title: stale ? 'Restart these standings' : 'The scoreboard needs another look',
      body: message ?? (stale
        ? 'The board changed while you were paging. Restart from the latest verified snapshot.'
        : 'Your game is safe. Try loading these standings again.'),
      action: stale ? 'Restart Board' : 'Try Again',
    },
    offline: {
      mark: '⌁',
      eyebrow: 'You’re offline',
      title: 'The pennant chase will be here',
      body: message ?? 'Reconnect to refresh the board. You can still build a roster while you wait.',
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

function fixtureWasRequested(): boolean {
  return DEVELOPMENT_FIXTURES_ENABLED
    && new URLSearchParams(window.location.search).has(DEVELOPMENT_FIXTURE_QUERY)
}

export default function LeaderboardScreen({
  onHome,
  onPlay,
  registerNavigationBlocker,
}: LeaderboardScreenProps) {
  const identity = useRuntimeIdentity()
  const personalDisplayName = identity.state.kind === 'ready'
    ? identity.state.identity.displayName
    : null
  const [period, setPeriod] = useState<LeaderboardPeriod>('daily')
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<LeaderboardView>(() => (
    fixtureWasRequested() || runtimeFeatureIsEnabled('leaderboardRead')
      ? emptyView('daily', 'loading')
      : emptyView('daily', 'disabled')
  ))
  const [loadingMore, setLoadingMore] = useState(false)
  const pageFocus = useRef<HTMLElement>(null)
  const request = useRef<InFlightRead | null>(null)
  const paginationController = useRef<AbortController | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.title = documentTitleForRoute('/leaderboard')
      pageFocus.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    let active = true
    const key = `${period}:${personalDisplayName ?? ''}:${revision}:${fixtureWasRequested() ? 'fixture' : 'runtime'}`
    const prepare = async (): Promise<LeaderboardView> => {
      if (fixtureWasRequested()) {
        try {
          const fixture = await import(
            /* @vite-ignore */ DEVELOPMENT_RESULT_MODULE_PATH
          ) as typeof import('../../features/leaderboard/developmentResultPreview')
          const fixtureView = fixture.resolveDevelopmentLeaderboard(
            window.location.search,
            navigator.onLine,
            window.localStorage,
          )
          return Object.freeze({
            snapshot: fixture.developmentLeaderboardFixture(
              fixtureView.scenario,
              period,
              fixtureView.personalDisplayName ?? undefined,
            ),
            notice: fixtureView.developmentNotice,
            message: null,
            nextCursor: null,
            stale: false,
          })
        } catch {
          return Object.freeze({
            ...emptyView(period, 'error'),
            message: 'The local sample standings could not be prepared. Public standings remain off.',
          })
        }
      }
      if (!runtimeFeatureIsEnabled('leaderboardRead')) return emptyView(period, 'disabled')
      return loadRuntimeView(period, personalDisplayName, request.current?.controller.signal ?? new AbortController().signal)
    }

    if (request.current?.key === key) {
      if (request.current.abortTimer !== null) {
        window.clearTimeout(request.current.abortTimer)
        request.current.abortTimer = null
      }
    } else {
      const controller = new AbortController()
      const next: InFlightRead = {
        key,
        controller,
        promise: Promise.resolve(emptyView(period, 'loading')),
        abortTimer: null,
      }
      request.current = next
      next.promise = prepare()
    }
    queueMicrotask(() => {
      if (active) setView(emptyView(period, 'loading'))
    })
    const current = request.current
    void current.promise.then((nextView) => {
      if (active && request.current === current) setView(nextView)
    })
    return () => {
      active = false
      current.abortTimer = window.setTimeout(() => current.controller.abort(), 0)
    }
  }, [period, personalDisplayName, revision])

  useEffect(() => () => {
    paginationController.current?.abort()
  }, [])

  const selectPeriod = (nextPeriod: LeaderboardPeriod) => {
    if (nextPeriod === period) return
    paginationController.current?.abort()
    paginationController.current = null
    setLoadingMore(false)
    setPeriod(nextPeriod)
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
    paginationController.current?.abort()
    paginationController.current = null
    setLoadingMore(false)
    setRevision((current) => current + 1)
  }

  const loadMore = async () => {
    if (
      loadingMore
      || view.snapshot.kind !== 'ready'
      || view.nextCursor === null
      || fixtureWasRequested()
    ) return
    setLoadingMore(true)
    const controller = new AbortController()
    paginationController.current?.abort()
    paginationController.current = controller
    const result = await api.readLeaderboard(period, view.nextCursor, controller.signal)
    if (paginationController.current !== controller) return
    setLoadingMore(false)
    paginationController.current = null
    if (!result.ok) {
      if (result.error.kind === 'aborted') return
      setView(Object.freeze({
        ...emptyView(period, 'error'),
        message: result.error.kind === 'invalid-request'
          ? 'The board changed while you were paging. Restart from the latest verified snapshot.'
          : playerFacingApiMessage(result.error, 'leaderboard'),
        stale: result.error.kind === 'invalid-request',
      }))
      return
    }
    const existing = new Set(view.snapshot.entries.map((entry) => entry.stableKey))
    const mapped = result.value.entries.map((entry) => mapEntry(entry, personalDisplayName))
    const incoming = new Map(mapped.map((entry) => [entry.stableKey, entry]))
    const refreshed = view.snapshot.entries.map((entry) => incoming.get(entry.stableKey) ?? entry)
    const added = mapped.filter((entry) => !existing.has(entry.stableKey))
    const entries = Object.freeze([...refreshed, ...added])
    const visiblePersonal = entries.some(({ isPersonal }) => isPersonal)
    setView(Object.freeze({
      ...view,
      snapshot: Object.freeze({
        ...view.snapshot,
        entries,
        personalEntry: visiblePersonal ? null : view.snapshot.personalEntry,
        personalStatus: visiblePersonal ? 'visible' : view.snapshot.personalStatus,
      }),
      nextCursor: result.value.nextCursor,
    }))
  }

  const snapshot = view.snapshot
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
          {LEADERBOARD_PERIODS.map((nextPeriod, index) => (
            <button
              aria-controls="leaderboard-panel"
              aria-selected={snapshot.period === nextPeriod}
              className={snapshot.period === nextPeriod ? 'is-active' : undefined}
              id={`leaderboard-tab-${nextPeriod}`}
              key={nextPeriod}
              onClick={() => selectPeriod(nextPeriod)}
              onKeyDown={(event) => movePeriodFocus(event, index)}
              role="tab"
              tabIndex={snapshot.period === nextPeriod ? 0 : -1}
              type="button"
            >
              {PERIOD_LABELS[nextPeriod]}
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
          {view.notice && (
            <aside className="lb-local-notice" aria-label="Local preview status">
              <strong>Local preview</strong><span>{view.notice}</span>
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
              {snapshot.personalStatus === 'unavailable' && (
                <aside className="lb-no-personal">
                  <span aria-hidden="true">⌁</span>
                  <p><strong>Your identity is verified.</strong> We could not place its run in this view. Refresh the board or load more standings.</p>
                </aside>
              )}
              <RankingTable snapshot={snapshot} />
              {view.nextCursor && !fixtureWasRequested() && (
                <button className="lb-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? 'Loading…' : 'Load More'}
                </button>
              )}
            </>
          ) : (
            <ScoreboardState snapshot={snapshot} message={view.message} stale={view.stale} onPlay={onPlay} onRetry={retry} />
          )}
        </div>
      </section>
      {(runtimeFeatureIsEnabled('identityStatus')
        || runtimeFeatureIsEnabled('identityRename')
        || runtimeFeatureIsEnabled('recovery')) && (
        <RuntimeIdentityControls
          state={identity.state}
          onRefresh={identity.refresh}
          onRemove={identity.removeFromDevice}
          registerNavigationBlocker={registerNavigationBlocker}
        />
      )}
    </main>
  )
}
