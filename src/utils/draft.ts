import type { Player, Position, Roster } from '../types/draft'

export function getAvailablePositions(player: Player, roster: Roster): Position[] {
  const availableFieldingPositions = player.eligiblePositions.filter((position) => (
    position !== 'DH' && !roster[position]
  ))
  const canPlayDh = player.type === 'hitter' || player.isTwoWay === true

  if (!roster.DH && canPlayDh) return [...availableFieldingPositions, 'DH']
  return availableFieldingPositions
}
