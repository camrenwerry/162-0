export const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'] as const

export type Position = (typeof POSITIONS)[number]
export type PositionFilter = 'ALL' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH' | 'SP' | 'RP'
export type SortKey = 'war' | 'opsPlus' | 'hr' | 'avg' | 'eraPlus' | 'era' | 'so' | 'sv'

export interface TeamDecadeCombination {
  id: string
  team: string
  teamName: string
  decade: string
}

interface PlayerBase {
  id: string
  name: string
  team: string
  decade: string
  eligiblePositions: Position[]
  isTwoWay?: boolean
}

export interface Hitter extends PlayerBase {
  type: 'hitter'
  stats: {
    war: number
    opsPlus: number
    hr: number
    avg: number
  }
}

export interface Pitcher extends PlayerBase {
  type: 'pitcher'
  stats: {
    war: number
    eraPlus: number
    era: number
    so: number
    sv: number
  }
}

export type Player = Hitter | Pitcher
export type PlayerCardData = Player
export type Roster = Partial<Record<Position, Player>>
