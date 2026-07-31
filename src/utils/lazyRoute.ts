import { APP_VERSION } from '../config/app'

const CHUNK_RECOVERY_KEY_PREFIX = 'pennant-pursuit:chunk-recovery'
const CHUNK_RECOVERY_DEADLINE_MS = 8_000

interface RecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface LazyRouteEnvironment {
  readonly version?: string
  readonly storage?: RecoveryStorage
  readonly reload?: () => void
  readonly requestServiceWorkerUpdate?: (signal: AbortSignal) => Promise<void>
  readonly recoveryDeadlineMs?: number
}

export function isObsoleteLazyChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'ChunkLoadError') return true
  return [
    /Failed to fetch dynamically imported module/u,
    /Importing a module script failed/u,
    /error loading dynamically imported module/iu,
    /Loading chunk \S+ failed/iu,
  ].some((pattern) => pattern.test(error.message))
}

function recoveryAbortError() {
  return new DOMException('The app update recovery deadline elapsed.', 'AbortError')
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? recoveryAbortError())
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? recoveryAbortError())
    signal.addEventListener('abort', abort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

async function waitForReplacementController(signal: AbortSignal): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable.')
  const container = navigator.serviceWorker
  const previousController = container.controller
  const registration = await abortable(container.getRegistration(), signal)
  if (!registration) throw new Error('No service-worker registration is available.')

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const workers = new Map<ServiceWorker, () => void>()
    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      container.removeEventListener('controllerchange', controllerChanged)
      registration.removeEventListener('updatefound', updateFound)
      for (const [worker, listener] of workers) worker.removeEventListener('statechange', listener)
      workers.clear()
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const fail = (error: unknown) => finish(() => reject(error))
    const controllerChanged = () => {
      if (container.controller && container.controller !== previousController) {
        finish(resolve)
      }
    }
    const watch = (worker: ServiceWorker | null) => {
      if (!worker || workers.has(worker)) return
      const stateChanged = () => {
        if (worker.state === 'redundant') {
          fail(new Error('The replacement service worker could not install.'))
          return
        }
        controllerChanged()
      }
      workers.set(worker, stateChanged)
      worker.addEventListener('statechange', stateChanged)
      stateChanged()
    }
    const updateFound = () => watch(registration.installing)
    const abort = () => fail(signal.reason ?? recoveryAbortError())

    signal.addEventListener('abort', abort, { once: true })
    container.addEventListener('controllerchange', controllerChanged)
    registration.addEventListener('updatefound', updateFound)
    watch(registration.installing)
    watch(registration.waiting)
    controllerChanged()
    if (settled) return

    void Promise.resolve()
      .then(() => registration.update())
      .then(() => {
        watch(registration.installing)
        watch(registration.waiting)
        controllerChanged()
      })
      .catch(fail)
  })
}

async function runBoundedUpdate(
  requestServiceWorkerUpdate: (signal: AbortSignal) => Promise<void>,
  deadlineMs: number,
) {
  const controller = new AbortController()
  const abort = () => controller.abort(recoveryAbortError())
  const timer = globalThis.setTimeout(abort, deadlineMs)
  try {
    await abortable(
      Promise.resolve().then(() => requestServiceWorkerUpdate(controller.signal)),
      controller.signal,
    )
  } finally {
    globalThis.clearTimeout(timer)
    controller.abort(recoveryAbortError())
  }
}

function browserEnvironment(): Required<LazyRouteEnvironment> {
  return {
    version: APP_VERSION,
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
    requestServiceWorkerUpdate: waitForReplacementController,
    recoveryDeadlineMs: CHUNK_RECOVERY_DEADLINE_MS,
  }
}

export async function importLazyRoute<T>(
  loader: () => Promise<T>,
  environment?: LazyRouteEnvironment,
): Promise<T> {
  try {
    return await loader()
  } catch (error) {
    if (!isObsoleteLazyChunkError(error)) throw error
    let defaults: Required<LazyRouteEnvironment> | null
    try {
      defaults = typeof window === 'undefined' ? null : browserEnvironment()
    } catch {
      throw error
    }
    const version = environment?.version ?? defaults?.version
    const storage = environment?.storage ?? defaults?.storage
    const reload = environment?.reload ?? defaults?.reload
    const requestServiceWorkerUpdate = environment?.requestServiceWorkerUpdate
      ?? defaults?.requestServiceWorkerUpdate
    const recoveryDeadlineMs = environment?.recoveryDeadlineMs
      ?? defaults?.recoveryDeadlineMs
    if (
      !version
      || !storage
      || !reload
      || !requestServiceWorkerUpdate
      || !recoveryDeadlineMs
      || !Number.isFinite(recoveryDeadlineMs)
      || recoveryDeadlineMs <= 0
    ) throw error
    const key = `${CHUNK_RECOVERY_KEY_PREFIX}:${version}`
    try {
      if (storage.getItem(key) === 'attempted') throw error
      storage.setItem(key, 'attempted')
      if (storage.getItem(key) !== 'attempted') throw error
      await runBoundedUpdate(requestServiceWorkerUpdate, recoveryDeadlineMs)
      reload()
    } catch {
      throw error
    }
    return await new Promise<T>(() => undefined)
  }
}
