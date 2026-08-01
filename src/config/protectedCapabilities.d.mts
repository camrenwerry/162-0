import type { Schema4Capability } from '../../shared/schema4-capabilities.mjs'

export type ProtectedFrontendCapabilityState = 'disabled' | 'enabled'

export interface ProtectedFrontendCapabilitySource {
  readonly schemaVersion: 1
  readonly kind: 'pennant-pursuit-protected-frontend-capabilities'
  readonly policy: 'all-disabled'
  readonly capabilities: Readonly<Record<Schema4Capability, ProtectedFrontendCapabilityState>>
}

export const PROTECTED_FRONTEND_CAPABILITY_SOURCE_SCHEMA_VERSION: 1
export const PROTECTED_FRONTEND_CAPABILITY_SOURCE_KIND: 'pennant-pursuit-protected-frontend-capabilities'
export const PROTECTED_FRONTEND_CAPABILITY_SOURCE: ProtectedFrontendCapabilitySource
export function validateProtectedFrontendCapabilitySource(
  input: unknown,
  options?: Readonly<{ enforceAllDisabledPolicy?: boolean }>,
): ProtectedFrontendCapabilitySource
export function protectedFrontendCapabilityState(
  capability: Schema4Capability | unknown,
): ProtectedFrontendCapabilityState
