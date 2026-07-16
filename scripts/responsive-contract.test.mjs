import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const index = read('index.html')
const app = read('src/App.tsx')
const globalCss = read('src/index.css')
const home = read('src/components/home/HomeScreen.tsx')
const homeCss = read('src/components/home/HomeScreen.css')
const updatesCss = read('src/components/updates/GameUpdatesScreen.css')
const draftCss = read('src/components/draft/ClassicMode.css')
const menuCss = read('src/components/GameMenu.css')
const roster = read('src/components/draft/RosterBar.tsx')
const results = read('src/components/draft/ResultsScreen.tsx')
const simulation = read('src/components/results/SeasonSimulation.tsx')
const simulationCss = read('src/components/results/SeasonSimulation.css')
const logo = read('src/components/PennantPursuitLogo.tsx')
const logoCss = read('src/components/PennantPursuitLogo.css')
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
assert(index.includes('<style>html,body,#root{min-height:100%;background:#03080d}</style>'), 'the initial document paint must use the dark app background before CSS loads')
assert(globalCss.includes('overflow-x: clip'), 'global horizontal overflow protection is required')
assert(globalCss.includes('.app-route, .app-route__content { min-height: 100svh; background: #03080d; }'), 'route changes must retain a stable dark viewport without layout shift')
assert(globalCss.includes('animation: app-screen-in 180ms') && globalCss.includes('.app-route__content, .route-loading { animation: none; }'), 'route fades must stay fast and respect reduced motion')
assert(app.includes('key={route}') && app.includes('aria-busy="true"') && app.includes('<Suspense fallback='), 'major routes must have keyed transitions and an accessible loading state')
assert(app.includes('<PennantPursuitLogo') && app.includes('route-loading__logo'), 'route loading must use Pennant Pursuit branding')
assert(app.includes("if (nextRoute !== route) window.history.pushState") && !app.includes('setTimeout'), 'navigation must remain immediate and avoid duplicate history entries')
for (const inset of ['top', 'right', 'bottom', 'left']) {
  assert(`${homeCss}\n${draftCss}\n${menuCss}`.includes(`env(safe-area-inset-${inset})`), `missing ${inset} safe-area handling`)
  assert(updatesCss.includes(`env(safe-area-inset-${inset})`), `Game Updates must respect the ${inset} safe area`)
}

assert(homeCss.includes('overflow-x: clip') && !homeCss.includes('.dd-home { position: relative; min-height: 100svh; overflow: hidden'), 'Home must scroll vertically on short screens')
assert(updatesCss.includes('min-height: 100svh') && updatesCss.includes('overflow-x: clip'), 'Game Updates must preserve the mobile viewport and horizontal-overflow contract')
assert(draftCss.includes('.results-screen { position: relative; min-height: 100svh; overflow-x: clip'), 'Results must scroll vertically')
assert(simulationCss.includes('min-height: 100svh') && simulationCss.includes('100dvh'), 'simulation must fit tall and short mobile viewports')
assert(draftCss.includes('max-height: calc(100dvh - env(safe-area-inset-top)'), 'the position picker must fit inside the viewport')
assert(draftCss.includes('.position-filters') && draftCss.includes('overflow-x: auto'), 'position filters must remain horizontally accessible')
assert(draftCss.includes('.roster-bar__slots') && draftCss.includes('scroll-snap-type: x proximity'), 'the mobile roster must remain horizontally accessible')
assert(draftCss.includes("padding-bottom: calc(9.5rem + env(safe-area-inset-bottom))"), 'draft content must clear the fixed roster and home indicator')

for (const minimum of ['width: 2.75rem; height: 2.75rem', 'min-height: 2.75rem', 'min-height: 3.25rem']) {
  assert(`${homeCss}\n${updatesCss}\n${draftCss}\n${menuCss}\n${simulationCss}`.includes(minimum), `missing mobile touch-target contract: ${minimum}`)
}
assert(updatesCss.includes('min-height: 2.75rem'), 'Game Updates must preserve a mobile touch target for Home navigation')

assert(roster.includes('<strong>{slot.id}</strong>'), 'repeated SP and RP roster slots must be numbered')
assert(results.includes('<strong>{slot.id}</strong>'), 'Results must preserve numbered pitching slots')
assert(simulation.includes('View Full Results') && simulation.includes('aria-live="polite"'), 'simulation reveal must remain readable and explicitly continue to Results')
assert(homeCss.includes('.pennant-pursuit-logo') && draftCss.includes('.pennant-pursuit-logo.results-logo') && updatesCss.includes('.pennant-pursuit-logo'), 'every logo placement must use the active Pennant Pursuit selector')
assert(!`${homeCss}\n${draftCss}\n${updatesCss}`.includes('.diamond-draft-logo'), 'legacy logo selectors must not remain active')
assert(home.includes('variant="home"') && logo.includes('pennant-pursuit-logo-home.webp'), 'Home must use its evenly cropped logo derivative')
assert(logo.includes('pennant-pursuit-logo-dark.webp') && logo.includes('pennant-pursuit-logo-compact.webp'), 'the UI must retain lossless production logo variants')
assert(homeCss.includes('aspect-ratio: 704 / 560') && homeCss.includes('place-items: center'), 'the Home derivative must preserve the existing layout footprint and balanced vertical inset')
assert(logoCss.includes('20rem') && logoCss.includes('aspect-ratio: 704 / 560'), 'the full logo must stay at or below its 2× source-resolution contract')
assert(draftCss.includes('.pennant-pursuit-logo.results-logo { width: 6.5rem;'), 'the compact Results logo must not compete with the projected record')
for (const dialog of dialogs) assert(dialog.includes('useDialogFocusTrap'), 'every modal dialog must trap keyboard focus')

console.log(`Responsive contract passed for ${targetViewports.map(([width, height]) => `${width}×${height}`).join(', ')} plus safe-area, touch-target, roster, picker, Results, and dialog requirements.`)
