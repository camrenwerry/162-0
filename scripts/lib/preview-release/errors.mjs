export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  USAGE: 2,
  LOCAL_FAILURE: 10,
  REMOTE_FAILURE: 11,
  PRODUCTION_REFUSAL: 12,
})

export class PreviewWorkflowError extends Error {
  constructor(message, {
    exitCode = EXIT_CODES.LOCAL_FAILURE,
    classification = 'local_precondition',
    status = 'FAIL',
    checkId = 'workflow',
    cause,
  } = {}) {
    super(message, { cause })
    this.name = 'PreviewWorkflowError'
    this.exitCode = exitCode
    this.classification = classification
    this.status = status
    this.checkId = checkId
  }
}

export function usageError(message) {
  return new PreviewWorkflowError(message, {
    exitCode: EXIT_CODES.USAGE,
    classification: 'invalid_usage',
    checkId: 'cli.arguments',
  })
}

export function localError(message, checkId = 'local') {
  return new PreviewWorkflowError(message, { checkId })
}

export function remoteError(message, classification = 'remote_read', checkId = 'remote') {
  return new PreviewWorkflowError(message, {
    exitCode: EXIT_CODES.REMOTE_FAILURE,
    classification,
    status: classification.includes('ambiguous') ? 'AMBIGUOUS' : 'FAIL',
    checkId,
  })
}

export function refusalError(message, checkId = 'production.protection') {
  return new PreviewWorkflowError(message, {
    exitCode: EXIT_CODES.PRODUCTION_REFUSAL,
    classification: 'production_protection',
    status: 'REFUSED',
    checkId,
  })
}

export function asWorkflowError(error) {
  if (error instanceof PreviewWorkflowError) return error
  return localError(error instanceof Error ? error.message : 'Unknown Preview workflow failure.')
}
