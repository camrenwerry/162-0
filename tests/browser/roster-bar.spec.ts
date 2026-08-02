import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './helpers'

const DISABLED_DRAFT = 'http://127.0.0.1:4176/draft'

type ScrollCall = {
  afterDocumentScroll?: number
  beforeDocumentScroll: number
  behavior: ScrollBehavior | undefined
  left: number | undefined
}

declare global {
  interface Window {
    __rosterScrollCalls: ScrollCall[]
  }
}

async function installRosterScrollObserver(page: Page) {
  await page.addInitScript(() => {
    window.__rosterScrollCalls = []
    const nativeScrollTo = Element.prototype.scrollTo
    Element.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) {
      if (this instanceof HTMLElement && this.classList.contains('roster-bar__slots')) {
        const normalized = typeof options === 'number' ? { left: options, top: y } : options
        const call: ScrollCall = {
          beforeDocumentScroll: window.scrollY,
          behavior: normalized?.behavior,
          left: normalized?.left,
        }
        window.__rosterScrollCalls.push(call)
        requestAnimationFrame(() => { call.afterDocumentScroll = window.scrollY })
      }
      if (typeof options === 'number') nativeScrollTo.call(this, options, y ?? 0)
      else nativeScrollTo.call(this, options)
    }
  })
}

async function selectPosition(page: Page, position: 'C' | 'SP' | 'RP', expectedSlot: string) {
  const filter = page.locator('.position-filters').getByRole('button', { name: position, exact: true })
  await expect(filter).toBeEnabled()
  await filter.click()
  const card = page.locator('.player-card:enabled').first()
  await expect(card).toBeVisible()
  await card.click()

  const picker = page.getByRole('dialog', { name: 'Choose a Position' })
  await expect(picker).toBeVisible()
  const playerName = (await picker.locator('.position-picker__heading > span').textContent())?.trim()
  expect(playerName).toBeTruthy()
  await picker.locator('.position-picker__options').getByRole('button', { name: `${position} Available` }).click()
  await picker.getByRole('button', { name: 'Add to roster' }).click()
  await expect(picker).toBeHidden()
  await expect(page.locator(`.roster-bar__slots [aria-label="${expectedSlot}, ${playerName}"]`)).toBeAttached()
  await expect(page.getByRole('heading', { name: 'Make your pick' })).toBeVisible()

  return { playerName: playerName as string }
}

async function expectCompactSlotVisible(page: Page, slot: string) {
  await expect.poll(() => page.evaluate((slotId) => {
    const container = document.querySelector<HTMLElement>('.roster-bar__slots')
    const item = container?.querySelector<HTMLElement>(`[aria-label^="${slotId},"]`)
    if (!container || !item) return false
    const containerRect = container.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    return itemRect.left >= containerRect.left - 1 && itemRect.right <= containerRect.right + 1
  }, slot)).toBe(true)
}

async function expectLastFollowPreservedDocumentScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const call = window.__rosterScrollCalls.at(-1)
    return call?.afterDocumentScroll === call?.beforeDocumentScroll
  })).toBe(true)
}

test('@ci @release mobile roster disclosure is accessible, bounded, and overflow-safe at locked viewports', async ({ page }) => {
  const protectedRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) protectedRequests.push(request.url())
  })

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto(DISABLED_DRAFT)
    await expect(page.getByText('Public submission is off. This draft will stay on this device.')).toBeVisible()
    const disclosure = page.getByRole('button', { name: 'View full roster' })
    await expect(disclosure).toBeVisible()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    const controlledId = await disclosure.getAttribute('aria-controls')
    expect(controlledId).toBeTruthy()
    const controlledOverview = page.locator(`[id="${controlledId}"]`)
    await expect(controlledOverview).toBeHidden()
    const disclosureBox = await disclosure.boundingBox()
    expect(disclosureBox?.height).toBeGreaterThanOrEqual(44)

    await disclosure.focus()
    await expect(disclosure).toBeFocused()
    expect(await disclosure.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none')
    await disclosure.click()
    const collapseDisclosure = page.getByRole('button', { name: 'Hide full roster' })
    await expect(collapseDisclosure).toBeFocused()
    await expect(collapseDisclosure).toHaveAttribute('aria-expanded', 'true')
    const overview = controlledOverview
    await expect(overview.getByRole('listitem')).toHaveCount(14)
    await expect(overview.getByRole('listitem', { name: 'RP2, open slot' })).toBeAttached()
    expect(await overview.getAttribute('role')).toBeNull()
    await overview.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(overview.getByRole('listitem', { name: 'RP2, open slot' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await collapseDisclosure.press('Escape')
    const reopenedDisclosure = page.getByRole('button', { name: 'View full roster' })
    await expect(reopenedDisclosure).toHaveAttribute('aria-expanded', 'false')
    await expect(reopenedDisclosure).toBeFocused()
    await expect(page.locator('.roster-bar__slots')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  }

  expect(protectedRequests).toEqual([])
  await expect(page.getByRole('heading', { name: 'Claim your place on the board' })).toHaveCount(0)
  await expect(page.getByText('Recover an identity')).toHaveCount(0)
})

test('@ci @release newly filled mobile slots follow once, preserve vertical scroll, and announce exactly once', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await installRosterScrollObserver(page)
  await page.goto(DISABLED_DRAFT)

  const liveRegion = page.locator('.roster-bar__announcement[aria-live="polite"][aria-atomic="true"]')
  await expect(liveRegion).toHaveCount(1)
  await expect(liveRegion).toHaveText('')

  const earlyPick = await selectPosition(page, 'C', 'C')
  await expect(liveRegion).toHaveText(`${earlyPick.playerName} added to C. 1 of 14 positions filled.`)
  expect(await page.evaluate(() => window.__rosterScrollCalls)).toEqual([])

  const sp1 = await selectPosition(page, 'SP', 'SP1')
  await expect(liveRegion).toHaveText(`${sp1.playerName} added to SP1. 2 of 14 positions filled.`)
  await expectCompactSlotVisible(page, 'SP1')
  expect((await page.evaluate(() => window.__rosterScrollCalls)).at(-1)?.behavior).toBe('smooth')
  await expectLastFollowPreservedDocumentScroll(page)

  const callsAfterSp1 = await page.evaluate(() => window.__rosterScrollCalls.length)
  await page.locator('.position-filters').getByRole('button', { name: 'ALL', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__rosterScrollCalls.length)).toBe(callsAfterSp1)
  await expect(liveRegion).toHaveText(`${sp1.playerName} added to SP1. 2 of 14 positions filled.`)

  const disclosure = page.getByRole('button', { name: 'View full roster' })
  await disclosure.click()
  const callsBeforeExpandedPick = await page.evaluate(() => window.__rosterScrollCalls.length)
  const sp2 = await selectPosition(page, 'SP', 'SP2')
  await expect(liveRegion).toHaveText(`${sp2.playerName} added to SP2. 3 of 14 positions filled.`)
  expect(await page.evaluate(() => window.__rosterScrollCalls.length)).toBe(callsBeforeExpandedPick)
  await page.getByRole('button', { name: 'Hide full roster' }).click()

  await selectPosition(page, 'SP', 'SP3')
  await expectCompactSlotVisible(page, 'SP3')
  expect((await page.evaluate(() => window.__rosterScrollCalls)).at(-1)?.behavior).toBe('smooth')
  await expectLastFollowPreservedDocumentScroll(page)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await selectPosition(page, 'RP', 'RP1')
  await expectCompactSlotVisible(page, 'RP1')
  expect((await page.evaluate(() => window.__rosterScrollCalls)).at(-1)?.behavior).toBe('auto')
  await expectLastFollowPreservedDocumentScroll(page)

  const rp2 = await selectPosition(page, 'RP', 'RP2')
  await expectCompactSlotVisible(page, 'RP2')
  expect((await page.evaluate(() => window.__rosterScrollCalls)).at(-1)?.behavior).toBe('auto')
  await expectLastFollowPreservedDocumentScroll(page)
  await expect(liveRegion).toHaveText(`${rp2.playerName} added to RP2. 6 of 14 positions filled.`)
  await expectNoHorizontalOverflow(page)
})

test('@ci @release desktop roster remains the existing sidebar without a mobile disclosure', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(DISABLED_DRAFT)
  await expect(page.getByRole('button', { name: 'View full roster' })).toBeHidden()
  await expect(page.locator('.roster-bar')).toBeVisible()
  await expect(page.locator('.roster-bar__slots').getByRole('listitem')).toHaveCount(14)
  expect(await page.locator('.roster-bar').evaluate((element) => getComputedStyle(element).position)).toBe('sticky')
  expect(await page.locator('.draft-workspace').evaluate((element) => getComputedStyle(element).gridTemplateColumns)).not.toBe('none')
  await expectNoHorizontalOverflow(page)
})
