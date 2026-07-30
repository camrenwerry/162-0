import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/App.tsx', 'utf8')
for (const route of ["'/'", "'/draft'", "'/leaderboard'", "'/updates'"]) assert.ok(app.includes(route), `${route} route is missing`)
assert.match(app, /window\.history\.pushState\(\{\}, '', nextRoute\)/, 'in-app navigation must preserve history behavior')
assert.match(app, /window\.addEventListener\('popstate'/, 'browser back/forward navigation must remain wired')
assert.match(app, /navigationBlockerRef/, 'route navigation must support an active journey blocker')
assert.match(app, /routeFocusRef/, 'route navigation must move focus deliberately')
assert.match(app, /documentTitleForRoute/, 'route navigation must update document titles')
assert.match(app, /prefers-reduced-motion/, 'route scrolling must respect reduced motion')
assert.match(app, /<ClassicMode[\s\S]*?onHome=/, 'draft navigation target is missing')
assert.match(app, /<GameUpdatesScreen onHome=/, 'Game Updates navigation target is missing')
assert.match(app, /<LeaderboardScreen onHome=/, 'Leaderboard navigation target is missing')
assert.match(app, /<HomeScreen[\s\S]*?onPlay=/, 'Home navigation target is missing')
assert.match(app, /<PennantPursuitLogo className="route-loading__logo"/, 'route fallback branding is missing')
assert.doesNotMatch(app, /setTimeout/, 'navigation must not add artificial loading delays')

console.log('Navigation structural smoke passed: Home, Draft, Leaderboard, Game Updates, guarded history, route focus, titles, reduced-motion scrolling, and branded loading fallbacks remain wired.')
