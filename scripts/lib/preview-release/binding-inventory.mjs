import { refusalError } from './errors.mjs'
import { canonicalJson, immutablePlain } from './canonical.mjs'

export const PROTECTED_CAPABILITY_MODE_BINDINGS = Object.freeze([
  'DRAFT_SUBMISSION_MODE',
  'LEADERBOARD_IDENTITY_CLAIM_MODE',
  'LEADERBOARD_IDENTITY_MODE',
  'LEADERBOARD_IDENTITY_RENAME_MODE',
  'LEADERBOARD_IDENTITY_STATUS_MODE',
  'LEADERBOARD_READ_MODE',
  'LEADERBOARD_RECOVERY_MODE',
  'RETENTION_CLEANUP_MODE',
])

export const PROTECTED_PLAIN_TEXT_BINDINGS = Object.freeze([
  ...PROTECTED_CAPABILITY_MODE_BINDINGS,
  'DRAFT_TICKET_MODE',
  'DRAFT_VALIDATION_MODE',
  'LEADERBOARD_ENVIRONMENT',
])

export function sortedBindings(bindings) {
  return [...immutablePlain(bindings)].sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
}

function disabledModeBinding(name) {
  return { name, type: 'plain_text', text: 'disabled' }
}

function assertDisabledOnly(submissionMode) {
  if (submissionMode !== undefined && submissionMode !== 'disabled') {
    throw refusalError('Legacy release binding inventory is disabled-only until capability-aware release tooling is reviewed.', 'remote.binding-inventory')
  }
}

export function expectedPagesBindings(preview, submissionMode = 'disabled') {
  assertDisabledOnly(submissionMode)
  return sortedBindings([
    { name: preview.d1.binding, type: 'd1', id: preview.d1.id },
    { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'LEADERBOARD_ENVIRONMENT', type: 'plain_text', text: 'preview' },
    disabledModeBinding('LEADERBOARD_READ_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_CLAIM_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_STATUS_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_RENAME_MODE'),
    disabledModeBinding('DRAFT_SUBMISSION_MODE'),
    disabledModeBinding('LEADERBOARD_RECOVERY_MODE'),
    { name: preview.worker.serviceBinding.binding, type: 'service', service: preview.worker.serviceBinding.service, environment: '' },
  ])
}

export function expectedWorkerBindings(preview, submissionMode = 'disabled') {
  assertDisabledOnly(submissionMode)
  return sortedBindings([
    { name: preview.d1.binding, type: 'd1', id: preview.d1.id },
    { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
    disabledModeBinding('LEADERBOARD_IDENTITY_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_CLAIM_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_STATUS_MODE'),
    disabledModeBinding('LEADERBOARD_IDENTITY_RENAME_MODE'),
    disabledModeBinding('DRAFT_SUBMISSION_MODE'),
    disabledModeBinding('LEADERBOARD_RECOVERY_MODE'),
    disabledModeBinding('RETENTION_CLEANUP_MODE'),
    { name: 'RATE_LIMIT_BURST', type: 'ratelimit', namespaceId: preview.worker.rateLimitNamespaces[0] },
    { name: 'RATE_LIMIT_SUSTAINED', type: 'ratelimit', namespaceId: preview.worker.rateLimitNamespaces[1] },
  ])
}

export function assertExactBindings(actual, expected, label) {
  if (!Array.isArray(actual) || canonicalJson(actual) !== canonicalJson(expected)) {
    throw refusalError(`${label} binding inventory differs from the complete immutable Preview inventory.`, 'remote.binding-inventory')
  }
  return actual
}
