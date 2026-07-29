const AUTHORIZATION_PATTERN = /\b(?:authorization|bearer)\b[^\r\n]*/gi
export const DEDICATED_PREVIEW_CREDENTIAL = 'PENNANT_PREVIEW_API_TOKEN'
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
    .replace(AUTHORIZATION_PATTERN, '[REDACTED AUTHORIZATION]')
    .replace(TOKEN_ASSIGNMENT_PATTERN, 'PENNANT_PREVIEW_API_TOKEN=[REDACTED]')
}

export function safeErrorMessage(error, sensitiveValues = []) {
  return redactText(error instanceof Error ? error.message : 'Unknown error.', sensitiveValues)
}
