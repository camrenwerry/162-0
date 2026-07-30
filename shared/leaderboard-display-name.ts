export const DISPLAY_NAME_MIN_CHARACTERS = 3
export const DISPLAY_NAME_MAX_CHARACTERS = 20

const DISPLAY_NAME_ALLOWED_PATTERN = /^[\p{L}\p{N}_ -]+$/u
const DISPLAY_NAME_FORBIDDEN_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

export interface ValidatedDisplayName {
  readonly displayName: string
  readonly nameKey: string
}

/**
 * Public names are stored in NFKC form. Uniqueness uses deterministic
 * compatibility normalization plus Unicode default upper/lower case mapping.
 * This catches case, full-width, sharp-s, and final-sigma collisions without
 * relying on SQLite collation behavior.
 */
export function validateDisplayName(value: unknown): ValidatedDisplayName | null {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('  ')) return null
  let displayName: string
  try {
    displayName = value.normalize('NFKC')
  } catch {
    return null
  }
  const characters = [...displayName]
  if (
    characters.length < DISPLAY_NAME_MIN_CHARACTERS
    || characters.length > DISPLAY_NAME_MAX_CHARACTERS
    || displayName !== displayName.trim()
    || displayName.includes('  ')
    || DISPLAY_NAME_FORBIDDEN_PATTERN.test(displayName)
    || !DISPLAY_NAME_ALLOWED_PATTERN.test(displayName)
  ) return null
  const nameKey = displayName.toUpperCase().toLowerCase().normalize('NFKC')
  if (
    [...nameKey].length < DISPLAY_NAME_MIN_CHARACTERS
    || [...nameKey].length > 80
    || nameKey !== nameKey.trim()
  ) return null
  return Object.freeze({ displayName, nameKey })
}
