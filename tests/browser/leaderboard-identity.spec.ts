import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  DEVICE_CREDENTIAL,
  RECOVERY_CODE,
  REPLACEMENT_CREDENTIAL,
  REPLACEMENT_RECOVERY_CODE,
  STORAGE_KEY,
  containsProtectedValue,
  expectProtectedCode,
  expectNoHorizontalOverflow,
  fillProtectedInput,
  identityStatus,
  leaderboardResponse,
  storedIdentityObservation,
  storedIdentity,
} from './helpers'

async function seedIdentity(context: BrowserContext, credential = DEVICE_CREDENTIAL) {
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    STORAGE_KEY,
    storedIdentity(credential),
  ])
}

async function routeStatus(page: Page, renameEligible = true) {
  await page.route('**/api/v1/leaderboard-identity-status', async (route) => {
    const body = route.request().postDataJSON() as { deviceCredential: string }
    if (body.deviceCredential !== DEVICE_CREDENTIAL) {
      await route.fulfill({
        status: 401,
        json: { ok: false, error: { code: 'identity_credential_invalid', message: 'invalid' } },
      })
      return
    }
    await route.fulfill({ json: identityStatus({ renameEligible }).response })
  })
}

test.describe.skip('Enabled frontend states remain prohibited by the 3D-2A all-disabled policy', () => {

test('deferred valid stored identity can rename while status and recovery are independently disabled', async ({ page, context }) => {
  await seedIdentity(context)
  let statusRequests = 0
  let renameRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/leaderboard-identity-status') {
      statusRequests += 1
    }
  })
  await page.route('**/api/v1/leaderboards?**', (route) => route.fulfill({
    json: leaderboardResponse(),
  }))
  await page.route('**/api/v1/leaderboard-name-availability', async (route) => {
    const body = route.request().postDataJSON() as { displayName: string }
    await route.fulfill({
      json: {
        ok: true,
        schemaVersion: 'pennant-leaderboard-identity-v1',
        displayName: body.displayName,
        available: true,
      },
    })
  })
  await page.route('**/api/v1/leaderboard-identity-rename', async (route) => {
    renameRequests += 1
    const body = route.request().postDataJSON() as {
      deviceCredential: string
      displayName: string
    }
    expect(body).toEqual({
      deviceCredential: DEVICE_CREDENTIAL,
      displayName: 'Player Maple',
    })
    await route.fulfill({
      json: identityStatus({
        displayName: 'Player Maple',
        renameEligible: true,
      }).response,
    })
  })

  await page.goto('http://127.0.0.1:4177/leaderboard')
  await expect(page.getByRole('heading', { name: 'Player Cedar' })).toBeVisible()
  await expect(page.getByText('Saved on this device. Live identity status is separately disabled.')).toBeVisible()
  await page.getByText('Change display name').click()
  await page.getByLabel('New display name').fill('Player Maple')
  await page.getByRole('button', { name: 'Update Display Name' }).click()
  await expect(page.getByRole('heading', { name: 'Player Maple' })).toBeVisible()
  await expect(page.getByText('Recover an identity')).toHaveCount(0)
  expect(statusRequests).toBe(0)
  expect(renameRequests).toBe(1)
})

test('deferred Daily, Weekly, and All-Time reads anchor one personal row and restart stale pagination', async ({ page, context }) => {
  await seedIdentity(context)
  await routeStatus(page)
  const periods: string[] = []
  let stale = false
  let personalSearchFails = false
  const personalSubmittedAt = '2026-07-30T20:00:00.000Z'
  await page.route('**/api/v1/leaderboards?**', async (route) => {
    const url = new URL(route.request().url())
    const period = url.searchParams.get('period') as 'daily' | 'weekly' | 'all-time'
    const cursor = url.searchParams.get('cursor')
    periods.push(period)
    if (cursor === 'stale') {
      stale = true
      await route.fulfill({
        status: 400,
        json: { ok: false, error: { code: 'invalid_query', message: 'stale cursor' } },
      })
      return
    }
    if (cursor === 'next') {
      if (personalSearchFails) {
        await route.fulfill({
          status: 503,
          json: { ok: false, error: { code: 'leaderboard_unavailable', message: 'unavailable' } },
        })
        return
      }
      await route.fulfill({
        json: leaderboardResponse({
          period,
          entries: [{
            rank: 27,
            playerLabel: 'Player Cedar',
            projectedWins: 88,
            overallScore: 70.1,
            tier: 'In the hunt',
            submittedAt: personalSubmittedAt,
            mode: 'classic',
          }],
          nextCursor: 'stale',
        }),
      })
      return
    }
    await route.fulfill({ json: leaderboardResponse({ period, nextCursor: 'next' }) })
  })

  await page.goto('/leaderboard')
  await expect(page.getByRole('heading', { name: 'Still in the chase' })).toBeVisible()
  await expect(page.locator('.lb-table tr.is-personal')).toHaveCount(1)
  await expect(page.locator('.lb-personal-anchor')).toHaveCount(1)
  await page.getByRole('button', { name: 'Load More' }).click()
  await expect(page.locator('.lb-table tr.is-personal')).toHaveCount(1)
  await expect(page.locator('.lb-personal-anchor')).toHaveCount(0)
  await page.getByRole('button', { name: 'Load More' }).click()
  await expect(page.getByRole('heading', { name: 'Restart these standings' })).toBeVisible()
  expect(stale).toBe(true)
  await page.getByRole('button', { name: 'Restart Board' }).click()
  await expect(page.getByRole('heading', { name: 'Best Run' })).toBeVisible()

  const daily = page.getByRole('tab', { name: 'Daily' })
  await daily.focus()
  await daily.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Weekly' })).toBeFocused()
  await page.getByRole('tab', { name: 'All-Time' }).click()
  await expect(page.getByRole('tab', { name: 'All-Time' })).toHaveAttribute('aria-selected', 'true')
  expect(new Set(periods)).toEqual(new Set(['daily', 'weekly', 'all-time']))
  personalSearchFails = true
  await page.getByRole('tab', { name: 'Daily' }).click()
  await expect(page.getByText('Your identity is verified.')).toBeVisible()

  for (const width of [320, 390, 768, 820, 1280]) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 })
    await expectNoHorizontalOverflow(page)
  }
})

test('overlapping pages retain one stable row across relative-time boundaries while ties and personal rows remain distinct', async ({ page, context }) => {
  const firstNow = Date.parse('2026-07-30T20:59:30.000Z')
  const secondNow = Date.parse('2026-07-30T21:00:30.000Z')
  const thirdNow = Date.parse('2026-07-30T22:00:30.000Z')
  await page.addInitScript((initialNow) => {
    let currentNow = initialNow
    Date.now = () => currentNow
    Object.defineProperty(window, '__setPennantTestNow', {
      configurable: true,
      value: (nextNow: number) => { currentNow = nextNow },
    })
  }, firstNow)
  await seedIdentity(context)
  await routeStatus(page)
  const consoleMessages: string[] = []
  page.on('console', (message) => consoleMessages.push(message.text()))
  const overlapRow = {
    rank: 1,
    playerLabel: 'Player Oak',
    projectedWins: 110,
    overallScore: 90,
    tier: 'Pennant favorite',
    submittedAt: '2026-07-30T20:00:00.000Z',
    mode: 'classic',
  } as const
  const visiblePersonalRow = {
    rank: 2,
    playerLabel: 'Player Cedar',
    projectedWins: 109,
    overallScore: 89,
    tier: 'Pennant contender',
    submittedAt: '2026-07-30T20:00:30.000Z',
    mode: 'classic',
  } as const
  const firstTie = {
    rank: 3,
    playerLabel: 'Player Birch',
    projectedWins: 105,
    overallScore: 85,
    tier: 'Pennant contender',
    submittedAt: '2026-07-30T20:01:00.000Z',
    mode: 'classic',
  } as const
  await page.route('**/api/v1/leaderboards?**', async (route) => {
    const url = new URL(route.request().url())
    const period = url.searchParams.get('period') as 'daily'
    const cursor = url.searchParams.get('cursor')
    await route.fulfill({
      json: leaderboardResponse({
        period,
        entries: cursor === 'overlap-1'
          ? [
            overlapRow,
            {
              ...firstTie,
              playerLabel: 'Player Maple',
              submittedAt: '2026-07-30T20:02:00.000Z',
            },
            {
              ...overlapRow,
              submittedAt: '2026-07-30T20:03:00.000Z',
            },
          ]
          : cursor === 'overlap-2'
            ? [overlapRow]
            : [overlapRow, visiblePersonalRow, firstTie],
        nextCursor: cursor === 'overlap-2' ? null : cursor === 'overlap-1' ? 'overlap-2' : 'overlap-1',
      }),
    })
  })

  await page.goto('/leaderboard')
  const rankingRows = page.locator('.lb-table tbody tr')
  const oakRows = rankingRows
    .filter({ hasText: 'Player Oak' })
    .filter({ hasText: '110 wins' })
  await expect(oakRows).toHaveCount(1)
  await expect(oakRows).toContainText('59m ago')
  await expect(page.locator('.lb-table tr.is-personal')).toHaveCount(1)
  await expect(page.locator('.lb-personal-anchor')).toHaveCount(0)

  await page.evaluate((nextNow) => {
    const setNow = (window as unknown as Record<string, unknown>).__setPennantTestNow
    if (typeof setNow !== 'function') throw new Error('Test clock is unavailable.')
    setNow(nextNow)
  }, secondNow)
  await page.getByRole('button', { name: 'Load More' }).click()
  await expect(oakRows).toHaveCount(2)
  await expect(oakRows.filter({ hasText: '1h ago' })).toHaveCount(1)
  await expect(rankingRows.filter({ hasText: '#3' })).toHaveCount(2)
  await expect(page.locator('.lb-table tr.is-personal')).toHaveCount(1)
  await expect(page.locator('.lb-personal-anchor')).toHaveCount(0)
  expect(consoleMessages.some((message) => /same key|unique "key"/iu.test(message))).toBe(false)
  expect(await page.locator('[data-player-id], [data-run-id]').count()).toBe(0)

  await page.evaluate((nextNow) => {
    const setNow = (window as unknown as Record<string, unknown>).__setPennantTestNow
    if (typeof setNow !== 'function') throw new Error('Test clock is unavailable.')
    setNow(nextNow)
  }, thirdNow)
  await page.getByRole('button', { name: 'Load More' }).click()
  await expect(oakRows).toHaveCount(2)
  await expect(oakRows.filter({ hasText: '2h ago' })).toHaveCount(1)
  await expect(page.locator('.lb-table tr.is-personal')).toHaveCount(1)
  await expect(page.locator('.lb-personal-anchor')).toHaveCount(0)
  expect(consoleMessages.some((message) => /same key|unique "key"/iu.test(message))).toBe(false)
  expect(containsProtectedValue(await page.locator('body').innerText(), [
    DEVICE_CREDENTIAL,
    RECOVERY_CODE,
  ])).toBe(false)
})

test('offline, rate-limit, and retry states remain truthful', async ({ page, context }) => {
  let mode: 'rate' | 'offline' | 'success' = 'rate'
  await page.route('**/api/v1/leaderboard-identity-status', (route) => route.fulfill({
    status: 401,
    json: { ok: false, error: { code: 'identity_credential_invalid', message: 'invalid' } },
  }))
  await page.route('**/api/v1/leaderboards?**', async (route) => {
    if (mode === 'rate') {
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '10' },
        json: { ok: false, error: { code: 'rate_limited', message: 'limited' } },
      })
    } else if (mode === 'offline') {
      await route.abort('internetdisconnected')
    } else {
      const period = new URL(route.request().url()).searchParams.get('period') as 'daily'
      await route.fulfill({ json: leaderboardResponse({ period }) })
    }
  })
  await page.goto('/leaderboard')
  await expect(page.getByText('Too many requests were made. Wait a moment, then try again.')).toBeVisible()
  mode = 'offline'
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Try Again' }).click()
  await expect(page.getByText('You appear to be offline. Reconnect and try again.')).toBeVisible()
  mode = 'success'
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Try Again' }).click()
  await expect(page.getByText('Player Oak')).toBeVisible()
})

test('returning status enforces rename cooldown; one stateful recovery backend rotates every old credential and code', async ({ page, context, browser }) => {
  let activeCredential = DEVICE_CREDENTIAL
  let activeRecoveryCode = RECOVERY_CODE
  let recoveryVersion = 1
  let oldCredentialRejections = 0
  let newCredentialAcceptances = 0

  const installStatefulBackend = async (target: Page) => {
    await target.route('**/api/v1/leaderboards?**', (route) => route.fulfill({ json: leaderboardResponse() }))
    await target.route('**/api/v1/leaderboard-identity-status', async (route) => {
      const body = route.request().postDataJSON() as { deviceCredential: string }
      if (body.deviceCredential !== activeCredential) {
        if (body.deviceCredential === DEVICE_CREDENTIAL) oldCredentialRejections += 1
        await route.fulfill({
          status: 401,
          json: { ok: false, error: { code: 'identity_credential_invalid', message: 'invalid' } },
        })
        return
      }
      if (body.deviceCredential === REPLACEMENT_CREDENTIAL) newCredentialAcceptances += 1
      const status = identityStatus({ renameEligible: false }).response
      await route.fulfill({
        json: {
          ...status,
          identity: { ...status.identity, recoveryVersion },
        },
      })
    })
    await target.route('**/api/v1/leaderboard-identity-recover', async (route) => {
      const body = route.request().postDataJSON() as { recoveryCode: string, recoveryOperationId: string }
      expect(/^ppr1_[A-Za-z0-9_-]{43}$/.test(body.recoveryOperationId)).toBe(true)
      if (body.recoveryCode !== activeRecoveryCode) {
        await route.fulfill({
          status: 422,
          json: { ok: false, error: { code: 'identity_recovery_invalid', message: 'invalid' } },
        })
        return
      }
      activeCredential = REPLACEMENT_CREDENTIAL
      activeRecoveryCode = REPLACEMENT_RECOVERY_CODE
      recoveryVersion = 2
      await route.fulfill({
        json: {
          ok: true,
          schemaVersion: 'pennant-leaderboard-identity-v1',
          identity: {
            displayName: 'Player Cedar',
            deviceCredential: activeCredential,
            recoveryCode: activeRecoveryCode,
            recoveryCodeMustBeStored: true,
            recoveryVersion,
          },
          idempotentRetry: false,
          recoveryRetryExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        },
      })
    })
  }

  await seedIdentity(context)
  await installStatefulBackend(page)
  await page.goto('/leaderboard')
  await expect(page.getByRole('heading', { name: 'Player Cedar' })).toBeVisible()
  await page.getByText('Change display name').click()
  await expect(page.getByRole('button', { name: 'Update Display Name' })).toBeDisabled()
  await expect(page.getByText(/Next change:/)).toBeVisible()

  const recoveryContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4174',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  const recoveryPage = await recoveryContext.newPage()
  await installStatefulBackend(recoveryPage)
  await recoveryPage.goto('/leaderboard')
  await recoveryPage.getByText('Recover an identity').click()
  await fillProtectedInput(recoveryPage, 'Recovery code', RECOVERY_CODE)
  const recoverButton = recoveryPage.getByRole('button', { name: 'Recover Identity' })
  await recoverButton.evaluate((button) => {
    button.click()
    button.click()
  })
  const replacementCode = recoveryPage.getByLabel('Replacement recovery code')
  await expectProtectedCode(replacementCode, REPLACEMENT_RECOVERY_CODE)
  const replacementStorage = await recoveryPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
  expect(storedIdentityObservation(
    replacementStorage,
    REPLACEMENT_CREDENTIAL,
    [DEVICE_CREDENTIAL, RECOVERY_CODE, REPLACEMENT_RECOVERY_CODE],
  )).toEqual({
    present: true,
    validJsonRecord: true,
    expectedCredential: true,
    containsProtectedRecoveryMaterial: false,
  })

  recoveryPage.once('dialog', (dialog) => dialog.dismiss())
  await recoveryPage.getByRole('button', { name: 'Return home' }).click()
  await expect(recoveryPage).toHaveURL(/\/leaderboard$/)
  await expectProtectedCode(replacementCode, REPLACEMENT_RECOVERY_CODE)
  expect(await recoveryPage.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    return window.dispatchEvent(event)
  })).toBe(false)
  await recoveryPage.getByLabel('I saved the replacement code somewhere private.').check()
  await recoveryPage.getByRole('button', { name: 'Finish Recovery' }).click()
  await expect(replacementCode).toHaveCount(0)
  await recoveryContext.close()

  const oldContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4174',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  await seedIdentity(oldContext, DEVICE_CREDENTIAL)
  const oldPage = await oldContext.newPage()
  await installStatefulBackend(oldPage)
  await oldPage.goto('/leaderboard')
  await expect(oldPage.getByText('The saved device identity is no longer valid.')).toBeVisible()
  await fillProtectedInput(oldPage, 'Recovery code', RECOVERY_CODE)
  await oldPage.getByRole('button', { name: 'Recover Identity' }).click()
  await expect(oldPage.getByText('That recovery code could not be verified.')).toBeVisible()
  await oldContext.close()

  const replacementContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4174',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  await seedIdentity(replacementContext, REPLACEMENT_CREDENTIAL)
  const replacementPage = await replacementContext.newPage()
  await installStatefulBackend(replacementPage)
  await replacementPage.goto('/leaderboard')
  await expect(replacementPage.getByRole('heading', { name: 'Player Cedar' })).toBeVisible()
  expect(oldCredentialRejections).toBeGreaterThanOrEqual(1)
  expect(newCredentialAcceptances).toBeGreaterThanOrEqual(1)
  await replacementContext.close()
})

})
