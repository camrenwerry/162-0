import { ROSTER_SLOTS, type Player, type Position, type Roster, type RosterSlotId } from '../types/draft'

export function getFirstOpenSlot(position: Position, roster: Roster): RosterSlotId | null {
  return ROSTER_SLOTS.find((slot) => slot.position === position && !roster[slot.id])?.id ?? null
}

export function getAvailablePositions(player: Player, roster: Roster): Position[] {
  const positions = player.eligiblePositions.filter((position) => (
    position !== 'DH' && getFirstOpenSlot(position, roster) !== null
  ))
  const canUseDh = player.type === 'hitter' || player.isTwoWay
  if (!roster.DH && canUseDh) positions.push('DH')
  return positions
}

export function isPlayerSelectable(player: Player, roster: Roster) {
  return getAvailablePositions(player, roster).length > 0
}

export function resolveAssignmentSlot(player: Player, position: Position, roster: Roster): RosterSlotId | null {
  if (!getAvailablePositions(player, roster).includes(position)) return null
  return getFirstOpenSlot(position, roster)
}
