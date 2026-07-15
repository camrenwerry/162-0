import { mkdirSync, writeFileSync } from 'node:fs'
import { calculateDraftResult } from '../src/game/scoring'
import { SCORING_VERSION } from '../src/game/scoring/scoringConfig'
import { type Roster, type RosterSlotId } from '../src/types/draft'
import { fixturePlayer, fixtureRoster, historicalPeakRoster } from './lib/scoring-fixtures'

const upgrade = (roster: Roster, slots: readonly RosterSlotId[], level: 'strong' | 'perfect') => {
  const upgraded = { ...roster }
  for (const slot of slots) {
    const player = upgraded[slot]
    if (player) upgraded[slot] = fixturePlayer(player, level)
  }
  return upgraded
}

const good = upgrade(fixtureRoster('average', 'average'), ['C', 'SS', 'CF', 'SP1', 'RP1'], 'good')
const elite = upgrade(fixtureRoster('good', 'good'), ['C', '1B', 'SS', 'CF', 'SP1', 'SP2', 'RP1'], 'strong')
const historicalSuperteam = upgrade(
  fixtureRoster('strong', 'strong'),
  ['C', '1B', '2B', '3B', 'SS', 'CF', 'SP1', 'SP2', 'RP1'],
  'perfect',
)
const nearPerfect = historicalPeakRoster()

const benchmarks = [
  ['Weak roster', fixtureRoster('weak', 'weak'), [55, 74]],
  ['Average roster', fixtureRoster('average', 'average'), [85, 94]],
  ['Good roster', good, [95, 104]],
  ['Great roster', fixtureRoster('good', 'good'), [115, 129]],
  ['Elite roster', elite, [130, 144]],
  ['Historical superteam', historicalSuperteam, [145, 161]],
  ['All-time generated-card roster', nearPerfect, [162, 162]],
] as const

const lines = [
  '# Scoring Benchmark Report',
  '',
  `Deterministic v${SCORING_VERSION} fixtures exercise the v0.11.5 normalization and win curves. Speed remains hidden and contributes only a small internal benefit.`,
  '',
  '| Benchmark | Overall | Projected record | Tier | Offense | Defense | Starting Pitching | Relief Pitching | Roster Balance | Bonuses | Penalties |',
  '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
]
const failures: string[] = []
for (const [name, roster, [minimum, maximum]] of benchmarks) {
  const { result, diagnostics } = calculateDraftResult(roster)
  if (result.wins < minimum || result.wins > maximum) {
    failures.push(`${name} projected ${result.wins} wins; expected ${minimum}–${maximum}`)
  }
  const grade = (key: keyof typeof result.categoryGrades) => `${result.categoryGrades[key]} (${result.categoryScores[key]})`
  const adjustments = (positive: boolean) => diagnostics.adjustments.filter(({ value }) => positive ? value > 0 : value < 0).map(({ label, value }) => `${label} (${value > 0 ? '+' : ''}${value.toFixed(1)})`).join('; ') || 'None'
  lines.push(`| ${name} | ${grade('overall')} | ${result.wins}–${result.losses} | ${result.tierLabel} | ${grade('offense')} | ${grade('defense')} | ${grade('startingPitching')} | ${grade('reliefPitching')} | ${grade('rosterBalance')} | ${adjustments(true)} | ${adjustments(false)} |`)
}

const perfect = calculateDraftResult(fixtureRoster('perfect', 'perfect')).result
if (perfect.wins !== 162) failures.push(`Perfect-category fixture projected ${perfect.wins} wins instead of 162: ${JSON.stringify(perfect.categoryScores)}`)
lines.push('', `Perfect-category fixture above the 152-win gate: **${perfect.wins}–${perfect.losses}**, overall **${perfect.overallGrade} (${perfect.overallScore})**.`, '')
mkdirSync('docs/audits', { recursive: true })
writeFileSync('docs/audits/SCORING_BENCHMARKS.md', lines.join('\n'))
console.log(lines.join('\n'))
if (failures.length) throw new Error(failures.join('\n'))
