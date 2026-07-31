import { expect, test } from '@playwright/test'

const PRODUCTION_ORIGIN = 'http://127.0.0.1:4173'

test('a missing lazy chunk with service workers isolated reaches the truthful fallback without reloading', async ({ page }) => {
  let chunkRequests = 0
  let documentReloads = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.resourceType() === 'document' && url.pathname === '/leaderboard') {
      documentReloads += 1
    }
  })
  await page.route(/\/assets\/LeaderboardScreen-[^/]+\.js$/, async (route) => {
    chunkRequests += 1
    await route.abort('connectionreset')
  })

  await page.goto(PRODUCTION_ORIGIN)
  await page.getByRole('button', { name: 'Leaderboards' }).click()
  await expect(page.getByRole('heading', { name: 'The app update could not finish' })).toBeVisible()
  await expect(page.getByText(/after one automatic recovery attempt/)).toBeVisible()
  expect(chunkRequests).toBe(1)
  expect(documentReloads).toBe(0)
  expect(await page.evaluate(() => (
    Object.keys(sessionStorage).filter((key) => (
      key.startsWith('pennant-pursuit:chunk-recovery')
      && sessionStorage.getItem(key) === 'attempted'
    )).length
  ))).toBe(1)
})

test('sessionStorage failure cannot turn missing-chunk recovery into a reload loop', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage is unavailable.', 'SecurityError')
      },
    })
  })
  let documentReloads = 0
  page.on('request', (request) => {
    if (request.resourceType() === 'document' && new URL(request.url()).pathname === '/draft') {
      documentReloads += 1
    }
  })
  await page.route(/\/assets\/ClassicMode-[^/]+\.js$/, (route) => route.abort('connectionreset'))

  await page.goto(PRODUCTION_ORIGIN)
  await page.getByRole('button', { name: 'Play Classic' }).click()
  await expect(page.getByRole('heading', { name: 'The app update could not finish' })).toBeVisible()
  await page.waitForTimeout(500)
  expect(documentReloads).toBe(0)
})
