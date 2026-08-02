import type { PreviewOperationName } from './remote-transport.mjs'

export type PreviewResourceOutcomeState =
  | 'complete'
  | 'missing'
  | 'unavailable'
  | 'partial'
  | 'malformed'
  | 'contradictory'

export interface PreviewResourcePlaceholder {
  readonly kind: 'preview-resource-observation-placeholder'
  readonly schemaVersion: 1
}

interface PreviewResourceOutcomeBase {
  readonly operation: PreviewOperationName
  readonly capturedAtMs: number
}

export type PreviewResourceOutcome =
  | (PreviewResourceOutcomeBase & Readonly<{
      state: 'complete'
      issueCode: null
      value: PreviewResourcePlaceholder
    }>)
  | (PreviewResourceOutcomeBase & Readonly<{
      state: 'missing'
      issueCode: 'resource-missing'
      value: null
    }>)
  | (PreviewResourceOutcomeBase & Readonly<{
      state: 'unavailable'
      issueCode: 'resource-unavailable'
      value: null
    }>)
  | (PreviewResourceOutcomeBase & Readonly<{
      state: 'partial'
      issueCode: 'resource-partial'
      value: PreviewResourcePlaceholder
    }>)
  | (PreviewResourceOutcomeBase & Readonly<{
      state: 'malformed'
      issueCode: 'resource-malformed'
      value: null
    }>)
  | (PreviewResourceOutcomeBase & Readonly<{
      state: 'contradictory'
      issueCode: 'resource-contradictory'
      value: PreviewResourcePlaceholder
    }>)

export interface PreviewSingleReadSnapshot {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-preview-single-read-observation'
  readonly environment: 'preview'
  readonly capturedAtMs: number
  readonly observationState: PreviewResourceOutcomeState
  readonly resourceOutcomes: readonly PreviewResourceOutcome[]
  readonly freshnessStatus: 'unknown'
  readonly releaseCurrentness: 'UNKNOWN'
  readonly executionAuthorization: 'prohibited'
  readonly noRemoteMutation: true
  readonly noSecretValues: true
  readonly productionContacted: false
}

export const PREVIEW_SINGLE_READ_SCHEMA_VERSION: 1
export const PREVIEW_SINGLE_READ_KIND: 'pennant-pursuit-preview-single-read-observation'
export const PREVIEW_RESOURCE_OUTCOME_STATES: readonly PreviewResourceOutcomeState[]

export function validatePreviewSingleReadSnapshot(input: unknown): PreviewSingleReadSnapshot
export function createPreviewSingleReadSnapshot(input: {
  capturedAtMs: number
  resourceOutcomes?: readonly PreviewResourceOutcome[]
}): PreviewSingleReadSnapshot
export function renderPreviewSingleReadJson(input: unknown): string
