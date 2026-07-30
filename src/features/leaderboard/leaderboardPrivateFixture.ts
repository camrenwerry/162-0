import { validateDisplayName } from '../../../shared/leaderboard-display-name'
import type {
  LocalIdentityPreviewState,
  LocalIdentityStorage,
  LocalIdentityWriteResult,
} from './leaderboardFixtures'

const LOCAL_IDENTITY_STORAGE_KEY = 'pennant-pursuit:leaderboard-preview-identity:v1'
const LOCAL_IDENTITY_VERSION = 1

// This deterministic development-only value exercises the private-code UI.
// It is never stored, placed in a URL, or connected to a recovery service.
export const PRIVATE_DEVELOPMENT_RECOVERY_CODE = 'PP1-7H2K-9M4Q-T6RX-3W8D-F5JC-NP7A-2QR5'

export function readLocalDevelopmentIdentity(
  storage: Pick<LocalIdentityStorage, 'getItem'>,
): LocalIdentityPreviewState {
  let serialized: string | null
  try {
    serialized = storage.getItem(LOCAL_IDENTITY_STORAGE_KEY)
  } catch {
    return Object.freeze({ kind: 'unavailable' })
  }
  if (serialized === null) return Object.freeze({ kind: 'missing' })

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return Object.freeze({ kind: 'corrupt' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ kind: 'corrupt' })
  }
  const record = value as Record<string, unknown>
  if (record.version !== LOCAL_IDENTITY_VERSION) {
    return Object.freeze({ kind: 'outdated' })
  }
  const validated = validateDisplayName(record.displayName)
  if (!validated) return Object.freeze({ kind: 'invalid' })
  return Object.freeze({ kind: 'ready', displayName: validated.displayName })
}

export function storeLocalDevelopmentIdentity(
  displayName: string,
  storage: Pick<LocalIdentityStorage, 'setItem'>,
): LocalIdentityWriteResult {
  const validated = validateDisplayName(displayName)
  if (!validated) return Object.freeze({ kind: 'invalid' })
  try {
    storage.setItem(LOCAL_IDENTITY_STORAGE_KEY, JSON.stringify({
      version: LOCAL_IDENTITY_VERSION,
      displayName: validated.displayName,
    }))
  } catch {
    return Object.freeze({ kind: 'unavailable' })
  }
  return Object.freeze({ kind: 'stored', displayName: validated.displayName })
}
