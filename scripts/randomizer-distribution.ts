import combinationsJson from '../src/data/generated/combinations.json'
import { Randomizer } from '../src/game/Randomizer'
import { createSeededRandom } from '../src/game/SeededRandom'
import type { TeamDecade } from '../src/types/draft'

const combinations = combinationsJson as TeamDecade[]
const teams = [...new Map(combinations.map((item) => [item.franchiseId, item])).values()]
const source = {
  getCombinations: () => combinations,
  getTeams: () => teams.map((item) => ({ franchiseId: item.franchiseId, team: item.team, teamName: item.teamName })),
  getDecades: () => [...new Set(combinations.map((item) => item.decade))],
}
const randomizer = new Randomizer(source, createSeededRandom('seeded-v1:01620113000000010000000200000003'))
const rolls = 100_000
const counts = new Map<string, number>()
const initial = combinations[0]
for (let roll = 0; roll < rolls; roll += 1) {
  const selected = randomizer.select({
    mode: 'both', current: initial, usedCombinationIds: new Set(), teamRerollAvailable: true,
    eraRerollAvailable: true, roundsRemaining: 14, isPlayable: () => true,
  })
  if (!selected) throw new Error(`Opening roll ${roll + 1} had no eligible selection`)
  counts.set(selected.franchiseId, (counts.get(selected.franchiseId) ?? 0) + 1)
}

const allRows = teams.map((team) => ({ ...team, count: counts.get(team.franchiseId) ?? 0 }))
const rows = allRows.filter(({ count }) => count > 0).sort((left, right) => left.teamName.localeCompare(right.teamName))
const excluded = allRows.filter(({ count }) => count === 0).sort((left, right) => left.teamName.localeCompare(right.teamName))
const percentages = rows.map(({ count }) => count / rolls * 100)
const expected = 100 / rows.length
const maximumDeviation = Math.max(...percentages.map((percentage) => Math.abs(percentage - expected)))
if (maximumDeviation > .25) throw new Error(`Franchise distribution deviated ${maximumDeviation.toFixed(3)} percentage points from expected`)
console.log(`Randomizer opening-roll distribution (${rolls.toLocaleString()} rolls)`)
console.log(`Eligible franchises: ${rows.length}; expected average: ${expected.toFixed(3)}%`)
if (excluded.length) console.log(`Safety-filtered franchises: ${excluded.map(({ teamName }) => teamName).join(', ')}`)
console.log('Franchise | Count | Percentage')
for (const row of rows) console.log(`${row.teamName} (${row.team}) | ${row.count.toLocaleString()} | ${(row.count / rolls * 100).toFixed(3)}%`)
console.log(`Minimum franchise percentage: ${Math.min(...percentages).toFixed(3)}%`)
console.log(`Maximum franchise percentage: ${Math.max(...percentages).toFixed(3)}%`)
console.log('Requested expansion-franchise rates:')
for (const franchiseId of ['ari', 'tbd', 'fla', 'col']) {
  const row = rows.find((item) => item.franchiseId === franchiseId)
  if (!row) throw new Error(`Missing requested franchise ${franchiseId}`)
  console.log(`${row.teamName}: ${(row.count / rolls * 100).toFixed(3)}% (${row.count.toLocaleString()})`)
}
