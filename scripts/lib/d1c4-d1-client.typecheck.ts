import { createPreviewD1Client } from './d1c4-d1-client'
import type { PreviewSmokeTarget } from './d1c4-preview-guard'

declare const rawTarget: PreviewSmokeTarget

function proveRawTargetIsRejected() {
  // @ts-expect-error Raw identifiers must pass through validatePreviewSmokeTarget first.
  createPreviewD1Client(rawTarget, 'unreachable-test-token')
}

void proveRawTargetIsRejected
