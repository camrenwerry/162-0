import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const dist = 'dist'
const source = (path) => readFileSync(path, 'utf8')
assert.ok(existsSync(dist), 'run npm run build before the PWA deployment test')

const manifestPath = join(dist, 'manifest.webmanifest')
assert.ok(existsSync(manifestPath), 'web app manifest is missing')
const manifest = JSON.parse(source(manifestPath))
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
  name: 'Pennant Pursuit',
  short_name: 'Pennant Pursuit',
  description: 'Build the greatest roster in baseball history.',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#0D1117',
  theme_color: '#0D1117',
  start_url: '/',
  scope: '/',
})

const requiredIcons = {
  'pwa-64x64.png': [64, 64],
  'pwa-192x192.png': [192, 192],
  'pwa-512x512.png': [512, 512],
  'maskable-icon-512x512.png': [512, 512],
  'apple-touch-icon-180x180.png': [180, 180],
}
const brandingAssets = {
  'pennant-pursuit-icon-source.png': [704, 704, 'png'],
  'branding/pennant-pursuit-master.png': [1024, 1024, 'png'],
  'branding/pennant-pursuit-logo.png': [704, 560, 'png'],
  'branding/pennant-pursuit-logo-dark.webp': [704, 560, 'webp'],
  'branding/pennant-pursuit-logo-home.webp': [689, 542, 'webp'],
  'branding/pennant-pursuit-logo-light.webp': [704, 560, 'webp'],
  'branding/pennant-pursuit-logo-compact.webp': [672, 520, 'webp'],
  'branding/pennant-pursuit-promotional-square.png': [1024, 1024, 'png'],
  'branding/pennant-pursuit-favicon-mark.png': [180, 180, 'png'],
  'branding/pennant-pursuit-social-preview.jpg': [1200, 630, 'jpeg'],
}

for (const icon of [...Object.keys(requiredIcons), 'favicon.svg', 'favicon.ico']) {
  assert.ok(existsSync(join(dist, icon)), `${icon} is missing`)
}
const faviconIco = readFileSync(join(dist, 'favicon.ico'))
const faviconIcoCount = faviconIco.readUInt16LE(4)
const faviconIcoSizes = Array.from({ length: faviconIcoCount }, (_, index) => {
  const size = faviconIco.readUInt8(6 + index * 16)
  return size === 0 ? 256 : size
})
assert.deepEqual(faviconIcoSizes, [16, 32, 48], 'favicon.ico must contain dedicated small-size PP marks')
for (const [icon, [expectedWidth, expectedHeight]] of Object.entries(requiredIcons)) {
  const metadata = await sharp(join(dist, icon)).metadata()
  assert.equal(metadata.width, expectedWidth, `${icon} has the wrong width`)
  assert.equal(metadata.height, expectedHeight, `${icon} has the wrong height`)
}
for (const [asset, [expectedWidth, expectedHeight, expectedFormat]] of Object.entries(brandingAssets)) {
  const path = join(dist, asset)
  assert.ok(existsSync(path), `${asset} is missing`)
  const metadata = await sharp(path).metadata()
  assert.equal(metadata.width, expectedWidth, `${asset} has the wrong width`)
  assert.equal(metadata.height, expectedHeight, `${asset} has the wrong height`)
  assert.equal(metadata.format, expectedFormat, `${asset} has the wrong format`)
}

for (const icon of ['apple-touch-icon-180x180.png', 'maskable-icon-512x512.png']) {
  const image = sharp(join(dist, icon))
  const metadata = await image.metadata()
  if (metadata.hasAlpha) {
    const stats = await image.stats()
    assert.equal(stats.channels[3].min, 255, `${icon} must be full-bleed and opaque`)
  }
}
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
assert.ok(manifest.icons.some((icon) => icon.src === '/pwa-192x192.png' && icon.sizes === '192x192'))
assert.ok(manifest.icons.some((icon) => icon.src === '/pwa-512x512.png' && icon.sizes === '512x512'))

assert.ok(existsSync(join(dist, 'sw.js')), 'service worker is missing')
assert.ok(existsSync(join(dist, 'registerSW.js')), 'service-worker registration is missing')
assert.equal(source(join(dist, '_redirects')).trim(), '/* /index.html 200')
const viteConfig = source('vite.config.ts')
assert.match(viteConfig, /registerType: 'autoUpdate'/, 'installed apps must update automatically')
assert.match(viteConfig, /cleanupOutdatedCaches: true/, 'obsolete pre-1.0 caches must be cleaned')
const pwaAssetsConfig = source('pwa-assets.config.ts')
const maskablePadding = Number(pwaAssetsConfig.match(/maskable:.*padding: ([\d.]+)/)?.[1])
assert.ok(Number.isFinite(maskablePadding), 'maskable icon padding is missing')
const maskableSize = 512
const iconSourceSize = 704
const iconSourceRenderedSize = Math.round(maskableSize * (1 - maskablePadding))
const iconSourceScale = iconSourceRenderedSize / iconSourceSize
const iconSourceOffset = (maskableSize - iconSourceRenderedSize) / 2
const compactLogoImage = sharp(join(dist, 'branding/pennant-pursuit-logo-compact.webp')).ensureAlpha()
const { data: compactLogoPixels, info: compactLogoInfo } = await compactLogoImage.raw().toBuffer({ resolveWithObject: true })
let maximumMaskableArtworkRadius = 0
for (let y = 0; y < compactLogoInfo.height; y += 1) {
  for (let x = 0; x < compactLogoInfo.width; x += 1) {
    const alpha = compactLogoPixels[(y * compactLogoInfo.width + x) * compactLogoInfo.channels + 3]
    if (alpha === 0) continue
    const renderedX = iconSourceOffset + (16 + x + 0.5) * iconSourceScale
    const renderedY = iconSourceOffset + (92 + y + 0.5) * iconSourceScale
    maximumMaskableArtworkRadius = Math.max(
      maximumMaskableArtworkRadius,
      Math.hypot(renderedX - maskableSize / 2, renderedY - maskableSize / 2),
    )
  }
}
assert.ok(maximumMaskableArtworkRadius <= maskableSize * 0.4, 'all approved artwork must fit inside the maskable 80% safe circle')

const index = source(join(dist, 'index.html'))
for (const metadata of ['manifest.webmanifest', 'apple-touch-icon', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title']) {
  assert.ok(index.includes(metadata), `index is missing ${metadata}`)
}
for (const branding of ['Pennant Pursuit', 'pennant-pursuit-social-preview.jpg', 'summary_large_image', 'pennant-pursuit-logo-home.webp']) {
  assert.ok(index.includes(branding), `index is missing ${branding}`)
}
assert.ok(index.includes('href="/favicon.svg"'), 'index is not using the dedicated small-size favicon')

const sw = source(join(dist, 'sw.js'))
const precacheUrls = [...sw.matchAll(/url:"([^"]+)"/g)].map(([, url]) => url)
assert.equal(precacheUrls.length, new Set(precacheUrls).size, 'service-worker precache contains duplicate URLs')
for (const asset of ['branding/pennant-pursuit-logo-home.webp', 'branding/pennant-pursuit-logo-compact.webp']) {
  assert.ok(precacheUrls.includes(asset), `${asset} is missing from the offline shell`)
}
for (const asset of ['branding/pennant-pursuit-master.png', 'branding/pennant-pursuit-social-preview.jpg', 'pennant-pursuit-icon-source.png']) {
  assert.equal(precacheUrls.includes(asset), false, `${asset} should not inflate the offline shell`)
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
assert.equal(outputFiles.some((path) => /\s[234](?:\.|$)/.test(path)), false, 'conflict-copy file reached production output')
const productionText = outputFiles.filter((path) => /\.(?:html|js|css|json|webmanifest|svg)$/.test(path)).map(source).join('\n')
const compatibilitySafeText = productionText.replaceAll('diamond-draft:tutorial-dismissed:v1', '')
assert.doesNotMatch(compatibilitySafeText, /diamond[ -]?draft|diamonddraft/i, 'visible legacy branding reached production output')
assert.equal(productionText.includes('localhost'), false, 'localhost URL reached production output')
assert.equal(productionText.includes('/Users/camrenwerry'), false, 'local filesystem path reached production output')

console.log('Pennant Pursuit PWA contract passed: branding, metadata, icons, safe zones, cache upgrade, offline logos, social preview, and clean output.')
