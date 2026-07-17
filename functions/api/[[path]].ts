import { handleApiNotFoundRequest } from '../lib/api-response'

export { handleApiNotFoundRequest } from '../lib/api-response'

export const onRequest: PagesFunction<Env> = ({ request }) => handleApiNotFoundRequest(request)
