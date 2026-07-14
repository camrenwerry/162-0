import { memo } from 'react'
import type { PlayerCardData } from '../../types/draft'

interface PlayerCardProps {
  player: PlayerCardData
  onSelect: (player: PlayerCardData) => void
  isAvailable: boolean
  interactionsDisabled: boolean
  isDrafting: boolean
}

function formatAverage(value: number | null) {
  if (value === null) return '—'
  return value.toFixed(3).replace(/^0/, '')
}

function formatNumber(value: number | null, digits?: number) {
  if (value === null) return '—'
  return digits === undefined ? value.toLocaleString('en-US') : value.toFixed(digits)
}

function PlayerCard({ player, onSelect, isAvailable, interactionsDisabled, isDrafting }: PlayerCardProps) {
  const stats = player.type === 'hitter'
    ? [
        ['WAR', formatNumber(player.stats.war, 1)],
        ['OPS+', formatNumber(player.stats.opsPlus)],
        ['HR', formatNumber(player.stats.hr)],
        ['AVG', formatAverage(player.stats.avg)],
      ]
    : (() => {
        const showSaves = player.eligiblePositions.includes('RP') && !player.eligiblePositions.includes('SP')
        return [
          ['WAR', formatNumber(player.stats.war, 1)],
          ['ERA+', formatNumber(player.stats.eraPlus)],
          ['ERA', formatNumber(player.stats.era, 2)],
          [showSaves ? 'SV' : 'SO', formatNumber(showSaves ? player.stats.sv : player.stats.so)],
        ]
      })()

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
      <span className="player-card__arrow" aria-hidden="true">›</span>
    </button>
  )
}

export default memo(PlayerCard)
