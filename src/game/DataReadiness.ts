import { ROSTER_SLOTS } from '../types/draft'
import { DATA_READINESS } from '../data/generated'
import { TeamPool, type TeamPoolSource } from './TeamPool'

export interface DataReadinessResult {
  ready: boolean
  issueCount: number
  issues: string[]
}

export function checkProductionData(pool: TeamPoolSource = new TeamPool()): DataReadinessResult {
  try {
    const combinations = pool.getCombinations()
    const issues: string[] = []
    if (combinations.length < ROSTER_SLOTS.length) issues.push(`only ${combinations.length} combinations are indexed`)
    if (DATA_READINESS.blockingErrors !== 0) issues.push(`${DATA_READINESS.blockingErrors} blocking generated-data errors`)
    if (DATA_READINESS.combinations !== combinations.length || DATA_READINESS.pools !== combinations.length) issues.push('readiness manifest and runtime index differ')
    for (const combination of combinations) {
      const players = pool.getPlayers(combination)
      const starters = players.filter((player) => player.eligiblePositions.includes('SP')).length
      const relievers = players.filter((player) => player.eligiblePositions.includes('RP')).length
      if (players.length === 0 || starters < 3 || relievers < 2) issues.push(`${combination.id} has insufficient runtime depth`)
    }
    return { ready: issues.length === 0, issueCount: issues.length, issues }
  } catch (error) {
    return { ready: false, issueCount: 1, issues: [error instanceof Error ? error.message : 'unknown data-loading error'] }
  }
}
