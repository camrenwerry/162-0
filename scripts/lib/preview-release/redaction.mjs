const AUTHORIZATION_PATTERN = /\b(?:authorization|bearer)\b[^\r\n]*/gi
const URL_CREDENTIAL_PATTERN = /\b(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/giu
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key)/iu
export const DEDICATED_PREVIEW_CREDENTIAL = 'PENNANT_PREVIEW_API_TOKEN'
export const DEDICATED_PREVIEW_DEPLOY_CREDENTIAL = 'PENNANT_PREVIEW_DEPLOY_API_TOKEN'
export const GENERIC_CLOUDFLARE_CREDENTIALS = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CF_API_TOKEN',
  'CF_API_KEY',
  'CF_EMAIL',
  'WRANGLER_OAUTH_TOKEN',
])
export const PROHIBITED_CREDENTIAL_ASSIGNMENT_ALIASES = Object.freeze([
  DEDICATED_PREVIEW_CREDENTIAL,
  DEDICATED_PREVIEW_DEPLOY_CREDENTIAL,
  ...GENERIC_CLOUDFLARE_CREDENTIALS,
])

const CREDENTIAL_ASSIGNMENT_SOURCE = String.raw`(?<![A-Za-z0-9_])(?:${PROHIBITED_CREDENTIAL_ASSIGNMENT_ALIASES.join('|')})[ \t]*(?:=|:)[ \t]*[^\s,;]+`
const TOKEN_ASSIGNMENT_PATTERN = new RegExp(CREDENTIAL_ASSIGNMENT_SOURCE, 'giu')

export function containsProhibitedCredentialAssignment(value) {
  return typeof value === 'string' && new RegExp(CREDENTIAL_ASSIGNMENT_SOURCE, 'iu').test(value)
}

export function redactText(value, sensitiveValues = []) {
  let text = String(value ?? '')
  for (const sensitive of sensitiveValues) {
    if (typeof sensitive === 'string' && sensitive.length > 0) text = text.split(sensitive).join('[REDACTED]')
  }
  return text
    .replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]@')
    .replace(AUTHORIZATION_PATTERN, '[REDACTED AUTHORIZATION]')
    .replace(TOKEN_ASSIGNMENT_PATTERN, 'PREVIEW_CREDENTIAL=[REDACTED]')
}

export function safeErrorMessage(error, sensitiveValues = []) {
  let message
  if (error instanceof Error) message = error.message
  else {
    try {
      message = typeof error === 'string' ? error : JSON.stringify(error)
    } catch {
      message = String(error)
    }
  }
  return redactText(message || 'Unknown error.', sensitiveValues)
}

export function redactValue(value, sensitiveValues = [], trail = '$') {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return redactText(value, sensitiveValues)
  if (Array.isArray(value)) return value.map((entry, index) => redactValue(entry, sensitiveValues, `${trail}[${index}]`))
  if (typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : redactValue(value[key], sensitiveValues, `${trail}.${key}`)
    }
    return result
  }
  return redactText(String(value), sensitiveValues)
}
