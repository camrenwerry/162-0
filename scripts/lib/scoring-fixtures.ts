import assert from 'node:assert/strict'
import { calculateHitterValue, calculateReliefPitcherValue, calculateStartingPitcherValue } from '../../src/game/scoring/calculatePlayerValue'
import { TeamPool } from '../../src/game/TeamPool'
import { ROSTER_SLOTS, type Player, type Roster } from '../../src/types/draft'

export type FixtureLevel = 'weak' | 'average' | 'good' | 'strong' | 'perfect'

const pool = new TeamPool()
const allPlayers = pool.getCombinations().flatMap((combination) => pool.getPlayers(combination))
const selectedIds = new Set<string>()
const baseRoster: Roster = {}

for (const slot of ROSTER_SLOTS) {
  const player = allPlayers.find((candidate) => {
    if (selectedIds.has(candidate.id)) return false
    if (slot.position === 'DH') return candidate.playerType === 'hitter'
    if (slot.position === 'SP' || slot.position === 'RP') return candidate.playerType === 'pitcher' && candidate.eligiblePositions.includes(slot.position)
    return candidate.playerType === 'hitter' && candidate.eligiblePositions.includes(slot.position)
  })
  assert(player, `fixture player missing for ${slot.id}`)
  baseRoster[slot.id] = player
  selectedIds.add(player.id)
}

const HITTER_FIXTURES = {
  weak: { war: -.5, opsPlus: 72, hr: 3, avg: .215, obp: .275, slg: .330, rbi: 30, sb: 1, games: 80, pa: 300, defense: -12, baserunning: -4 },
  average: { war: 2, opsPlus: 100, hr: 18, avg: .260, obp: .325, slg: .420, rbi: 75, sb: 8, games: 130, pa: 520, defense: 0, baserunning: 0 },
  good: { war: 4, opsPlus: 120, hr: 28, avg: .285, obp: .360, slg: .485, rbi: 95, sb: 12, games: 145, pa: 610, defense: 5, baserunning: 2 },
  strong: { war: 6, opsPlus: 140, hr: 38, avg: .315, obp: .400, slg: .560, rbi: 115, sb: 20, games: 155, pa: 680, defense: 10, baserunning: 5 },
  perfect: { war: 10, opsPlus: 190, hr: 55, avg: .340, obp: .450, slg: .650, rbi: 135, sb: 20, games: 155, pa: 680, defense: 12, baserunning: 4 },
} as const

const PITCHER_FIXTURES = {
  weak: { war: -.5, eraPlus: 72, era: 5.8, whip: 1.62, soRate: 4, wins: 4, saves: 1, innings: 90, starts: 18, relief: 22, fip: 5.7, walkRate: 5 },
  average: { war: 2, eraPlus: 100, era: 4.2, whip: 1.3, soRate: 7, wins: 10, saves: 10, innings: 155, starts: 27, relief: 45, fip: 4.2, walkRate: 3 },
  good: { war: 4, eraPlus: 125, era: 3.35, whip: 1.15, soRate: 9, wins: 15, saves: 25, innings: 190, starts: 30, relief: 60, fip: 3.3, walkRate: 2.5 },
  strong: { war: 6, eraPlus: 155, era: 2.65, whip: 1, soRate: 11, wins: 20, saves: 40, innings: 220, starts: 33, relief: 72, fip: 2.6, walkRate: 2 },
  perfect: { war: 9, eraPlus: 210, era: 1.75, whip: .8, soRate: 13, wins: 24, saves: 50, innings: 250, starts: 35, relief: 80, fip: 1.8, walkRate: 1.3 },
} as const

export function fixturePlayer(player: Player, level: FixtureLevel, defenseOverride?: number): Player {
  if (player.playerType === 'hitter') {
    const fixture = HITTER_FIXTURES[level]
    return {
      ...player,
      visibleStats: { war: fixture.war, opsPlus: fixture.opsPlus, ops: fixture.obp + fixture.slg, hr: fixture.hr, avg: fixture.avg, obp: fixture.obp, slg: fixture.slg, rbi: fixture.rbi, sb: fixture.sb, games: fixture.games, plateAppearances: fixture.pa },
      stats: { war: fixture.war, opsPlus: fixture.opsPlus, ops: fixture.obp + fixture.slg, hr: fixture.hr, avg: fixture.avg, obp: fixture.obp, slg: fixture.slg, rbi: fixture.rbi, sb: fixture.sb, games: fixture.games, plateAppearances: fixture.pa },
      scoringStats: {
        ...player.scoringStats,
        obp: fixture.obp, slg: fixture.slg, wrcPlus: fixture.opsPlus, games: fixture.games, plateAppearances: fixture.pa,
        defensiveValue: defenseOverride ?? fixture.defense, baserunningValue: fixture.baserunning, eraAdjustedOffense: fixture.opsPlus,
      },
    }
  }
  assert.equal(player.playerType, 'pitcher')
  const fixture = PITCHER_FIXTURES[level]
  const isStarter = player.eligiblePositions.includes('SP')
  const innings = isStarter ? fixture.innings : Math.min(fixture.innings, level === 'perfect' ? 80 : 75)
  const starts = isStarter ? fixture.starts : 0
  const reliefAppearances = isStarter ? Math.min(fixture.relief, 5) : fixture.relief
  const stats = {
    war: fixture.war, eraPlus: fixture.eraPlus, era: fixture.era, whip: fixture.whip,
    so: Math.round(innings * fixture.soRate / 9), wins: fixture.wins, saves: fixture.saves, sv: fixture.saves,
    inningsPitched: innings, games: starts + reliefAppearances, starts, reliefAppearances,
    k9: fixture.soRate, bb9: fixture.walkRate,
  }
  return {
    ...player,
    visibleStats: stats,
    stats,
    scoringStats: {
      ...player.scoringStats,
      whip: fixture.whip, fip: fixture.fip, inningsPitched: innings, strikeoutRate: fixture.soRate,
      walkRate: fixture.walkRate, starts, gamesStarted: starts, games: starts + reliefAppearances,
      reliefAppearances, eraAdjustedPitching: fixture.eraPlus,
    },
  }
}

export function fixtureRoster(hitterLevel: FixtureLevel, pitcherLevel: FixtureLevel, defenseOverride?: number): Roster {
  return Object.fromEntries(Object.entries(baseRoster).map(([slotId, player]) => [
    slotId,
    fixturePlayer(player, player.playerType === 'hitter' ? hitterLevel : pitcherLevel, defenseOverride),
  ])) as Roster
}

export function historicalPeakRoster(): Roster {
  const roster: Roster = {}
  const usedIds = new Set<string>()
  for (const slot of ROSTER_SLOTS) {
    const eligible = allPlayers.filter((player) => {
      if (usedIds.has(player.id)) return false
      if (slot.position === 'DH') return player.playerType !== 'pitcher'
      if (slot.position === 'SP' || slot.position === 'RP') return player.playerType !== 'hitter' && player.eligiblePositions.includes(slot.position)
      return player.playerType !== 'pitcher' && player.eligiblePositions.includes(slot.position)
    })
    const value = (player: Player) => {
      if (slot.position === 'SP') {
        assert(player.playerType !== 'hitter')
        return calculateStartingPitcherValue(player, slot.id).value
      }
      if (slot.position === 'RP') {
        assert(player.playerType !== 'hitter')
        return calculateReliefPitcherValue(player, slot.id).value
      }
      assert(player.playerType !== 'pitcher')
      return calculateHitterValue(player, slot.position, slot.id).value
    }
    const player = eligible.sort((left, right) => value(right) - value(left))[0]
    assert(player, `historical peak fixture missing ${slot.id}`)
    roster[slot.id] = player
    usedIds.add(player.id)
  }
  return roster
}
