declare const previewObservationIdentityAuthority: unique symbol

export interface PreviewObservationIdentity {
  readonly [previewObservationIdentityAuthority]: never
}

export function validatePreviewObservationIdentity(input: unknown): PreviewObservationIdentity
export function loadPreviewObservationIdentity(repositoryRoot: string): PreviewObservationIdentity
