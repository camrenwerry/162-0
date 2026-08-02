import type { PreviewObservationIdentity } from './preview-identity.mjs'
import type {
  PreviewObservationCredentialEnvironment,
  PreviewOperationName,
  RequestBudget,
} from './remote-transport.mjs'

type UnpagedPreviewOperationName = Exclude<
  PreviewOperationName,
  'account-zones' | 'pages-preview-deployments' | 'worker-routes'
>

export type PreviewTransportOperation =
  | Readonly<{ operation: UnpagedPreviewOperationName }>
  | Readonly<{ operation: 'account-zones' | 'pages-preview-deployments'; page: number }>
  | Readonly<{ operation: 'worker-routes'; routeZoneIndex: number }>

export interface PreviewTransportReceipt {
  readonly operation: PreviewOperationName
  readonly bodyBytes: number
  readonly representation: 'private-provider-json-consumed'
}

export interface PreviewHttpTransport {
  readonly request: (operation: PreviewTransportOperation) => Promise<PreviewTransportReceipt>
  readonly requestBudget: () => RequestBudget
}

export interface PreviewHttpTransportDependencies {
  readonly fetchImplementation?: typeof fetch
  readonly setTimer?: typeof setTimeout
  readonly clearTimer?: typeof clearTimeout
  readonly now?: () => number
}

export function createPreviewHttpTransport(
  identity: PreviewObservationIdentity,
  credentialEnvironment: PreviewObservationCredentialEnvironment,
  dependencies?: PreviewHttpTransportDependencies,
): PreviewHttpTransport
