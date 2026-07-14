import { memo } from 'react'
import type { DraftPlayerView } from '../../types/draft'
import PlayerCard from './PlayerCard'

interface PlayerListProps {
  players: readonly DraftPlayerView[]
  onSelect: (playerId: string) => void
  interactionsDisabled: boolean
  committingPlayerId: string | null
}

function PlayerList({ players, onSelect, interactionsDisabled, committingPlayerId }: PlayerListProps) {
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
      {players.map(({ player, isAvailable, statView }) => (
        <PlayerCard
          key={player.id}
          player={player}
          onSelect={() => onSelect(player.id)}
          isAvailable={isAvailable}
          interactionsDisabled={interactionsDisabled}
          isDrafting={committingPlayerId === player.id}
          statView={statView}
        />
      ))}
    </div>
  )
}

export default memo(PlayerList)
