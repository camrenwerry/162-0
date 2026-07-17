import { ROSTER_SLOTS, type Position, type RosterSlotId } from '../types/draft'

export interface EligibilityPlayer {
  readonly eligiblePositions: readonly Position[]
  readonly type: 'hitter' | 'pitcher'
  readonly isTwoWay: boolean
}

export type EligibilityRoster<TPlayer extends EligibilityPlayer = EligibilityPlayer> = Partial<Record<RosterSlotId, TPlayer>>

export function getFirstOpenSlot(position: Position, roster: EligibilityRoster): RosterSlotId | null {
  return ROSTER_SLOTS.find((slot) => slot.position === position && !roster[slot.id])?.id ?? null
}

export function getAvailablePositions(player: EligibilityPlayer, roster: EligibilityRoster): Position[] {
  const positions = [...player.eligiblePositions].filter((position) => (
    position !== 'DH' && getFirstOpenSlot(position, roster) !== null
  ))
  const canUseDh = player.type === 'hitter' || player.isTwoWay
  if (!roster.DH && canUseDh) positions.push('DH')
  return positions
}

export function isPlayerSelectable(player: EligibilityPlayer, roster: EligibilityRoster) {
  return getAvailablePositions(player, roster).length > 0
}

export function partitionPlayersByAvailability<TPlayer extends EligibilityPlayer>(players: readonly TPlayer[], roster: EligibilityRoster) {
  const selectable: TPlayer[] = []
  const unavailable: TPlayer[] = []
  for (const player of players) (isPlayerSelectable(player, roster) ? selectable : unavailable).push(player)
  return { selectable, unavailable }
}

export function resolveAssignmentSlot(player: EligibilityPlayer, position: Position, roster: EligibilityRoster): RosterSlotId | null {
  if (!getAvailablePositions(player, roster).includes(position)) return null
  return getFirstOpenSlot(position, roster)
}
