import { mkdirSync, writeFileSync } from 'node:fs'
import { calculateDraftResult } from '../src/game/scoring'
import { type Roster, type RosterSlotId } from '../src/types/draft'
import { fixturePlayer, fixtureRoster } from './scoring.test'

const upgrade = (roster: Roster, slots: readonly RosterSlotId[], level: 'strong' | 'perfect') => {
  const upgraded = { ...roster }
  for (const slot of slots) {
    const player = upgraded[slot]
    if (player) upgraded[slot] = fixturePlayer(player, level)
  }
  return upgraded
}

const good = upgrade(fixtureRoster('average', 'average'), ['C', '1B', 'SS', 'CF', 'RF', 'SP1', 'SP2', 'RP1'], 'strong')
const historicalSuperteam = upgrade(
  fixtureRoster('strong', 'strong'),
  ['C', '1B', '2B', '3B', 'SS', 'CF', 'SP1', 'SP2', 'RP1'],
  'perfect',
)
const nearPerfect = upgrade(fixtureRoster('perfect', 'perfect'), ['RP2'], 'strong')

const benchmarks = [
  ['Average roster', fixtureRoster('average', 'average'), [86, 95]],
  ['Good roster', good, [96, 105]],
  ['Elite roster', fixtureRoster('strong', 'strong'), [116, 125]],
  ['Historical superteam', historicalSuperteam, [126, 155]],
  ['Near-perfect roster', nearPerfect, [156, 161]],
] as const

const lines = [
  '# Scoring Benchmark Report',
  '',
  'Deterministic v2.1 fixtures exercise the v0.11.3 win curve. Speed remains hidden from presentation but contributes to offense, overall score, and roster balance.',
  '',
  '| Benchmark | Projected record | Offense | Defense | Starting Pitching | Relief Pitching | Roster Balance | Overall |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
]
for (const [name, roster, [minimum, maximum]] of benchmarks) {
  const { result } = calculateDraftResult(roster)
  if (result.wins < minimum || result.wins > maximum) {
    throw new Error(`${name} projected ${result.wins} wins; expected ${minimum}–${maximum}`)
  }
  const grade = (key: keyof typeof result.categoryGrades) => `${result.categoryGrades[key]} (${result.categoryScores[key]})`
  lines.push(`| ${name} | ${result.wins}–${result.losses} | ${grade('offense')} | ${grade('defense')} | ${grade('startingPitching')} | ${grade('reliefPitching')} | ${grade('rosterBalance')} | ${grade('overall')} |`)
}

const perfect = calculateDraftResult(fixtureRoster('perfect', 'perfect')).result
if (perfect.wins !== 162) throw new Error(`Perfect roster projected ${perfect.wins} wins instead of 162: ${JSON.stringify(perfect.categoryScores)}`)
lines.push('', `Perfect qualification fixture: **${perfect.wins}–${perfect.losses}**, overall **${perfect.overallGrade} (${perfect.overallScore})**.`, '')
mkdirSync('docs/audits', { recursive: true })
writeFileSync('docs/audits/SCORING_BENCHMARKS.md', lines.join('\n'))
console.log(lines.join('\n'))
