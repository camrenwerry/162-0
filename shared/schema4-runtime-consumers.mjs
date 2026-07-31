import {
  runtimeGateFeatureState,
  SCHEMA4_RUNTIME_GATE_REGISTRY,
} from './schema4-capabilities.mjs'

const REGISTRATION_FIELDS = Object.freeze([
  'capability',
  'compatibilityCeiling',
  'consumerIdentity',
  'consumerStatus',
  'descriptorPath',
  'surface',
])

function exactKeys(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(REGISTRATION_FIELDS)
}

export function immutableRuntimeConsumerRegistration(input) {
  if (!exactKeys(input)
    || typeof input.capability !== 'string'
    || typeof input.surface !== 'string'
    || (input.consumerStatus !== 'active' && input.consumerStatus !== 'deliberately-absent')
    || (input.descriptorPath !== null && typeof input.descriptorPath !== 'string')
    || (input.consumerIdentity !== null && typeof input.consumerIdentity !== 'string')
    || (input.compatibilityCeiling !== null && typeof input.compatibilityCeiling !== 'string')) {
    throw new TypeError('Malformed Schema-4 runtime consumer registration.')
  }
  return Object.freeze({
    capability: input.capability,
    surface: input.surface,
    descriptorPath: input.descriptorPath,
    consumerIdentity: input.consumerIdentity,
    consumerStatus: input.consumerStatus,
    compatibilityCeiling: input.compatibilityCeiling,
  })
}

export function runtimeConsumerFeatureState(
  environment,
  registration,
  registry = SCHEMA4_RUNTIME_GATE_REGISTRY,
) {
  if (!Object.isFrozen(registration) || registration.consumerStatus !== 'active') return 'disabled'
  const descriptor = registry.capabilities[registration.capability]?.[registration.surface] ?? null
  if (!descriptor
    || registration.descriptorPath !== `capabilities.${registration.capability}.${registration.surface}`
    || descriptor.compatibilityCeiling !== registration.compatibilityCeiling) return 'disabled'
  return runtimeGateFeatureState(environment, descriptor)
}
