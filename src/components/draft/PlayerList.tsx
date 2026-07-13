import { memo } from 'react'
import type { PlayerCardData } from '../../types/draft'
import type { Roster } from '../../types/draft'
import { getAvailablePositions } from '../../utils/draft'
import PlayerCard from './PlayerCard'

interface PlayerListProps {
  players: PlayerCardData[]
  onSelect: (player: PlayerCardData) => void
  roster: Roster
  interactionsDisabled: boolean
  committingPlayerId: string | null
}

function PlayerList({ players, onSelect, roster, interactionsDisabled, committingPlayerId }: PlayerListProps) {
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
      {players.map((player) => (
        <PlayerCard
          key={player.id}
          player={player}
          onSelect={onSelect}
          isAvailable={getAvailablePositions(player, roster).length > 0}
          interactionsDisabled={interactionsDisabled}
          isDrafting={committingPlayerId === player.id}
        />
      ))}
    </div>
  )
}

export default memo(PlayerList)
