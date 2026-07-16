import { useState } from 'react'
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
import './ClassicMode.css'

const FILTERS: PositionFilter[] = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP']

interface ClassicModeProps {
  onHome: () => void
  onGameUpdates: () => void
}

export default function ClassicMode({ onHome, onGameUpdates }: ClassicModeProps) {
  const [readiness] = useState(() => checkProductionData())
  if (!readiness.ready) {
    if (import.meta.env.DEV) console.error('Pennant Pursuit data readiness failed:', readiness.issues)
    return <AppRecovery title="Player data unavailable" message="Pennant Pursuit could not verify its historical player pools. Reload the game, or return home and try again shortly." onHome={onHome} />
  }
  return <AppErrorBoundary onHome={onHome}><ClassicDraft onHome={onHome} onGameUpdates={onGameUpdates} /></AppErrorBoundary>
}

function ClassicDraft({ onHome, onGameUpdates }: ClassicModeProps) {
  const [engine] = useState(() => new DraftEngine())
  const [showResults, setShowResults] = useState(false)
  const draft = useDraftEngine(engine)

  const leaveGame = () => {
    engine.abandon()
    onHome()
  }

  const restartGame = () => {
    setShowResults(false)
    engine.restart()
  }

  if (draft.complete && draft.result) {
    return showResults
      ? <ResultsScreen roster={draft.roster} result={draft.result} onPlayAgain={restartGame} onHome={onHome} onGameUpdates={onGameUpdates} />
      : <SeasonSimulation result={draft.result} onContinue={() => setShowResults(true)} onRestart={restartGame} onHome={leaveGame} onGameUpdates={onGameUpdates} />
  }

  if (draft.complete) {
    return <AppRecovery title="Result unavailable" message="Your roster was completed, but the projected result could not be created. Start a new draft or return home." onHome={onHome} onRetry={restartGame} />
  }

  return (
    <main className={`classic-page${draft.isRolling ? ' is-rolling' : ''}${draft.isFinishing ? ' is-finishing' : ''}`}>
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
          menu={<GameMenu onHome={leaveGame} onRestart={() => engine.restart()} onGameUpdates={onGameUpdates} feedbackContext={{ screen: 'draft', round: draft.round, team: draft.combination.team, decade: draft.combination.decade }} />}
        />
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
