import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const classic = read('src/components/draft/ClassicMode.tsx')
const simulation = read('src/components/results/SeasonSimulation.tsx')
const simulationCss = read('src/components/results/SeasonSimulation.css')
const playerList = read('src/components/draft/PlayerList.tsx')
const engine = read('src/game/DraftEngine.ts')

assert(classic.includes("draft.complete && draft.result") && classic.includes('<SeasonSimulation result={draft.result}'), 'a completed draft must enter the simulation with its existing result')
assert(classic.includes('return showResults') && classic.includes(': <SeasonSimulation'), 'simulation should be the default completed-draft presentation before full Results')
assert(simulation.includes('setIsRevealed(true)') && simulation.includes('onClick={skip}'), 'Skip must reveal the predetermined result immediately')
assert(simulation.includes('completedRef.current') && simulation.includes('if (completedRef.current) return'), 'Skip and automatic completion must be idempotent')
assert(!simulation.includes('calculateDraftResult') && !simulation.includes('DiamondDraftScoring'), 'presentation must never run scoring')
assert(simulation.includes('getSimulationReveal(result)'), 'the reveal must derive only from the supplied result payload')
assert(simulation.includes('<GameMenu') && simulation.includes('onRestart={onRestart}') && simulation.includes('onHome={onHome}'), 'simulation must expose safe restart and Home controls')
assert(engine.match(/this\.scoring\.calculate/g)?.length === 1, 'DraftEngine must have exactly one scoring call site')
assert(playerList.includes('Unavailable for your remaining roster') && playerList.includes('!isAvailable'), 'unavailable cards need one compact divider and must remain rendered')
for (const inset of ['top', 'right', 'bottom', 'left']) assert(simulationCss.includes(`env(safe-area-inset-${inset})`), `simulation must respect the ${inset} safe area`)
assert(simulationCss.includes('min-height: 2.75rem') && simulationCss.includes('overflow: hidden'), 'simulation must preserve mobile touch and overflow contracts')
assert(simulationCss.includes('@media (prefers-reduced-motion: reduce)'), 'simulation must include a reduced-motion presentation')

console.log('v0.10 presentation contract passed: simulation handoff, predetermined reveal, Skip, menu safety, mobile safe areas, and reduced motion.')
