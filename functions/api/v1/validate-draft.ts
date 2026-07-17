import { handleApiNotFoundRequest } from '../../lib/api-response'
import { isDraftValidationEnabled } from '../../lib/draft-validation-mode'
import {
  proxyPrivateValidationRequest,
  type PrivateValidationProxyEnv,
} from '../../lib/private-validation-proxy'

export { deriveTrustedRateKey, INTERNAL_RATE_KEY_HEADER } from '../../lib/private-validation-proxy'

/**
 * C4.1's public boundary deliberately handles only feature gating, method and
 * same-origin checks, trusted metadata derivation, and Service Binding proxying.
 * Parsing, replay, scoring, and catalog access live only in the private Worker.
 */
export async function handleValidateDraftRequest(request: Request, env: PrivateValidationProxyEnv = {}) {
  if (!isDraftValidationEnabled(env)) return handleApiNotFoundRequest(request)
  return proxyPrivateValidationRequest(request, env)
}

export const onRequest: PagesFunction<PrivateValidationProxyEnv> = ({ request, env }) => handleValidateDraftRequest(request, env)
