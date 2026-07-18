import { handleApiNotFoundRequest } from '../../lib/api-response'
import { isDraftSubmissionEnabled } from '../../lib/draft-submission-mode'
import {
  proxyPrivateSubmissionRequest,
  type PrivateValidationProxyEnv,
} from '../../lib/private-validation-proxy'

/**
 * The public submission boundary is a disabled, bounded Service Binding proxy.
 * Ticket handling, replay, scoring, and D1 access stay in the private Worker.
 */
export function handleSubmitDraftRequest(request: Request, env: PrivateValidationProxyEnv = {}) {
  if (!isDraftSubmissionEnabled(env)) return handleApiNotFoundRequest(request)
  return proxyPrivateSubmissionRequest(request, env)
}

export const onRequest: PagesFunction<PrivateValidationProxyEnv> = ({ request, env }) => handleSubmitDraftRequest(request, env)
