import { APP_VERSION } from '../config/app'
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
  const strongestCategory = result.strongestCategory
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase())
  return `Pennant Pursuit\nProjected Record: ${result.wins}–${result.losses}\nOverall Grade: ${result.overallGrade}\nTier: ${result.tierLabel}\nStrongest Category: ${strongestCategory}\n\nBuild the greatest roster in baseball history.`
}

export function buildCompleteShareText(result: DraftResult, publicUrl = window.location.origin) {
  return `${buildShareText(result)}\n\n${publicUrl}`
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
    await share({ title: 'Pennant Pursuit', text, url: publicUrl })
    return 'shared'
  }
  const writeText = dependencies.writeText ?? navigator.clipboard?.writeText.bind(navigator.clipboard)
  if (!writeText) throw new Error('Clipboard unavailable')
  await writeText(buildCompleteShareText(result, publicUrl))
  return 'copied'
}
