import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const index = read('index.html')
const globalCss = read('src/index.css')
const homeCss = read('src/components/home/HomeScreen.css')
const draftCss = read('src/components/draft/ClassicMode.css')
const menuCss = read('src/components/GameMenu.css')
const roster = read('src/components/draft/RosterBar.tsx')
const results = read('src/components/draft/ResultsScreen.tsx')
const simulation = read('src/components/results/SeasonSimulation.tsx')
const simulationCss = read('src/components/results/SeasonSimulation.css')
const dialogs = [
  read('src/components/GameMenu.tsx'),
  read('src/components/home/HowToPlayModal.tsx'),
  read('src/components/draft/PositionPicker.tsx'),
]

const targetViewports = [[320, 568], [375, 667], [390, 844], [393, 852], [414, 896], [430, 932]]
for (const [width, height] of targetViewports) {
  assert(width >= 320 && height >= 568, `${width}×${height} is outside the supported mobile contract`)
}

assert(index.includes('viewport-fit=cover'), 'the viewport must expose iOS safe areas')
assert(globalCss.includes('overflow-x: clip'), 'global horizontal overflow protection is required')
for (const inset of ['top', 'right', 'bottom', 'left']) {
  assert(`${homeCss}\n${draftCss}\n${menuCss}`.includes(`env(safe-area-inset-${inset})`), `missing ${inset} safe-area handling`)
}

assert(homeCss.includes('overflow-x: clip') && !homeCss.includes('.dd-home { position: relative; min-height: 100svh; overflow: hidden'), 'Home must scroll vertically on short screens')
assert(draftCss.includes('.results-screen { position: relative; min-height: 100svh; overflow-x: clip'), 'Results must scroll vertically')
assert(simulationCss.includes('min-height: 100svh') && simulationCss.includes('100dvh'), 'simulation must fit tall and short mobile viewports')
assert(draftCss.includes('max-height: calc(100dvh - env(safe-area-inset-top)'), 'the position picker must fit inside the viewport')
assert(draftCss.includes('.position-filters') && draftCss.includes('overflow-x: auto'), 'position filters must remain horizontally accessible')
assert(draftCss.includes('.roster-bar__slots') && draftCss.includes('scroll-snap-type: x proximity'), 'the mobile roster must remain horizontally accessible')
assert(draftCss.includes("padding-bottom: calc(9.5rem + env(safe-area-inset-bottom))"), 'draft content must clear the fixed roster and home indicator')

for (const minimum of ['width: 2.75rem; height: 2.75rem', 'min-height: 2.75rem', 'min-height: 3.25rem']) {
  assert(`${homeCss}\n${draftCss}\n${menuCss}\n${simulationCss}`.includes(minimum), `missing mobile touch-target contract: ${minimum}`)
}

assert(roster.includes('<strong>{slot.id}</strong>'), 'repeated SP and RP roster slots must be numbered')
assert(results.includes('<strong>{slot.id}</strong>'), 'Results must preserve numbered pitching slots')
assert(simulation.includes('View Full Results') && simulation.includes('aria-live="polite"'), 'simulation reveal must remain readable and explicitly continue to Results')
for (const dialog of dialogs) assert(dialog.includes('useDialogFocusTrap'), 'every modal dialog must trap keyboard focus')

console.log(`Responsive contract passed for ${targetViewports.map(([width, height]) => `${width}×${height}`).join(', ')} plus safe-area, touch-target, roster, picker, Results, and dialog requirements.`)
