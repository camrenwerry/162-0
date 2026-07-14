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
import './ClassicMode.css'

const FILTERS: PositionFilter[] = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP']

interface ClassicModeProps {
  onHome: () => void
}

export default function ClassicMode({ onHome }: ClassicModeProps) {
  const [engine] = useState(() => new DraftEngine())
  const draft = useDraftEngine(engine)

  const leaveGame = () => {
    engine.abandon()
    onHome()
  }

  if (draft.complete && draft.result) {
    return <ResultsScreen roster={draft.roster} result={draft.result} onPlayAgain={() => engine.restart()} onHome={onHome} />
  }

  return (
    <main className={`classic-page${draft.isRolling ? ' is-rolling' : ''}`}>
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
          menu={<GameMenu onHome={leaveGame} onRestart={() => engine.restart()} />}
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
            <section className="draft-board" aria-labelledby="draft-board-title" aria-busy={draft.isRolling}>
              <div className="draft-board__heading">
                <div>
                  <span>{draft.isRolling ? 'Drawing matchup' : 'Available players'}</span>
                  <h1 id="draft-board-title">{draft.isRolling ? 'Rolling…' : 'Make your pick'}</h1>
                </div>
                <small>{draft.players.length} players{draft.sortTypeLabel && <b> · {draft.sortTypeLabel}</b>}</small>
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
