import { refusalError } from './errors.mjs'
import { canonicalJson, immutablePlain } from './canonical.mjs'

export function sortedBindings(bindings) {
  return [...immutablePlain(bindings)].sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
}

export function expectedPagesBindings(preview, submissionMode) {
  return sortedBindings([
    { name: preview.d1.binding, type: 'd1', id: preview.d1.id },
    { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: submissionMode },
    { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
    { name: preview.worker.serviceBinding.binding, type: 'service', service: preview.worker.serviceBinding.service, environment: '' },
  ])
}

export function expectedWorkerBindings(preview, submissionMode) {
  return sortedBindings([
    { name: preview.d1.binding, type: 'd1', id: preview.d1.id },
    { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: submissionMode },
    { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
    { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
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
