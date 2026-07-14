import { memo } from 'react'
import type { DraftPlayerView, SortKey } from '../../types/draft'
import PlayerCard from './PlayerCard'

interface PlayerListProps {
  players: readonly DraftPlayerView[]
  onSelect: (playerId: string) => void
  interactionsDisabled: boolean
  committingPlayerId: string | null
  sort: SortKey
}

function PlayerList({ players, onSelect, interactionsDisabled, committingPlayerId, sort }: PlayerListProps) {
  if (players.length === 0) {
    return (
      <div className="classic-empty">
        <span aria-hidden="true" />
        <strong>No matching players.</strong>
        <p>Try a different search or position filter.</p>
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
