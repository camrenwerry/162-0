import { ROSTER_SLOTS, type Player, type Position, type Roster, type RosterSlotId } from '../types/draft'

export function getFirstOpenSlot(position: Position, roster: Roster): RosterSlotId | null {
  return ROSTER_SLOTS.find((slot) => slot.position === position && !roster[slot.id])?.id ?? null
}

export function getAvailablePositions(player: Player, roster: Roster): Position[] {
  const availableFieldingPositions = player.eligiblePositions.filter((position) => (
    position !== 'DH' && getFirstOpenSlot(position, roster) !== null
  ))
  const canPlayDh = player.type === 'hitter' || player.isTwoWay === true

  if (!roster.DH && canPlayDh) return [...availableFieldingPositions, 'DH']
  return availableFieldingPositions
}
