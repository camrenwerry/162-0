const NOT_FOUND_PAYLOAD = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'not_found', message: 'API route not found' }),
})

function responseHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
}

export function handleApiNotFoundRequest(request: Request) {
  const body = request.method === 'HEAD' ? null : JSON.stringify(NOT_FOUND_PAYLOAD)
  return new Response(body, { status: 404, headers: responseHeaders() })
}

export const onRequest: PagesFunction<Env> = ({ request }) => handleApiNotFoundRequest(request)
