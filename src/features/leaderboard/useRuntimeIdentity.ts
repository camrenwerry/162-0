import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readStoredLeaderboardIdentity,
  removeLeaderboardIdentity,
  storeLeaderboardIdentity,
  type StoredLeaderboardIdentity,
} from './identityStorage'
import { PennantApi, type PublicIdentityStatus } from './pennantApi'
import { runtimeFeatureIsEnabled } from './runtimeConfig'

export type RuntimeIdentityState =
  | Readonly<{ kind: 'disabled' | 'missing' | 'corrupt' | 'outdated' | 'unavailable' | 'invalid' }>
  | Readonly<{ kind: 'checking', identity: StoredLeaderboardIdentity }>
  | Readonly<{
    kind: 'ready'
    identity: StoredLeaderboardIdentity
    status: PublicIdentityStatus
  }>

const api = new PennantApi()

function initialState(): RuntimeIdentityState {
  if (!runtimeFeatureIsEnabled('identity')) return Object.freeze({ kind: 'disabled' })
  const stored = readStoredLeaderboardIdentity(window.localStorage)
  return stored.kind === 'ready'
    ? Object.freeze({ kind: 'checking', identity: stored.identity })
    : Object.freeze({ kind: stored.kind })
}

export function useRuntimeIdentity() {
  const [state, setState] = useState<RuntimeIdentityState>(initialState)
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
    if (!runtimeFeatureIsEnabled('identity')) {
      verificationGeneration.current += 1
      statusController.current?.abort()
      statusController.current = null
      statusRequest.current = null
      setState(Object.freeze({ kind: 'disabled' }))
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
