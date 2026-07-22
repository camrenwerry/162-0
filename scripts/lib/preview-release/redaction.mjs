const AUTHORIZATION_PATTERN = /\b(?:authorization|bearer)\b[^\r\n]*/gi
const TOKEN_ASSIGNMENT_PATTERN = /\b(?:PENNANT_PREVIEW_API_TOKEN|CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CLOUDFLARE_EMAIL|CF_API_TOKEN|CF_API_KEY|WRANGLER_OAUTH_TOKEN)\s*[=:]\s*[^\s,;]+/gi

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
