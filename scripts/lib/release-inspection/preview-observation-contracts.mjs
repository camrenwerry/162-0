import { canonicalJson } from '../preview-release/canonical.mjs'
import {
  createAndAuthorizePreviewSingleReadSnapshot,
  PREVIEW_RESOURCE_OUTCOME_STATES as AUTHORITY_OUTCOME_STATES,
  PREVIEW_SINGLE_READ_KIND as AUTHORITY_SINGLE_READ_KIND,
  PREVIEW_SINGLE_READ_SCHEMA_VERSION as AUTHORITY_SINGLE_READ_SCHEMA_VERSION,
  validateAndAuthorizePreviewSingleReadSnapshot,
} from './preview-capability-projection-authority.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './intrinsic-integrity.mjs'
import { assertSerializedObservationBudget } from './remote-transport.mjs'

export const PREVIEW_SINGLE_READ_SCHEMA_VERSION = AUTHORITY_SINGLE_READ_SCHEMA_VERSION
export const PREVIEW_SINGLE_READ_KIND = AUTHORITY_SINGLE_READ_KIND
export const PREVIEW_RESOURCE_OUTCOME_STATES = AUTHORITY_OUTCOME_STATES

export function validatePreviewSingleReadSnapshot(input) {
  return validateAndAuthorizePreviewSingleReadSnapshot(input)
}

export function createPreviewSingleReadSnapshot(input = {}) {
  return createAndAuthorizePreviewSingleReadSnapshot(input)
}

export function renderPreviewSingleReadJson(input) {
  assertReleaseInspectionIntrinsicIntegrity()
  const serialized = `${canonicalJson(validatePreviewSingleReadSnapshot(input))}\n`
  return assertSerializedObservationBudget(serialized)
}
