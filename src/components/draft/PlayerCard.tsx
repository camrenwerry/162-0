import { memo } from 'react'
import { getCompactPlayerStats } from '../../game/PlayerStats'
import type { PlayerCardData } from '../../types/draft'

interface PlayerCardProps {
  player: PlayerCardData
  onSelect: () => void
  isAvailable: boolean
  interactionsDisabled: boolean
  isDrafting: boolean
  statView: 'hitter' | 'pitcher'
}

function PlayerCard({ player, onSelect, isAvailable, interactionsDisabled, isDrafting, statView }: PlayerCardProps) {
  const stats = getCompactPlayerStats(player, statView)

  return (
    <button
      className={`player-card${!isAvailable ? ' is-unavailable' : ''}${isDrafting ? ' is-drafting' : ''}`}
      type="button"
      disabled={!isAvailable || interactionsDisabled}
      onClick={onSelect}
    >
      <span className="player-card__accent" aria-hidden="true" />
      <span className="player-card__body">
        <span className="player-card__identity">
          <strong>{player.name}</strong>
          <span>{player.eligiblePositions.join(' · ')}</span>
          <small>{player.team} · {player.decade}</small>
          <small>Featured season: {player.featuredSeason}</small>
        </span>
        {!isAvailable
          ? <span className="player-card__unavailable">No open position</span>
          : <span className={`player-card__type player-card__type--${player.type}`}>{player.type}</span>}
      </span>
      {stats.length > 0 && (
        <span className={`player-card__stats player-card__stats--count-${stats.length}`}>
          {stats.map(({ key, label, formattedValue }) => (
            <span key={key}>
              <small>{label}</small>
              <strong>{formattedValue}</strong>
            </span>
          ))}
        </span>
      )}
      <span className="player-card__arrow" aria-hidden="true">›</span>
    </button>
  )
}

export default memo(PlayerCard)
