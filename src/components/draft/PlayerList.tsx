import { memo } from 'react'
import type { DraftPlayerView, SortKey } from '../../types/draft'
import PlayerCard from './PlayerCard'

interface PlayerListProps {
  players: readonly DraftPlayerView[]
  onSelect: (playerId: string) => void
  interactionsDisabled: boolean
  committingPlayerId: string | null
  sort: SortKey
  search: string
  filter: string
  onClearSearch: () => void
  onResetFilter: () => void
}

function PlayerList({ players, onSelect, interactionsDisabled, committingPlayerId, sort, search, filter, onClearSearch, onResetFilter }: PlayerListProps) {
  if (players.length === 0) {
    return (
      <div className="classic-empty">
        <span aria-hidden="true" />
        <strong>No matching players.</strong>
        <p>{search ? 'No player names match your search.' : 'No players match this position filter.'}</p>
        {search
          ? <button type="button" onClick={onClearSearch}>Clear search</button>
          : filter !== 'ALL' && <button type="button" onClick={onResetFilter}>Show all players</button>}
      </div>
    )
  }

  return (
    <div className="player-list-prototype" aria-live="polite">
      {players.map(({ player, isAvailable, statView }, index) => (
        <span className="player-list-prototype__entry" key={player.id}>
          {!isAvailable && (index === 0 || players[index - 1].isAvailable) && (
            <span className="player-list-prototype__divider">Unavailable for your remaining roster</span>
          )}
          <PlayerCard
            player={player}
            onSelect={() => onSelect(player.id)}
            isAvailable={isAvailable}
            interactionsDisabled={interactionsDisabled}
            isDrafting={committingPlayerId === player.id}
            statView={statView}
            sort={sort}
          />
        </span>
      ))}
    </div>
  )
}

export default memo(PlayerList)
