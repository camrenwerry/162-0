import { validateDisplayName } from '../../../shared/leaderboard-display-name'

const IDENTITY_STORAGE_KEY = 'pennant-pursuit:leaderboard-identity:v1'
const IDENTITY_STORAGE_VERSION = 1
const DEVICE_CREDENTIAL_PATTERN = /^ppd1_[A-Za-z0-9_-]{43}$/

export interface StoredLeaderboardIdentity {
  readonly version: typeof IDENTITY_STORAGE_VERSION
  readonly deviceCredential: string
  readonly displayName: string
  readonly recoveryVersion: number
  readonly updatedAt: string
}

export type IdentityStorageReadResult =
  | Readonly<{ kind: 'ready', identity: StoredLeaderboardIdentity }>
  | Readonly<{ kind: 'missing' | 'corrupt' | 'outdated' | 'unavailable' }>

export type IdentityStorageWriteResult =
  | Readonly<{ kind: 'stored', identity: StoredLeaderboardIdentity }>
  | Readonly<{ kind: 'invalid' | 'unavailable' }>

export type IdentityStorageRemoveResult = 'removed' | 'unavailable'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'>
type RemoveStorage = Pick<Storage, 'getItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 20 || value.length > 32) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const canonical = new Date(timestamp).toISOString()
  return canonical === value ? canonical : null
}

function parseIdentity(value: unknown): StoredLeaderboardIdentity | null | 'outdated' {
  if (!isRecord(value)) return null
  if (value.version !== IDENTITY_STORAGE_VERSION) return 'outdated'
  if (!hasExactKeys(value, [
    'version',
    'deviceCredential',
    'displayName',
    'recoveryVersion',
    'updatedAt',
  ])) return null
  const validatedName = validateDisplayName(value.displayName)
  const updatedAt = canonicalTimestamp(value.updatedAt)
  if (
    !validatedName
    || typeof value.deviceCredential !== 'string'
    || !DEVICE_CREDENTIAL_PATTERN.test(value.deviceCredential)
    || typeof value.recoveryVersion !== 'number'
    || !Number.isSafeInteger(value.recoveryVersion)
    || value.recoveryVersion < 1
    || updatedAt === null
  ) return null
  return Object.freeze({
    version: IDENTITY_STORAGE_VERSION,
    deviceCredential: value.deviceCredential,
    displayName: validatedName.displayName,
    recoveryVersion: value.recoveryVersion,
    updatedAt,
  })
}

export function readStoredLeaderboardIdentity(storage: ReadStorage): IdentityStorageReadResult {
  let serialized: string | null
  try {
    serialized = storage.getItem(IDENTITY_STORAGE_KEY)
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
  const parsed = parseIdentity(value)
  if (parsed === 'outdated') return Object.freeze({ kind: 'outdated' })
  return parsed
    ? Object.freeze({ kind: 'ready', identity: parsed })
    : Object.freeze({ kind: 'corrupt' })
}

export function storeLeaderboardIdentity(
  identity: Readonly<{
    deviceCredential: unknown
    displayName: unknown
    recoveryVersion: unknown
  }>,
  storage: WriteStorage,
  now: () => Date = () => new Date(),
): IdentityStorageWriteResult {
  const validatedName = validateDisplayName(identity.displayName)
  if (
    !validatedName
    || typeof identity.deviceCredential !== 'string'
    || !DEVICE_CREDENTIAL_PATTERN.test(identity.deviceCredential)
    || typeof identity.recoveryVersion !== 'number'
    || !Number.isSafeInteger(identity.recoveryVersion)
    || identity.recoveryVersion < 1
  ) return Object.freeze({ kind: 'invalid' })
  let updatedAt: string
  try {
    updatedAt = now().toISOString()
  } catch {
    return Object.freeze({ kind: 'unavailable' })
  }
  const record: StoredLeaderboardIdentity = Object.freeze({
    version: IDENTITY_STORAGE_VERSION,
    deviceCredential: identity.deviceCredential,
    displayName: validatedName.displayName,
    recoveryVersion: identity.recoveryVersion,
    updatedAt,
  })
  try {
    storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(record))
    const confirmed = readStoredLeaderboardIdentity(storage)
    if (
      confirmed.kind !== 'ready'
      || confirmed.identity.deviceCredential !== record.deviceCredential
      || confirmed.identity.displayName !== record.displayName
      || confirmed.identity.recoveryVersion !== record.recoveryVersion
      || confirmed.identity.updatedAt !== record.updatedAt
    ) return Object.freeze({ kind: 'unavailable' })
  } catch {
    return Object.freeze({ kind: 'unavailable' })
  }
  return Object.freeze({ kind: 'stored', identity: record })
}

export function removeLeaderboardIdentity(storage: RemoveStorage): IdentityStorageRemoveResult {
  try {
    storage.removeItem(IDENTITY_STORAGE_KEY)
    return storage.getItem(IDENTITY_STORAGE_KEY) === null ? 'removed' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function identityStorageKeyForTests(): string {
  if (!import.meta.env.DEV) throw new Error('Identity storage key is available only in development.')
  return IDENTITY_STORAGE_KEY
}
