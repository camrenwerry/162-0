import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/App.tsx', 'utf8')
for (const route of ["'/'", "'/draft'", "'/updates'"]) assert.ok(app.includes(route), `${route} route is missing`)
assert.match(app, /window\.history\.pushState\(\{\}, '', nextRoute\)/, 'in-app navigation must preserve history behavior')
assert.match(app, /window\.addEventListener\('popstate'/, 'browser back/forward navigation must remain wired')
assert.match(app, /<ClassicMode onHome=/, 'draft navigation target is missing')
assert.match(app, /<GameUpdatesScreen onHome=/, 'Game Updates navigation target is missing')
assert.match(app, /<HomeScreen onPlay=/, 'Home navigation target is missing')
assert.match(app, /<PennantPursuitLogo className="route-loading__logo"/, 'route fallback branding is missing')
assert.doesNotMatch(app, /setTimeout/, 'navigation must not add artificial loading delays')

console.log('Navigation smoke passed: Home, Draft, Game Updates, history, popstate, and branded loading fallbacks remain intact.')
