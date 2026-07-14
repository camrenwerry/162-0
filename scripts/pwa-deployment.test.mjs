import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
assert.ok(existsSync(dist), 'run npm run build before the PWA deployment test')
const manifestPath = join(dist, 'manifest.webmanifest')
assert.ok(existsSync(manifestPath), 'web app manifest is missing')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
assert.deepEqual({
  name: manifest.name,
  short_name: manifest.short_name,
  description: manifest.description,
  display: manifest.display,
  orientation: manifest.orientation,
  background_color: manifest.background_color,
  theme_color: manifest.theme_color,
  start_url: manifest.start_url,
  scope: manifest.scope,
}, {
  name: 'Diamond Draft',
  short_name: 'Diamond Draft',
  description: 'Draft baseball history and build the ultimate 14-player roster.',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#0D1117',
  theme_color: '#0D1117',
  start_url: '/',
  scope: '/',
})

for (const icon of ['pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png', 'apple-touch-icon-180x180.png', 'favicon.ico']) {
  assert.ok(existsSync(join(dist, icon)), `${icon} is missing`)
}
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
assert.ok(existsSync(join(dist, 'sw.js')), 'service worker is missing')
assert.ok(existsSync(join(dist, 'registerSW.js')), 'service-worker registration is missing')
assert.equal(readFileSync(join(dist, '_redirects'), 'utf8').trim(), '/* /index.html 200')

const index = readFileSync(join(dist, 'index.html'), 'utf8')
for (const metadata of ['manifest.webmanifest', 'apple-touch-icon', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title']) {
  assert.ok(index.includes(metadata), `index is missing ${metadata}`)
}

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
const outputFiles = files(dist)
assert.equal(outputFiles.some((path) => path.endsWith('.csv')), false, 'raw CSV reached production output')
assert.equal(outputFiles.some((path) => /test|fixture|screenshot/i.test(path)), false, 'test or temporary artifact reached production output')
const productionText = outputFiles.filter((path) => /\.(?:html|js|css|json|webmanifest|svg)$/.test(path)).map((path) => readFileSync(path, 'utf8')).join('\n')
assert.equal(productionText.includes('localhost'), false, 'localhost URL reached production output')
assert.equal(productionText.includes('/Users/camrenwerry'), false, 'local filesystem path reached production output')

console.log('PWA deployment contract passed: manifest, icons, service worker, SPA fallback, and clean production output.')
