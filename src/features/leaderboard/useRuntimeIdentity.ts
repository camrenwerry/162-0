import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readStoredLeaderboardIdentity,
  removeLeaderboardIdentity,
  storeLeaderboardIdentity,
  type StoredLeaderboardIdentity,
} from './identityStorage'
import { PennantApi } from './pennantApi'
import { runtimeFeatureIsEnabled } from './runtimeConfig'
import {
  deriveRuntimeIdentityState,
  type RuntimeIdentityFeatureSnapshot,
  type RuntimeIdentityState,
} from './runtimeIdentityState'
export type { RuntimeIdentityState } from './runtimeIdentityState'

const api = new PennantApi()

function currentFeatureSnapshot(): RuntimeIdentityFeatureSnapshot {
  return Object.freeze({
    submission: runtimeFeatureIsEnabled('submission'),
    identityClaim: runtimeFeatureIsEnabled('identityClaim'),
    identityStatus: runtimeFeatureIsEnabled('identityStatus'),
    identityRename: runtimeFeatureIsEnabled('identityRename'),
    recovery: runtimeFeatureIsEnabled('recovery'),
  })
}

function stateFromLocalStorage(): RuntimeIdentityState {
  const stored = readStoredLeaderboardIdentity(window.localStorage)
  return deriveRuntimeIdentityState(stored, currentFeatureSnapshot())
}

export function useRuntimeIdentity() {
  const [state, setState] = useState<RuntimeIdentityState>(stateFromLocalStorage)
  const statusRequest = useRef<Promise<Awaited<ReturnType<PennantApi['identityStatus']>>> | null>(null)
  const statusController = useRef<AbortController | null>(null)
  const abortTimer = useRef<number | null>(null)
  const verificationGeneration = useRef(0)
  const mounted = useRef(true)

  const verify = useCallback((stored: StoredLeaderboardIdentity) => {
    statusController.current?.abort()
    const generation = verificationGeneration.current + 1
    verificationGeneration.current = generation
    setState(Object.freeze({ kind: 'checking', identity: stored }))
    const controller = new AbortController()
    statusController.current = controller
    const request = api.identityStatus(stored.deviceCredential, controller.signal)
    statusRequest.current = request
    void request.then((result) => {
      if (statusRequest.current === request) statusRequest.current = null
      if (statusController.current === controller) statusController.current = null
      if (!mounted.current || verificationGeneration.current !== generation) return
      if (!result.ok) {
        setState(Object.freeze({
          kind: result.error.kind === 'invalid-credential' ? 'invalid' : 'unavailable',
        }))
        return
      }
      const saved = storeLeaderboardIdentity({
        deviceCredential: stored.deviceCredential,
        displayName: result.value.displayName,
        recoveryVersion: result.value.recoveryVersion,
      }, window.localStorage)
      if (saved.kind !== 'stored') {
        setState(Object.freeze({ kind: 'unavailable' }))
        return
      }
      setState(Object.freeze({
        kind: 'ready',
        identity: saved.identity,
        status: result.value,
      }))
    })
  }, [])

  const refresh = useCallback(() => {
    if (!runtimeFeatureIsEnabled('identityStatus')) {
      verificationGeneration.current += 1
      statusController.current?.abort()
      statusController.current = null
      statusRequest.current = null
      setState(stateFromLocalStorage())
      return
    }
    const stored = readStoredLeaderboardIdentity(window.localStorage)
    if (stored.kind !== 'ready') {
      verificationGeneration.current += 1
      statusController.current?.abort()
      statusController.current = null
      statusRequest.current = null
      setState(Object.freeze({ kind: stored.kind }))
      return
    }
    verify(stored.identity)
  }, [verify])

  useEffect(() => {
    if (state.kind !== 'checking' || statusRequest.current !== null) return
    verify(state.identity)
  }, [state, verify])

  useEffect(() => {
    mounted.current = true
    if (abortTimer.current !== null) {
      window.clearTimeout(abortTimer.current)
      abortTimer.current = null
    }
    return () => {
      mounted.current = false
      abortTimer.current = window.setTimeout(() => statusController.current?.abort(), 0)
    }
  }, [])

  const removeFromDevice = useCallback(() => {
    const result = removeLeaderboardIdentity(window.localStorage)
    if (result === 'removed') {
      verificationGeneration.current += 1
      statusController.current?.abort()
      statusController.current = null
      statusRequest.current = null
      setState(Object.freeze({ kind: 'missing' }))
    }
    return result
  }, [])

  return { state, refresh, removeFromDevice }
}
