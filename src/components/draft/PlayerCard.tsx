import { memo } from 'react'
import type { PlayerCardData } from '../../types/draft'

interface PlayerCardProps {
  player: PlayerCardData
  onSelect: (player: PlayerCardData) => void
  isAvailable: boolean
  interactionsDisabled: boolean
  isDrafting: boolean
}

function formatAverage(value: number) {
  return value.toFixed(3).replace(/^0/, '')
}

function PlayerCard({ player, onSelect, isAvailable, interactionsDisabled, isDrafting }: PlayerCardProps) {
  const stats = player.type === 'hitter'
    ? [
        ['WAR', player.stats.war.toFixed(1)],
        ['OPS+', player.stats.opsPlus],
        ['HR', player.stats.hr],
        ['AVG', formatAverage(player.stats.avg)],
      ]
    : [
        ['WAR', player.stats.war.toFixed(1)],
        ['ERA+', player.stats.eraPlus],
        ['ERA', player.stats.era.toFixed(2)],
        ['SO', player.stats.so.toLocaleString('en-US')],
        ['SV', player.stats.sv],
      ]

  return (
    <button
      className={`player-card${!isAvailable ? ' is-unavailable' : ''}${isDrafting ? ' is-drafting' : ''}`}
      type="button"
      disabled={!isAvailable || interactionsDisabled}
      onClick={() => onSelect(player)}
    >
      <span className="player-card__accent" aria-hidden="true" />
      <span className="player-card__body">
        <span className="player-card__identity">
          <strong>{player.name}</strong>
          <span>{player.eligiblePositions.join(' · ')}</span>
          <small>{player.team} · {player.decade}</small>
        </span>
        {!isAvailable
          ? <span className="player-card__unavailable">No open position</span>
          : <span className={`player-card__type player-card__type--${player.type}`}>{player.type}</span>}
      </span>
      <span className={`player-card__stats player-card__stats--${player.type}`}>
        {stats.map(([label, value]) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </span>
        ))}
      </span>
    </button>
  )
}

export default memo(PlayerCard)
