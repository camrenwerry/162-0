import { createHash } from 'node:crypto'
import { expect, type Locator, type Page } from '@playwright/test'

export const STORAGE_KEY = 'pennant-pursuit:leaderboard-identity:v1'
export const DEVICE_CREDENTIAL = `ppd1_${'A'.repeat(43)}`
export const REPLACEMENT_CREDENTIAL = `ppd1_${'B'.repeat(43)}`
export const CLAIM_CAPABILITY = `ppc1_${'C'.repeat(43)}`
export const RECOVERY_CODE = ['PP1', '2345', '6789', 'ABCD', 'EFGH', 'JKMP', 'QRST', 'VWXY'].join('-')
export const REPLACEMENT_RECOVERY_CODE = ['PP1', '3456', '789A', 'BCDE', 'FGHJ', 'KMPQ', 'RSTV', 'WXYZ'].join('-')

const RECOVERY_CODE_PATTERN = /^PP1(?:-[A-Z0-9]{4}){7}$/

export function protectedDigest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function containsProtectedValue(text: string, protectedValues: readonly string[]) {
  return protectedValues.some((value) => text.includes(value))
}

export async function expectProtectedCode(
  locator: Locator,
  expectedValue: string,
) {
  const value = await locator.textContent()
  const observation = {
    present: value !== null,
    visible: await locator.isVisible(),
    validShape: RECOVERY_CODE_PATTERN.test(value ?? ''),
    expectedLength: value?.length === expectedValue.length,
    expectedDigest: protectedDigest(value ?? '') === protectedDigest(expectedValue),
  }
  expect(observation).toEqual({
    present: true,
    visible: true,
    validShape: true,
    expectedLength: true,
    expectedDigest: true,
  })
}

export async function fillProtectedInput(
  page: Page,
  label: string,
  protectedValue: string,
) {
  await page.getByLabel(label).evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Protected input is unavailable.')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, protectedValue)
}

export function storedIdentityObservation(
  serialized: string | null,
  expectedCredential: string,
  protectedValues: readonly string[],
) {
  let parsed: unknown
  try {
    parsed = serialized === null ? null : JSON.parse(serialized)
  } catch {
    parsed = null
  }
  const record = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
  return {
    present: serialized !== null,
    validJsonRecord: record !== null,
    expectedCredential: typeof record?.deviceCredential === 'string'
      && protectedDigest(record.deviceCredential) === protectedDigest(expectedCredential),
    containsProtectedRecoveryMaterial: serialized !== null
      && containsProtectedValue(serialized, protectedValues),
  }
}

export function ticketResponse() {
  const issuedAt = Date.now()
  return {
    ok: true,
    ticket: {
      value: 'T'.repeat(32),
      ticketId: '12345678-1234-4123-8123-123456789abc',
      draftSeed: `seeded-v1:${'a'.repeat(32)}`,
      issuedAt,
      expiresAt: issuedAt + 900_000,
      gameMode: 'classic',
    },
  }
}

const placement = {
  qualifies: true,
  rank: 4,
  displacedPriorEntry: false,
  cutoff: { projectedWins: 90, overallScore: 72.5 },
  proximity: null,
}

export function submissionResponse(
  claim: Record<string, unknown> = {
    state: 'available',
    capability: CLAIM_CAPABILITY,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
) {
  const timestamp = new Date().toISOString()
  return {
    ok: true,
    verified: true,
    submitted: true,
    submissionSchema: 'pennant-draft-submission-v1',
    submittedAt: timestamp,
    result: {
      projectedWins: 101,
      projectedLosses: 61,
      overallScore: 81.2,
      overallGrade: 'A-',
      tier: 'Pennant contender',
    },
    leaderboard: {
      schemaVersion: 'pennant-leaderboard-placement-v1',
      snapshotAt: timestamp,
      periods: { daily: placement, weekly: placement, 'all-time': placement },
      newPersonalBest: true,
      identity: {
        setupRequired: claim.state === 'available',
        reason: claim.state === 'available' ? 'qualifying_run_requires_identity' : null,
      },
      capabilities: { bestRun: true, cumulativePerformance: false },
      claim,
    },
  }
}

export function identityStatus({
  credential = DEVICE_CREDENTIAL,
  displayName = 'Player Cedar',
  renameEligible = true,
}: {
  credential?: string
  displayName?: string
  renameEligible?: boolean
} = {}) {
  return {
    credential,
    response: {
      ok: true,
      schemaVersion: 'pennant-leaderboard-identity-v1',
      identity: {
        displayName,
        renameEligible,
        nextEligibleRenameAt: renameEligible ? null : new Date(Date.now() + 2_592_000_000).toISOString(),
        recoveryVersion: 1,
      },
      capabilities: {
        bestRun: true,
        cumulativePerformance: false,
        recovery: true,
        rename: true,
      },
    },
  }
}

export function storedIdentity(
  deviceCredential = DEVICE_CREDENTIAL,
  displayName = 'Player Cedar',
) {
  return JSON.stringify({
    version: 1,
    deviceCredential,
    displayName,
    recoveryVersion: 1,
    updatedAt: new Date().toISOString(),
  })
}

export function leaderboardResponse({
  period = 'daily',
  entries = [{
    rank: 1,
    playerLabel: 'Player Oak',
    projectedWins: 105,
    overallScore: 87.5,
    tier: 'Pennant favorite',
    submittedAt: new Date().toISOString(),
    mode: 'classic',
  }],
  nextCursor = null,
}: {
  period?: 'daily' | 'weekly' | 'all-time'
  entries?: Array<Record<string, unknown>>
  nextCursor?: string | null
} = {}) {
  return {
    ok: true,
    schemaVersion: 'pennant-leaderboard-response-v2',
    generatedAt: new Date().toISOString(),
    board: {
      mode: 'classic',
      period,
      rankingFamily: 'best-run',
      rankPolicy: 'competition-shared',
      ordering: [],
      periodWindow: {},
    },
    eligibility: {},
    capabilities: { bestRun: true, cumulativePerformance: false },
    entries,
    page: { limit: 25, nextCursor },
  }
}

export async function completeClassicDraft(page: Page, beforeResults?: () => Promise<void>) {
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()
  for (let round = 0; round < 14; round += 1) {
    const card = page.locator('.player-card:enabled').first()
    await expect(card).toBeVisible()
    await card.click()
    const dialog = page.getByRole('dialog', { name: 'Choose a Position' })
    await expect(dialog).toBeVisible()
    await dialog.locator('.position-picker__options button').first().click()
    await dialog.getByRole('button', { name: 'Add to roster' }).click()
    await expect(dialog).toBeHidden()
  }
  const skip = page.getByRole('button', { name: 'Skip' })
  await expect(skip).toBeVisible()
  if (await skip.isEnabled()) await skip.click()
  const results = page.getByRole('button', { name: 'View Full Results' })
  await expect(results).toBeEnabled()
  if (beforeResults) await beforeResults()
  await results.click()
  await expect(page.getByText('Season Complete')).toBeVisible()
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.body.clientWidth,
  }))).toEqual({ document: true, body: true })
}
