import { APP_VERSION } from '../config/beta'
import type { DraftResult } from '../types/draft'

export interface FeedbackContext {
  screen: string
  round?: number
  team?: string
  decade?: string
  projectedRecord?: string
}

export function buildFeedbackUrl(baseUrl: string, context: FeedbackContext) {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('appVersion', APP_VERSION)
    url.searchParams.set('currentScreen', context.screen)
    if (context.round !== undefined) url.searchParams.set('round', String(context.round))
    if (context.team) url.searchParams.set('team', context.team)
    if (context.decade) url.searchParams.set('decade', context.decade)
    if (context.projectedRecord) url.searchParams.set('projectedRecord', context.projectedRecord)
    return url.toString()
  } catch { return null }
}

export function getFeedbackUrl(context: FeedbackContext) {
  const configuredUrl = import.meta.env.VITE_FEEDBACK_URL?.trim()
  return configuredUrl ? buildFeedbackUrl(configuredUrl, context) : null
}

export function buildShareText(result: DraftResult) {
  return `Diamond Draft\nProjected Record: ${result.wins}–${result.losses}\nOverall Grade: ${result.overallGrade}\nCan you build a better team?`
}

interface ShareDependencies {
  share?: (data: ShareData) => Promise<void>
  writeText?: (text: string) => Promise<void>
  publicUrl?: string
}

export async function shareResult(result: DraftResult, dependencies: ShareDependencies = {}): Promise<'shared' | 'copied'> {
  const text = buildShareText(result)
  const share = dependencies.share ?? navigator.share?.bind(navigator)
  const publicUrl = dependencies.publicUrl ?? window.location.origin
  if (share) {
    await share({ title: 'Diamond Draft result', text, url: publicUrl })
    return 'shared'
  }
  const writeText = dependencies.writeText ?? navigator.clipboard?.writeText.bind(navigator.clipboard)
  if (!writeText) throw new Error('Clipboard unavailable')
  await writeText(`${text}\n${publicUrl}`)
  return 'copied'
}
