import type {
  Schema4Capability,
  Schema4RuntimeGateRegistry,
  Schema4RuntimeSurface,
} from './schema4-capabilities.mjs'

export interface Schema4RuntimeConsumerRegistration {
  readonly capability: Schema4Capability
  readonly surface: Schema4RuntimeSurface
  readonly descriptorPath: string | null
  readonly consumerIdentity: string | null
  readonly consumerStatus: 'active' | 'deliberately-absent'
  readonly compatibilityCeiling: string | null
}

export function immutableRuntimeConsumerRegistration(
  input: object,
): Schema4RuntimeConsumerRegistration

export function runtimeConsumerFeatureState(
  environment: object | null | undefined,
  registration: Schema4RuntimeConsumerRegistration,
  registry?: Schema4RuntimeGateRegistry,
): 'enabled' | 'disabled'
