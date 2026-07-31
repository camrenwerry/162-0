import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import {
  CLAIM_CAPABILITY,
  DEVICE_CREDENTIAL,
  RECOVERY_CODE,
  STORAGE_KEY,
  completeClassicDraft,
  containsProtectedValue,
  expectProtectedCode,
  protectedDigest,
  storedIdentityObservation,
  storedIdentity,
  submissionResponse,
  ticketResponse,
} from './helpers'

const PRIVATE_ARTIFACT_FIELDS = new Set([
  'capability',
  'claimCapability',
  'deviceCredential',
  'identityCredential',
  'recoveryCode',
  'roster',
  'ticket',
  'transcript',
])

function privacySafeArtifact(value: unknown, field = ''): unknown {
  if (PRIVATE_ARTIFACT_FIELDS.has(field)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((entry) => privacySafeArtifact(entry))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, privacySafeArtifact(entry, key)]),
  )
}

async function installSuccessfulClaimFlow(page: Page) {
  await page.route('**/api/v1/draft-ticket', (route) => route.fulfill({ json: ticketResponse() }))
  await page.route('**/api/v1/submit-draft', (route) => route.fulfill({
    status: 201,
    json: submissionResponse(),
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
  await page.route('**/api/v1/leaderboard-identity-claim', (route) => route.fulfill({
    status: 201,
    json: {
      ok: true,
      schemaVersion: 'pennant-leaderboard-identity-v1',
      identity: {
        displayName: 'Player Cedar',
        deviceCredential: DEVICE_CREDENTIAL,
        recoveryCode: RECOVERY_CODE,
        recoveryCodeMustBeStored: true,
        recoveryVersion: 1,
      },
    },
  }))
}

test('@ci @release production ignores development activation and disabled leaderboard performs no public request', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
  })
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value)
    localStorage.setItem('pennant-pursuit:leaderboard-preview-identity:v1', 'Player Fixture')
    localStorage.setItem('leaderboardFixture', 'ready')
  }, [STORAGE_KEY, storedIdentity()])
  await page.goto('http://127.0.0.1:4173/leaderboard?leaderboardFixture=ready&leaderboardPreview=qualified')
  await expect(page.getByRole('heading', { name: 'Leaderboards aren’t open yet' })).toBeVisible()
  await expect(page.getByText('Local preview')).toHaveCount(0)
  expect(apiRequests).toEqual([])
})

test('@release partial claim/submission activation allows anonymous submission only when identity is genuinely missing', async ({ page }) => {
  let statusRequests = 0
  let submissionBody: Record<string, unknown> | null = null
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/leaderboard-identity-status') {
      statusRequests += 1
    }
  })
  await page.route('**/api/v1/draft-ticket', (route) => route.fulfill({
    json: ticketResponse(),
  }))
  await page.route('**/api/v1/submit-draft', async (route) => {
    submissionBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, json: submissionResponse() })
  })
  await page.goto('http://127.0.0.1:4177/')
  await page.getByRole('button', { name: 'Play Classic' }).click()
  await completeClassicDraft(page)
  await expect(page.getByRole('heading', { name: 'Claim your place on the board' })).toBeVisible()
  expect(submissionBody).not.toBeNull()
  expect(submissionBody?.identityCredential).toBeNull()
  expect(statusRequests).toBe(0)
  await expect(page.getByText('Recover an identity')).toHaveCount(0)
})

test('@release corrupt, outdated, rejected, and temporarily unverifiable continuity block anonymous replacement', async ({ browser }) => {
  test.setTimeout(180_000)
  const scenarios = [
    {
      label: 'corrupt',
      baseURL: 'http://127.0.0.1:4177',
      expected: 'The saved identity record is damaged.',
      rejectStatus: false,
    },
    {
      label: 'outdated',
      baseURL: 'http://127.0.0.1:4177',
      expected: 'The saved identity record uses an unsupported version.',
      rejectStatus: false,
    },
    {
      label: 'unavailable',
      baseURL: 'http://127.0.0.1:4177',
      expected: 'This browser cannot safely read or verify its saved identity.',
      rejectStatus: false,
    },
    {
      label: 'invalid',
      baseURL: 'http://127.0.0.1:4174',
      expected: 'The saved device credential was rejected.',
      rejectStatus: true,
    },
  ] as const

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      baseURL: scenario.baseURL,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    })
    await context.addInitScript(([key, label, serializedIdentity]) => {
      if (label === 'corrupt') localStorage.setItem(key, '{')
      else if (label === 'outdated') localStorage.setItem(key, JSON.stringify({ version: 2 }))
      else if (label === 'unavailable') {
        const original = Storage.prototype.getItem
        Storage.prototype.getItem = function getItem(storageKey: string) {
          if (storageKey === key) throw new DOMException('Identity storage unavailable.', 'SecurityError')
          return original.call(this, storageKey)
        }
      } else {
        localStorage.setItem(key, serializedIdentity)
      }
    }, [STORAGE_KEY, scenario.label, storedIdentity()])
    const scenarioPage = await context.newPage()
    let submissionCalls = 0
    let claimCalls = 0
    await scenarioPage.route('**/api/v1/draft-ticket', (route) => route.fulfill({
      json: ticketResponse(),
    }))
    await scenarioPage.route('**/api/v1/submit-draft', (route) => {
      submissionCalls += 1
      return route.fulfill({ status: 201, json: submissionResponse() })
    })
    await scenarioPage.route('**/api/v1/leaderboard-identity-claim', (route) => {
      claimCalls += 1
      return route.fulfill({ status: 201, json: submissionResponse() })
    })
    if (scenario.rejectStatus) {
      await scenarioPage.route('**/api/v1/leaderboard-identity-status', (route) => route.fulfill({
        status: 401,
        json: {
          ok: false,
          error: { code: 'identity_credential_invalid', message: 'invalid' },
        },
      }))
    }
    await scenarioPage.goto('/')
    await scenarioPage.getByRole('button', { name: 'Play Classic' }).click()
    await completeClassicDraft(scenarioPage)
    await expect(scenarioPage.getByRole('heading', {
      name: 'Your local result is still safe',
    })).toBeVisible()
    await expect(scenarioPage.getByText(scenario.expected, { exact: false })).toBeVisible()
    expect(submissionCalls, scenario.label).toBe(0)
    expect(claimCalls, scenario.label).toBe(0)
    await expect(scenarioPage.getByRole('heading', {
      name: 'Claim your place on the board',
    })).toHaveCount(0)
    await expect(scenarioPage.getByRole('button', {
      name: 'Remove Saved Identity from This Device',
    })).toHaveCount(0)
    await context.close()
  }
})

test('@ci @release ticket acquisition succeeds once and fails into an honest local draft', async ({ page }) => {
  let ticketCalls = 0
  await page.route('**/api/v1/draft-ticket', async (route) => {
    ticketCalls += 1
    await route.fulfill({ json: ticketResponse() })
  })
  await page.goto('http://127.0.0.1:4176/draft')
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()
  await expect(page.getByText('Public submission is off. This draft will stay on this device.')).toBeVisible()
  expect(ticketCalls).toBe(0)

  await page.goto('/draft')
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()
  expect(ticketCalls).toBe(1)
  expect(page.url()).not.toContain('TTTT')

  await page.unroute('**/api/v1/draft-ticket')
  await page.route('**/api/v1/draft-ticket', (route) => route.fulfill({
    status: 503,
    json: { ok: false, error: { code: 'draft_ticket_unavailable', message: 'unavailable' } },
  }))
  await page.reload()
  await expect(page.getByText('The leaderboard service is temporarily unavailable. Try again when you are ready.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()

  await page.unroute('**/api/v1/draft-ticket')
  await page.route('**/api/v1/draft-ticket', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    await route.fulfill({ json: ticketResponse() }).catch(() => undefined)
  })
  await page.reload()
  await expect(page.getByText('The ticket service took too long to respond. This draft will stay on this device.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()
  await expect(page.getByPlaceholder('Search players')).toBeEnabled()
})

test('@release an accepted submission with a lost response uses one exact retry, then claims identity and removes the one-time code', async ({ page }) => {
  const consoleText: string[] = []
  const requestUrls: string[] = []
  page.on('console', (message) => consoleText.push(message.text()))
  page.on('request', (request) => requestUrls.push(request.url()))

  await page.route('**/api/v1/draft-ticket', (route) => route.fulfill({ json: ticketResponse() }))
  const submissionDigests: string[] = []
  const safeSubmissionArtifacts: unknown[] = []
  const acceptedReceipt = Object.freeze(submissionResponse())
  let acceptedDigest: string | null = null
  let submissions = 0
  await page.route('**/api/v1/submit-draft', async (route) => {
    submissions += 1
    const body = route.request().postData() ?? ''
    const digest = createHash('sha256').update(body).digest('hex')
    submissionDigests.push(digest)
    safeSubmissionArtifacts.push(privacySafeArtifact(JSON.parse(body) as unknown))
    if (submissions === 1) {
      acceptedDigest = digest
      await route.abort('connectionreset')
      return
    }
    expect(digest).toBe(acceptedDigest)
    await route.fulfill({ status: 200, json: acceptedReceipt })
  })
  let availabilityCalls = 0
  await page.route('**/api/v1/leaderboard-name-availability', async (route) => {
    availabilityCalls += 1
    const body = route.request().postDataJSON() as { displayName: string }
    await route.fulfill({
      json: {
        ok: true,
        schemaVersion: 'pennant-leaderboard-identity-v1',
        displayName: body.displayName,
        available: availabilityCalls > 1,
      },
    })
  })
  let claimCalls = 0
  await page.route('**/api/v1/leaderboard-identity-claim', async (route) => {
    claimCalls += 1
    const body = route.request().postDataJSON() as Record<string, unknown>
    expect({
      keys: Object.keys(body).sort(),
      capabilityMatches: typeof body.claimCapability === 'string'
        && protectedDigest(body.claimCapability) === protectedDigest(CLAIM_CAPABILITY),
      displayName: body.displayName,
    }).toEqual({
      keys: ['claimCapability', 'displayName'],
      capabilityMatches: true,
      displayName: 'Player Cedar',
    })
    await route.fulfill({
      status: 201,
      json: {
        ok: true,
        schemaVersion: 'pennant-leaderboard-identity-v1',
        identity: {
          displayName: 'Player Cedar',
          deviceCredential: DEVICE_CREDENTIAL,
          recoveryCode: RECOVERY_CODE,
          recoveryCodeMustBeStored: true,
          recoveryVersion: 1,
        },
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Play Classic' }).click()
  await completeClassicDraft(page)
  await expect(page.getByText('Your local result is still safe')).toBeVisible()
  await page.getByRole('button', { name: 'Try Submission Again' }).click()
  await expect(page.getByText('Submission already confirmed')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Claim your place on the board' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again' })).toHaveCount(0)
  expect(submissions).toBe(2)
  expect(submissionDigests[1]).toBe(submissionDigests[0])
  const safeArtifacts = JSON.stringify(safeSubmissionArtifacts)
  expect(safeArtifacts).toContain('"ticket":"[REDACTED]"')
  expect(safeArtifacts).toContain('"transcript":"[REDACTED]"')
  expect(safeArtifacts).toContain('"identityCredential":"[REDACTED]"')
  expect(safeArtifacts).not.toContain('TTTT')
  expect(safeArtifacts).not.toContain('seeded-v1:')
  expect(safeArtifacts).not.toContain('ppd1_')

  const name = page.getByLabel('Display name')
  await name.fill('Taken Name')
  await page.getByRole('button', { name: 'Claim Display Name' }).click()
  await expect(page.getByText('That display name is already in use. Try another.')).toBeVisible()
  await name.fill('Player Cedar')
  const claimButton = page.getByRole('button', { name: 'Claim Display Name' })
  await claimButton.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(page.getByRole('heading', { name: 'Save this code before continuing' })).toBeVisible()
  expect(claimCalls).toBe(1)
  const oneTimeCode = page.getByLabel('One-time recovery code')
  await expectProtectedCode(oneTimeCode, RECOVERY_CODE)

  const storageWhileBlocking = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
  expect(storedIdentityObservation(
    storageWhileBlocking,
    DEVICE_CREDENTIAL,
    [RECOVERY_CODE],
  )).toEqual({
    present: true,
    validJsonRecord: true,
    expectedCredential: true,
    containsProtectedRecoveryMaterial: false,
  })

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.goBack()
  await expect(page).toHaveURL(/\/draft$/)
  await expectProtectedCode(oneTimeCode, RECOVERY_CODE)
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    return window.dispatchEvent(event)
  })).toBe(false)

  await page.getByLabel('I saved this recovery code somewhere private.').check()
  await page.getByRole('button', { name: 'Finish Identity Setup' }).click()
  await expect(oneTimeCode).toHaveCount(0)
  await expect(page.getByText('Your place is official')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible()
  expect(await page.evaluate(() => document.body.textContent?.includes('ppd1_'))).toBe(false)
  expect(containsProtectedValue(requestUrls.join('\n'), [
    DEVICE_CREDENTIAL,
    RECOVERY_CODE,
    'T'.repeat(32),
  ])).toBe(false)
  expect(containsProtectedValue(consoleText.join('\n'), [
    DEVICE_CREDENTIAL,
    RECOVERY_CODE,
  ])).toBe(false)
})

test('conflicting exact submission retry remains local and cannot double-submit', async ({ page }) => {
  await page.route('**/api/v1/draft-ticket', (route) => route.fulfill({ json: ticketResponse() }))
  let submissions = 0
  await page.route('**/api/v1/submit-draft', async (route) => {
    submissions += 1
    await route.fulfill(submissions === 1
      ? {
        status: 503,
        json: { ok: false, error: { code: 'submission_unavailable', message: 'unavailable' } },
      }
      : {
        status: 409,
        json: { ok: false, error: { code: 'draft_ticket_already_consumed', message: 'conflict' } },
      })
  })
  await page.goto('/draft')
  await completeClassicDraft(page)
  const retry = page.getByRole('button', { name: 'Try Submission Again' })
  await retry.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(page.getByText('This draft ticket was already used for a different result.')).toBeVisible()
  await expect(page.getByText('Your local result is still safe')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try Submission Again' })).toHaveCount(0)
  expect(submissions).toBe(2)
})

test('submission offline, timeout, and rate-limit failures restore result controls without automatic mutation retries', async ({ page, context }) => {
  test.setTimeout(150_000)
  await page.route('**/api/v1/draft-ticket', (route) => route.fulfill({ json: ticketResponse() }))
  let mode: 'offline' | 'timeout' | 'rate-limit' = 'offline'
  const attempts = { offline: 0, timeout: 0, 'rate-limit': 0 }
  await page.route('**/api/v1/submit-draft', async (route) => {
    const requestMode = mode
    attempts[requestMode] += 1
    if (requestMode === 'offline') {
      await route.abort('internetdisconnected')
      return
    }
    if (requestMode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 12_000))
      await route.fulfill({ status: 201, json: submissionResponse({ state: 'not-required' }) })
        .catch(() => undefined)
      return
    }
    if (requestMode === 'rate-limit') {
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '10' },
        json: { ok: false, error: { code: 'rate_limited', message: 'limited' } },
      })
    }
  })

  await page.goto('/draft')
  await completeClassicDraft(page, async () => context.setOffline(true))
  await expect(page.getByText('You appear to be offline. Reconnect and try again.')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: 'Try Submission Again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible()

  mode = 'timeout'
  await page.getByRole('button', { name: 'Play Again' }).click()
  await completeClassicDraft(page)
  await expect(page.getByText(
    'The result check took too long. Your local result is safe; try submission again when you are ready.',
  )).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Try Submission Again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible()

  mode = 'rate-limit'
  await page.getByRole('button', { name: 'Play Again' }).click()
  await completeClassicDraft(page)
  await expect(page.getByText('Too many requests were made. Wait a moment, then try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try Submission Again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible()
  expect(attempts.timeout).toBe(1)
  expect(attempts['rate-limit']).toBe(1)
})

test('identity storage readback failure keeps one-time recovery material visible and reports the device as unready', async ({ page }) => {
  await page.addInitScript((identityKey) => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function safeTestSetItem(key: string, value: string) {
      if (key === identityKey) return
      setItem.call(this, key, value)
    }
  }, STORAGE_KEY)
  await installSuccessfulClaimFlow(page)

  await page.goto('/draft')
  await completeClassicDraft(page)
  await page.getByLabel('Display name').fill('Player Cedar')
  await page.getByRole('button', { name: 'Claim Display Name' }).click()
  await expect(page.getByRole('heading', { name: 'Save this code before continuing' })).toBeVisible()
  await expect(page.getByText('This browser could not retain the device identity. Keep the recovery code safe so you can recover later.')).toBeVisible()
  await expectProtectedCode(page.getByLabel('One-time recovery code'), RECOVERY_CODE)
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull()
})

test('identity storage write exception preserves one-time recovery and restores usable controls without a partial record', async ({ page }) => {
  await page.addInitScript((identityKey) => {
    const original = Storage.prototype.setItem
    const restoreKey = '__restorePennantIdentityStorageWrite'
    Object.defineProperty(window, restoreKey, {
      configurable: true,
      value: () => {
        Storage.prototype.setItem = original
        Reflect.deleteProperty(window, restoreKey)
      },
    })
    Storage.prototype.setItem = function safeTestSetItem(key: string, value: string) {
      if (key === identityKey) throw new DOMException('Local identity storage is unavailable.', 'QuotaExceededError')
      original.call(this, key, value)
    }
  }, STORAGE_KEY)
  await installSuccessfulClaimFlow(page)

  await page.goto('/draft')
  await completeClassicDraft(page)
  await page.getByLabel('Display name').fill('Player Cedar')
  await page.getByRole('button', { name: 'Claim Display Name' }).click()
  await expect(page.getByRole('heading', { name: 'Save this code before continuing' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('could not retain the device identity')
  const oneTimeCode = page.getByLabel('One-time recovery code')
  await expectProtectedCode(oneTimeCode, RECOVERY_CODE)
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull()
  await expect(page.getByRole('button', { name: 'Copy Recovery Code' })).toBeEnabled()
  await page.getByLabel('I saved this recovery code somewhere private.').check()
  await page.getByRole('button', { name: 'Finish Identity Setup' }).click()
  await expect(oneTimeCode).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible()

  const cleanup = await page.evaluate(([identityKey, ordinaryKey]) => {
    const restore = (window as unknown as Record<string, unknown>).__restorePennantIdentityStorageWrite
    if (typeof restore !== 'function') return { restored: false, ordinaryStorageWorks: false, identityMissing: false }
    restore()
    localStorage.setItem(ordinaryKey, 'ok')
    const ordinaryStorageWorks = localStorage.getItem(ordinaryKey) === 'ok'
    localStorage.removeItem(ordinaryKey)
    return {
      restored: true,
      ordinaryStorageWorks,
      identityMissing: localStorage.getItem(identityKey) === null,
    }
  }, [STORAGE_KEY, 'pennant-pursuit:ordinary-storage-probe'])
  expect(cleanup).toEqual({
    restored: true,
    ordinaryStorageWorks: true,
    identityMissing: true,
  })
})
