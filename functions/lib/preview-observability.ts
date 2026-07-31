export type PreviewOperation =
  | 'ticket'
  | 'submission'
  | 'leaderboard-read'
  | 'claim'
  | 'identity-status'
  | 'rename'
  | 'recovery'

type PreviewOutcome =
  | 'success'
  | 'accepted'
  | 'idempotent'
  | 'conflict'
  | 'invalid'
  | 'rejected'
  | 'rate-limited'
  | 'server-error'

function latencyBucket(elapsedMs: number) {
  if (elapsedMs < 100) return 'lt-100ms'
  if (elapsedMs < 500) return 'lt-500ms'
  if (elapsedMs < 2_000) return 'lt-2000ms'
  return 'gte-2000ms'
}

function outcomeFor(
  operation: PreviewOperation,
  status: number,
): PreviewOutcome {
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server-error'
  if (operation === 'submission') {
    if (status === 201) return 'accepted'
    if (status === 200) return 'idempotent'
    if (status === 409) return 'conflict'
  }
  if (operation === 'recovery' && status === 422) return 'invalid'
  if ((operation === 'claim' || operation === 'rename') && status === 409) return 'conflict'
  if (status >= 200 && status < 300) return 'success'
  if (status === 409) return 'conflict'
  if (status >= 400 && status < 500) return 'rejected'
  return 'server-error'
}

/**
 * Schedules one low-cardinality Preview diagnostic event without inspecting or
 * delaying the response. Logging and scheduler failures cannot affect delivery.
 */
export function observePreviewOperation(
  operation: PreviewOperation,
  response: Response,
  startedAtMs: number,
  now: () => number = () => Date.now(),
  schedule: (task: Promise<void>) => void = () => undefined,
) {
  const task = Promise.resolve().then(() => {
    console.info(JSON.stringify(Object.freeze({
      event: 'preview.operation',
      operation,
      outcome: outcomeFor(operation, response.status),
      latency: latencyBucket(Math.max(0, now() - startedAtMs)),
    })))
  }).catch(() => undefined)
  try {
    schedule(task)
  } catch {
    void task.catch(() => undefined)
  }
  return response
}
