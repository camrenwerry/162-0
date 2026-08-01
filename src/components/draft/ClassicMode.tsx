import { useEffect, useRef, useState, type ComponentType } from 'react'
import { DraftEngine } from '../../game/DraftEngine'
import { useDraftEngine } from '../../game/useDraftEngine'
import type { PositionFilter, SortKey } from '../../types/draft'
import GameMenu from '../GameMenu'
import DraftHeader from './DraftHeader'
import FranchiseProfile from './FranchiseProfile'
import PlayerList from './PlayerList'
import PositionPicker from './PositionPicker'
import ResultsScreen from './ResultsScreen'
import RosterBar from './RosterBar'
import TeamDecadeReveal from './TeamDecadeReveal'
import SeasonSimulation from '../results/SeasonSimulation'
import FirstGameHints from './FirstGameHints'
import { checkProductionData } from '../../game/DataReadiness'
import { AppErrorBoundary, AppRecovery } from '../AppRecovery'
import type { DevelopmentResultPreview } from '../../features/leaderboard/developmentResultPreview'
import type { ResultLeaderboardJourneyProps } from '../leaderboard/ResultLeaderboardJourney'
import { documentTitleForRoute, type NavigationBlocker } from '../../appNavigation'
import {
  PennantApi,
  playerFacingApiMessage,
  type DraftTicket,
} from '../../features/leaderboard/pennantApi'
import {
  localLeaderboardFixturesAreEnabled,
  runtimeFeatureIsEnabled,
} from '../../features/leaderboard/runtimeConfig'
import { useRuntimeIdentity, type RuntimeIdentityState } from '../../features/leaderboard/useRuntimeIdentity'
import './ClassicMode.css'

const FILTERS: PositionFilter[] = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP']
const DEVELOPMENT_FIXTURES_ENABLED = import.meta.env.DEV && localLeaderboardFixturesAreEnabled()
const DEVELOPMENT_RESULT_MODULE_PATH = import.meta.env.DEV
  ? '/src/features/leaderboard/developmentResultPreview.ts'
  : ''
const DEVELOPMENT_JOURNEY_MODULE_PATH = import.meta.env.DEV
  ? '/src/components/leaderboard/ResultLeaderboardJourney.tsx'
  : ''

interface ClassicModeProps {
  onHome: () => void
  onLeaderboard: () => void
  onGameUpdates: () => void
  registerNavigationBlocker: (blocker: NavigationBlocker | null) => void
}

type DevelopmentPreviewState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{
    kind: 'ready'
    preview: DevelopmentResultPreview | null
    JourneyComponent: ComponentType<ResultLeaderboardJourneyProps> | null
  }>
  | Readonly<{ kind: 'error' }>

export default function ClassicMode({
  onHome,
  onLeaderboard,
  onGameUpdates,
  registerNavigationBlocker,
}: ClassicModeProps) {
  const [readiness] = useState(() => checkProductionData())
  const [draftRevision, setDraftRevision] = useState(0)
  const [developmentState, setDevelopmentState] = useState<DevelopmentPreviewState>(() => (
    DEVELOPMENT_FIXTURES_ENABLED
      ? Object.freeze({ kind: 'loading' })
      : Object.freeze({ kind: 'ready', preview: null, JourneyComponent: null })
  ))

  useEffect(() => {
    if (!DEVELOPMENT_FIXTURES_ENABLED) return
    let active = true
    void Promise.all([
      import(/* @vite-ignore */ DEVELOPMENT_RESULT_MODULE_PATH) as Promise<
        typeof import('../../features/leaderboard/developmentResultPreview')
      >,
      import(/* @vite-ignore */ DEVELOPMENT_JOURNEY_MODULE_PATH) as Promise<
        typeof import('../leaderboard/ResultLeaderboardJourney')
      >,
    ])
      .then(([{ getDevelopmentResultPreview }, { default: JourneyComponent }]) => {
        if (!active) return
        const preview = getDevelopmentResultPreview(window.location.search, window.localStorage)
        setDevelopmentState(Object.freeze({
          kind: 'ready',
          preview,
          JourneyComponent: preview ? JourneyComponent : null,
        }))
      })
      .catch(() => {
        if (active) setDevelopmentState(Object.freeze({ kind: 'error' }))
      })
    return () => {
      active = false
    }
  }, [])

  if (!readiness.ready) {
    if (import.meta.env.DEV) console.error('Pennant Pursuit data readiness failed:', readiness.issues)
    return <AppRecovery title="Player data unavailable" message="Pennant Pursuit could not verify its historical player pools. Reload the game, or return home and try again shortly." onHome={onHome} />
  }
  if (developmentState.kind === 'loading') {
    return <main className="route-loading" aria-busy="true" aria-live="polite"><p>Preparing the field…</p></main>
  }
  if (developmentState.kind === 'error') {
    return <AppRecovery title="Preview unavailable" message="The local result preview could not be prepared. Return home or start a regular Classic draft." onHome={onHome} />
  }
  if (developmentState.preview && developmentState.JourneyComponent) {
    const developmentPreview = developmentState.preview
    return (
      <ResultsScreen
        roster={developmentPreview.roster}
        result={developmentPreview.result}
        onPlayAgain={() => {
          window.history.replaceState({}, '', '/draft')
          setDevelopmentState(Object.freeze({ kind: 'ready', preview: null, JourneyComponent: null }))
        }}
        onHome={onHome}
        onLeaderboard={onLeaderboard}
        onGameUpdates={onGameUpdates}
        developmentJourney={developmentPreview.journey}
        DevelopmentJourneyComponent={developmentState.JourneyComponent}
        registerNavigationBlocker={registerNavigationBlocker}
      />
    )
  }
  return (
    <AppErrorBoundary onHome={onHome}>
      <ClassicDraft
        key={draftRevision}
        onHome={onHome}
        onLeaderboard={onLeaderboard}
        onGameUpdates={onGameUpdates}
        onNewDraft={() => setDraftRevision((revision) => revision + 1)}
        registerNavigationBlocker={registerNavigationBlocker}
      />
    </AppErrorBoundary>
  )
}

interface ClassicDraftProps extends ClassicModeProps {
  onNewDraft: () => void
}

type DraftBootstrapState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{
    kind: 'ready'
    engine: DraftEngine
    ticket: DraftTicket | null
    ticketMessage: string | null
  }>

const api = new PennantApi()
const DRAFT_TICKET_ENABLED = runtimeFeatureIsEnabled('draftTicket')

function engineForTicket(ticket: DraftTicket | null) {
  if (!ticket) return new DraftEngine()
  return new DraftEngine({
    sessionFactory: () => Object.freeze({
      gameplaySeed: ticket.draftSeed,
      draftId: ticket.ticketId,
      createdAt: new Date(ticket.issuedAt).toISOString(),
    }),
  })
}

function ClassicDraft(props: ClassicDraftProps) {
  const [bootstrap, setBootstrap] = useState<DraftBootstrapState>(() => (
    DRAFT_TICKET_ENABLED
      ? Object.freeze({ kind: 'loading' })
      : Object.freeze({
        kind: 'ready',
        engine: engineForTicket(null),
        ticket: null,
        ticketMessage: 'Public submission is off. This draft will stay on this device.',
      })
  ))
  const ticketRequest = useRef<Promise<Awaited<ReturnType<PennantApi['requestDraftTicket']>>> | null>(null)
  const ticketAbort = useRef<AbortController | null>(null)
  const ticketAbortTimer = useRef<number | null>(null)
  const identity = useRuntimeIdentity()

  useEffect(() => {
    if (ticketAbortTimer.current !== null) {
      window.clearTimeout(ticketAbortTimer.current)
      ticketAbortTimer.current = null
    }
    if (bootstrap.kind !== 'loading') return
    if (ticketRequest.current === null) {
      ticketAbort.current = new AbortController()
      ticketRequest.current = api.requestDraftTicket(ticketAbort.current.signal)
    }
    let active = true
    void ticketRequest.current.then((result) => {
      if (!active) return
      setBootstrap(result.ok
        ? Object.freeze({
          kind: 'ready',
          engine: engineForTicket(result.value),
          ticket: result.value,
          ticketMessage: null,
        })
        : Object.freeze({
          kind: 'ready',
          engine: engineForTicket(null),
          ticket: null,
          ticketMessage: playerFacingApiMessage(result.error, 'ticket'),
        }))
    })
    return () => {
      active = false
      ticketAbortTimer.current = window.setTimeout(() => ticketAbort.current?.abort(), 0)
    }
  }, [bootstrap.kind])

  if (bootstrap.kind === 'loading') {
    return (
      <main className="route-loading" aria-busy="true" aria-live="polite">
        <p>Preparing your draft…</p>
      </main>
    )
  }
  return (
    <ClassicDraftReady
      {...props}
      engine={bootstrap.engine}
      ticket={bootstrap.ticket}
      ticketMessage={bootstrap.ticketMessage}
      identityState={identity.state}
      onIdentityChanged={identity.refresh}
    />
  )
}

interface ClassicDraftReadyProps extends ClassicDraftProps {
  engine: DraftEngine
  ticket: DraftTicket | null
  ticketMessage: string | null
  identityState: RuntimeIdentityState
  onIdentityChanged: () => void
}

function ClassicDraftReady({
  onHome,
  onLeaderboard,
  onGameUpdates,
  onNewDraft,
  registerNavigationBlocker,
  engine,
  ticket,
  ticketMessage,
  identityState,
  onIdentityChanged,
}: ClassicDraftReadyProps) {
  const [showResults, setShowResults] = useState(false)
  const classicFocus = useRef<HTMLElement>(null)
  const draft = useDraftEngine(engine)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.title = documentTitleForRoute('/draft')
      classicFocus.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const leaveGame = () => {
    engine.abandon()
    onHome()
  }

  const restartGame = () => {
    engine.abandon()
    onNewDraft()
  }

  if (draft.complete && draft.result) {
    return showResults
      ? <ResultsScreen
        roster={draft.roster}
        result={draft.result}
        onPlayAgain={restartGame}
        onHome={onHome}
        onLeaderboard={onLeaderboard}
        onGameUpdates={onGameUpdates}
        registerNavigationBlocker={registerNavigationBlocker}
        runtimeJourney={{
          ticket,
          transcript: engine.getTranscript(),
          identityState,
          onIdentityChanged,
        }}
      />
      : <SeasonSimulation result={draft.result} onContinue={() => setShowResults(true)} onRestart={restartGame} onHome={leaveGame} onGameUpdates={onGameUpdates} />
  }

  if (draft.complete) {
    return <AppRecovery title="Result unavailable" message="Your roster was completed, but the projected result could not be created. Start a new draft or return home." onHome={onHome} onRetry={restartGame} />
  }

  return (
    <main className={`classic-page${draft.isRolling ? ' is-rolling' : ''}${draft.isFinishing ? ' is-finishing' : ''}`} data-route-focus ref={classicFocus} tabIndex={-1}>
      <div className="classic-page__atmosphere" aria-hidden="true" />
      <div className="classic-shell">
        <DraftHeader
          round={draft.round}
          totalRounds={draft.totalRounds}
          teamRerollAvailable={draft.teamRerollAvailable}
          eraRerollAvailable={draft.eraRerollAvailable}
          interactionsDisabled={draft.interactionsDisabled}
          onTeamReroll={() => engine.rerollTeam()}
          onEraReroll={() => engine.rerollEra()}
          menu={<GameMenu onHome={leaveGame} onRestart={restartGame} onGameUpdates={onGameUpdates} feedbackContext={{ screen: 'draft', round: draft.round, team: draft.combination.team, decade: draft.combination.decade }} />}
        />
        {ticketMessage && <p className="draft-service-note" role="status">{ticketMessage}</p>}
        <div className="draft-workspace">
          <div className="draft-primary">
            <TeamDecadeReveal
              combination={draft.combination}
              displayTeam={draft.displayTeam}
              displayDecade={draft.displayDecade}
              rollingMode={draft.rollingMode}
            />
            <FranchiseProfile />
            <FirstGameHints />
            <section className="draft-board" aria-labelledby="draft-board-title" aria-busy={draft.isRolling}>
              <div className="draft-board__heading">
                <div>
                  <span>{draft.isRolling ? 'Drawing matchup' : 'Available players'}</span>
                  <h1 id="draft-board-title">{draft.isRolling ? 'Rolling…' : 'Make your pick'}</h1>
                </div>
                <small>
                  {draft.players.length} players{draft.sortTypeLabel && <b> · {draft.sortTypeLabel}</b>}
                  {draft.unavailablePlayerCount > 0 && <em>{draft.availablePlayerCount} available · {draft.unavailablePlayerCount} unavailable</em>}
                </small>
              </div>

              <div className="draft-controls">
                <label className="draft-search">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.25" /><path d="m15.2 15.2 4.2 4.2" /></svg>
                  <input
                    disabled={draft.interactionsDisabled}
                    value={draft.search}
                    onChange={(event) => engine.setSearch(event.target.value)}
                    type="search"
                    placeholder="Search players"
                  />
                </label>
                <label className="draft-sort">
                  <span>Sort</span>
                  <select
                    disabled={draft.interactionsDisabled}
                    value={draft.sort}
                    onChange={(event) => engine.setSort(event.target.value as SortKey)}
                  >
                    {draft.sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="position-filters" aria-label="Filter players by position">
                {FILTERS.map((filter) => (
                  <button
                    className={draft.filter === filter ? 'is-active' : ''}
                    disabled={draft.interactionsDisabled}
                    key={filter}
                    type="button"
                    onClick={() => engine.setFilter(filter)}
                  >{filter}</button>
                ))}
              </div>

              <PlayerList
                players={draft.players}
                interactionsDisabled={draft.interactionsDisabled}
                committingPlayerId={draft.committingPlayerId}
                sort={draft.sort}
                search={draft.search}
                filter={draft.filter}
                onClearSearch={() => engine.setSearch('')}
                onResetFilter={() => engine.setFilter('ALL')}
                onSelect={(playerId) => engine.selectPlayer(playerId)}
              />
            </section>
          </div>
          <RosterBar roster={draft.roster} recentlyFilledPosition={draft.recentlyFilledSlot} />
        </div>
      </div>
      {draft.selectedPlayer && !draft.interactionsDisabled && (
        <PositionPicker
          player={draft.selectedPlayer}
          availablePositions={draft.availablePositions}
          onCancel={() => engine.cancelPlayerSelection()}
          onConfirm={(position) => engine.assignSelectedPlayer(position)}
        />
      )}
    </main>
  )
}
