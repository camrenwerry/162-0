import type { RollMode } from './GameState'
import type { TeamDecade } from '../types/draft'
import type { TeamPoolSource } from './TeamPool'

export interface RandomizerRequest {
  mode: RollMode
  current: TeamDecade
  usedCombinationIds: ReadonlySet<string>
  teamRerollAvailable: boolean
  eraRerollAvailable: boolean
  roundsRemaining: number
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
    const candidates = combinations.filter((candidate) => {
      if (request.usedCombinationIds.has(candidate.id)) return false
      if (request.mode === 'team' && candidate.decade !== request.current.decade) return false
      if (request.mode === 'era' && candidate.franchiseId !== request.current.franchiseId) return false
      const remainingAfterCandidate = combinations.filter((option) => !request.usedCombinationIds.has(option.id) && option.id !== candidate.id).length
      if (remainingAfterCandidate < request.roundsRemaining - 1) return false
      const mustPreserveTeamReroll = request.teamRerollAvailable && request.mode !== 'team'
      if (mustPreserveTeamReroll) {
        const hasTeamAlternative = combinations.some((option) => (
          option.id !== candidate.id
          && option.decade === candidate.decade
          && !request.usedCombinationIds.has(option.id)
          && request.isPlayable(option)
        ))
        if (!hasTeamAlternative) return false
      }
      const mustPreserveEraReroll = request.eraRerollAvailable && request.mode !== 'era'
      if (mustPreserveEraReroll) {
        const hasEraAlternative = combinations.some((option) => (
          option.id !== candidate.id
          && option.franchiseId === candidate.franchiseId
          && !request.usedCombinationIds.has(option.id)
          && request.isPlayable(option)
        ))
        if (!hasEraAlternative) return false
      }
      return request.isPlayable(candidate)
    })
    return candidates.length ? this.pick(candidates) : null
  }

  cycleTeam() { return this.pick(this.pool.getTeams()).team }
  cycleDecade() { return this.pick(this.pool.getDecades()) }
}
