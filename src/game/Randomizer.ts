import type { RollMode } from './GameState'
import type { TeamDecade } from '../types/draft'
import type { TeamPoolSource } from './TeamPool'

type RandomizerPoolSource = Pick<TeamPoolSource, 'getCombinations' | 'getTeams' | 'getDecades'>

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
  private readonly pool: RandomizerPoolSource
  private readonly random: RandomSource

  constructor(pool: RandomizerPoolSource, random: RandomSource) {
    this.pool = pool
    this.random = random
  }

  private pick<T>(items: readonly T[]) {
    return items[Math.min(items.length - 1, Math.floor(this.random() * items.length))]
  }

  select(request: RandomizerRequest): TeamDecade | null {
    const combinations = this.pool.getCombinations()
    const unused = combinations.filter((candidate) => !request.usedCombinationIds.has(candidate.id))
    if (unused.length < request.roundsRemaining) return null

    const playable = unused.filter(request.isPlayable)
    const playableByDecade = new Map<TeamDecade['decade'], number>()
    const playableByFranchise = new Map<string, number>()
    for (const candidate of playable) {
      playableByDecade.set(candidate.decade, (playableByDecade.get(candidate.decade) ?? 0) + 1)
      playableByFranchise.set(candidate.franchiseId, (playableByFranchise.get(candidate.franchiseId) ?? 0) + 1)
    }

    const candidates = playable.filter((candidate) => {
      if (request.mode === 'team' && candidate.decade !== request.current.decade) return false
      if (request.mode === 'era' && candidate.franchiseId !== request.current.franchiseId) return false
      const mustPreserveTeamReroll = request.teamRerollAvailable && request.mode !== 'team'
      if (mustPreserveTeamReroll && (playableByDecade.get(candidate.decade) ?? 0) < 2) return false
      const mustPreserveEraReroll = request.eraRerollAvailable && request.mode !== 'era'
      if (mustPreserveEraReroll && (playableByFranchise.get(candidate.franchiseId) ?? 0) < 2) return false
      return true
    })
    if (!candidates.length) return null
    if (request.mode !== 'both') return this.pick(candidates)

    const candidatesByFranchise = new Map<string, TeamDecade[]>()
    for (const candidate of candidates) {
      const franchiseCandidates = candidatesByFranchise.get(candidate.franchiseId) ?? []
      franchiseCandidates.push(candidate)
      candidatesByFranchise.set(candidate.franchiseId, franchiseCandidates)
    }
    const franchiseId = this.pick([...candidatesByFranchise.keys()])
    return this.pick(candidatesByFranchise.get(franchiseId) ?? [])
  }
}

/**
 * Animation-only randomization. This source must never be shared with the
 * gameplay Randomizer because frame count and reduced-motion preferences vary.
 */
export class CosmeticRandomizer {
  private readonly pool: RandomizerPoolSource
  private readonly random: RandomSource

  constructor(pool: RandomizerPoolSource, random: RandomSource = Math.random) {
    this.pool = pool
    this.random = random
  }

  private pick<T>(items: readonly T[]) {
    return items[Math.min(items.length - 1, Math.floor(this.random() * items.length))]
  }

  cycleTeam() { return this.pick(this.pool.getTeams()).team }
  cycleDecade() { return this.pick(this.pool.getDecades()) }
}
