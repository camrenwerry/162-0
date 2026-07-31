import { expect, test, type Page } from '@playwright/test'

type TransitionMode = 'a' | 'success' | 'waiting' | 'install-failure'

async function setMode(request: Page['request'], mode: TransitionMode) {
  const response = await request.post('/__pwa-mode', { data: { mode } })
  expect(response.ok()).toBe(true)
}

async function serverState(request: Page['request']) {
  const response = await request.get('/__pwa-state')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<{
    mode: TransitionMode
    serviceWorkerRequests: number
    documentRequests: number
  }>
}

async function controllingVersion(page: Page) {
  return page.evaluate(async () => {
    await navigator.serviceWorker.ready
    const controller = navigator.serviceWorker.controller
    if (!controller) return null
    return new Promise<string | null>((resolve) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', receive)
        resolve(null)
      }, 2_000)
      const receive = (event: MessageEvent) => {
        if (event.data?.type !== 'pwa-transition-version') return
        window.clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener('message', receive)
        resolve(typeof event.data.version === 'string' ? event.data.version : null)
      }
      navigator.serviceWorker.addEventListener('message', receive)
      controller.postMessage({ type: 'pwa-transition-version' })
    })
  })
}

async function installVersionA(page: Page) {
  await setMode(page.request, 'a')
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play Classic' })).toBeVisible()
  await expect.poll(() => controllingVersion(page)).toBe('A')
}

test('a delayed Version B waits for control, reloads exactly once, and opens the new Classic route', async ({ page }) => {
  await installVersionA(page)
  const before = await serverState(page.request)
  let documentReloads = 0
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentReloads += 1
  })

  await setMode(page.request, 'success')
  await page.getByRole('button', { name: 'Play Classic' }).click()
  await page.waitForTimeout(300)
  expect(documentReloads).toBe(0)
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()

  expect(documentReloads).toBe(1)
  await expect.poll(() => controllingVersion(page)).toBe('B')
  const after = await serverState(page.request)
  expect(after.serviceWorkerRequests - before.serviceWorkerRequests).toBe(1)
  await expect.poll(() => page.evaluate(() => (
    Object.keys(sessionStorage).filter((key) => key.startsWith('pennant-pursuit:chunk-recovery')).length
  ))).toBe(1)
})

test('two tabs encountering the stale shell together each recover once under the shared worker update', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4175',
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
  })
  const firstPage = await context.newPage()
  const secondPage = await context.newPage()
  try {
    await installVersionA(firstPage)
    await secondPage.goto('/')
    await expect(secondPage.getByRole('button', { name: 'Play Classic' })).toBeVisible()
    await expect.poll(() => controllingVersion(secondPage)).toBe('A')

    let firstReloads = 0
    let secondReloads = 0
    firstPage.on('request', (request) => {
      if (request.resourceType() === 'document') firstReloads += 1
    })
    secondPage.on('request', (request) => {
      if (request.resourceType() === 'document') secondReloads += 1
    })

    await setMode(firstPage.request, 'success')
    await Promise.all([
      firstPage.getByRole('button', { name: 'Play Classic' }).click(),
      secondPage.getByRole('button', { name: 'Play Classic' }).click(),
    ])
    await firstPage.waitForTimeout(300)
    expect({ firstReloads, secondReloads }).toEqual({ firstReloads: 0, secondReloads: 0 })
    await Promise.all([
      expect(firstPage.getByRole('heading', { name: 'Make your pick' })).toBeVisible(),
      expect(secondPage.getByRole('heading', { name: 'Make your pick' })).toBeVisible(),
    ])
    expect({ firstReloads, secondReloads }).toEqual({ firstReloads: 1, secondReloads: 1 })
    await expect.poll(() => controllingVersion(firstPage)).toBe('B')
    await expect.poll(() => controllingVersion(secondPage)).toBe('B')
  } finally {
    await context.close()
  }
})

test('a replacement that never controls the page reaches a truthful fallback without a reload loop', async ({ page }) => {
  await installVersionA(page)
  const before = await serverState(page.request)
  let documentReloads = 0
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentReloads += 1
  })

  await setMode(page.request, 'waiting')
  await page.getByRole('button', { name: 'Play Classic' }).click()
  await expect(page.getByRole('heading', { name: 'The app update could not finish' })).toBeVisible()
  await expect(page.getByText(/after one automatic recovery attempt/)).toBeVisible()
  expect(documentReloads).toBe(0)
  await page.waitForTimeout(1_000)
  expect(documentReloads).toBe(0)
  expect(await controllingVersion(page)).toBe('A')

  const after = await serverState(page.request)
  expect(after.serviceWorkerRequests - before.serviceWorkerRequests).toBe(1)
  expect(await page.evaluate(() => (
    Object.keys(sessionStorage).filter((key) => (
      key.startsWith('pennant-pursuit:chunk-recovery')
      && sessionStorage.getItem(key) === 'attempted'
    )).length
  ))).toBe(1)
})

test('a worker installation failure reaches fallback promptly and never reloads', async ({ page }) => {
  await installVersionA(page)
  let documentReloads = 0
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentReloads += 1
  })

  await setMode(page.request, 'install-failure')
  await page.getByRole('button', { name: 'Play Classic' }).click()
  await expect(page.getByRole('heading', { name: 'The app update could not finish' })).toBeVisible()
  expect(documentReloads).toBe(0)
  await page.waitForTimeout(500)
  expect(documentReloads).toBe(0)
})

test('an ordinary network-like TypeError uses the normal boundary without update or reload', async ({ page }) => {
  await installVersionA(page)
  const before = await serverState(page.request)
  let documentReloads = 0
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentReloads += 1
  })

  await page.getByRole('button', { name: 'Game Updates' }).click()
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  expect(documentReloads).toBe(0)
  const after = await serverState(page.request)
  expect(after.serviceWorkerRequests).toBe(before.serviceWorkerRequests)
  expect(await page.evaluate(() => (
    Object.keys(sessionStorage).some((key) => key.startsWith('pennant-pursuit:chunk-recovery'))
  ))).toBe(false)
})
