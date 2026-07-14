import type { RollMode } from './GameState'
import type { TeamDecade } from '../types/draft'
import type { TeamPoolSource } from './TeamPool'

export interface RandomizerRequest {
  mode: RollMode
  current: TeamDecade
  usedCombinationIds: ReadonlySet<string>
  teamRerollAvailable: boolean
  eraRerollAvailable: boolean
  isPlayable: (combination: TeamDecade) => boolean
}

export type RandomSource = () => number

export class Randomizer {
  private readonly pool: TeamPoolSource
  private readonly random: RandomSource

  constructor(pool: TeamPoolSource, random: RandomSource = Math.random) {
    this.pool = pool
    this.random = random
  }

  private pick<T>(items: readonly T[]) {
    return items[Math.floor(this.random() * items.length)]
  }

  select(request: RandomizerRequest): TeamDecade | null {
    const combinations = this.pool.getCombinations()
    const teamCount = this.pool.getTeams().length
    const decadeCount = this.pool.getDecades().length
    const candidates = combinations.filter((candidate) => {
      if (request.usedCombinationIds.has(candidate.id)) return false
      if (request.mode === 'team' && candidate.decade !== request.current.decade) return false
      if (request.mode === 'era' && candidate.franchiseId !== request.current.franchiseId) return false
      if (request.mode === 'both' && request.teamRerollAvailable) {
        const decadeUseCount = combinations.filter((option) => option.decade === candidate.decade && request.usedCombinationIds.has(option.id)).length
        if (decadeUseCount >= teamCount - 1) return false
      }
      if (request.mode === 'both' && request.eraRerollAvailable) {
        const teamUseCount = combinations.filter((option) => option.franchiseId === candidate.franchiseId && request.usedCombinationIds.has(option.id)).length
        if (teamUseCount >= decadeCount - 1) return false
      }
      return request.isPlayable(candidate)
    })
    return candidates.length ? this.pick(candidates) : null
  }

  cycleTeam() { return this.pick(this.pool.getTeams()).team }
  cycleDecade() { return this.pick(this.pool.getDecades()) }
}
