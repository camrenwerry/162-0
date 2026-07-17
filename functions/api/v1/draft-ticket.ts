import { handleApiNotFoundRequest } from '../../lib/api-response'
import { isDraftTicketEnabled } from '../../lib/draft-ticket-mode'
import {
  proxyPrivateValidationRequest,
  type PrivateValidationProxyEnv,
} from '../../lib/private-validation-proxy'

/** Preview-only Pages feature gate for private draft-ticket issuance. */
export async function handleDraftTicketRequest(request: Request, env: PrivateValidationProxyEnv = {}) {
  if (!isDraftTicketEnabled(env)) return handleApiNotFoundRequest(request)
  return proxyPrivateValidationRequest(request, env)
}

export const onRequest: PagesFunction<PrivateValidationProxyEnv> = ({ request, env }) => handleDraftTicketRequest(request, env)
