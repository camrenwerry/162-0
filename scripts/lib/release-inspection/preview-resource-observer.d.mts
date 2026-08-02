import type { PreviewSingleReadSnapshot } from './preview-observation-contracts.mjs'

declare const previewResourceObservationAuthority: unique symbol

export interface PreviewResourceObservationAuthority {
  readonly [previewResourceObservationAuthority]: never
}

export function observePreviewResourcesWithTransport(
  transport: PreviewResourceObservationAuthority,
  input: Readonly<{ capturedAtMs: number }>,
): Promise<PreviewSingleReadSnapshot>
