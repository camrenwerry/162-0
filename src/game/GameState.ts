import type {
  DraftResult,
  PositionFilter,
  Roster,
  RosterSlotId,
  SortKey,
  TeamDecade,
} from '../types/draft'
import type { DraftTranscript } from './DraftTranscript'
import type { GameplaySeed } from './SeededRandom'

export type RollMode = 'both' | 'team' | 'era'

export interface GameState {
  gameplaySeed: GameplaySeed
  transcript: DraftTranscript
  roster: Roster
  round: number
  currentCombination: TeamDecade
  usedCombinationIds: Set<string>
  teamRerollAvailable: boolean
  eraRerollAvailable: boolean
  selectedPlayerIds: Set<string>
  selectedPlayerId: string | null
  search: string
  filter: PositionFilter
  sort: SortKey
  displayTeam: string
  displayDecade: string
  isRolling: boolean
  rollingMode: RollMode | null
  committingPlayerId: string | null
  recentlyFilledSlot: RosterSlotId | null
  isFinishing: boolean
  complete: boolean
  result: DraftResult | null
}

export function createGameState(
  initialCombination: TeamDecade,
  gameplaySeed: GameplaySeed,
  transcript: DraftTranscript,
): GameState {
  return {
    gameplaySeed,
    transcript,
    roster: {},
    round: 1,
    currentCombination: initialCombination,
    usedCombinationIds: new Set(),
    teamRerollAvailable: true,
    eraRerollAvailable: true,
    selectedPlayerIds: new Set(),
    selectedPlayerId: null,
    search: '',
    filter: 'ALL',
    sort: 'name',
    displayTeam: initialCombination.team,
    displayDecade: initialCombination.decade,
    isRolling: false,
    rollingMode: null,
    committingPlayerId: null,
    recentlyFilledSlot: null,
    isFinishing: false,
    complete: false,
    result: null,
  }
}
