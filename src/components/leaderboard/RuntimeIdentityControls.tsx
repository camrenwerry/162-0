import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_MIN_CHARACTERS,
  validateDisplayName,
} from '../../../shared/leaderboard-display-name'
import { storeLeaderboardIdentity } from '../../features/leaderboard/identityStorage'
import {
  createRecoveryOperationId,
  PennantApi,
  playerFacingApiMessage,
  type RecoveredIdentity,
} from '../../features/leaderboard/pennantApi'
import { runtimeFeatureIsEnabled } from '../../features/leaderboard/runtimeConfig'
import type { RuntimeIdentityState } from '../../features/leaderboard/useRuntimeIdentity'
import type { NavigationBlocker } from '../../appNavigation'

interface RuntimeIdentityControlsProps {
  state: RuntimeIdentityState
  onRefresh: () => void
  onRemove: () => 'removed' | 'unavailable'
  registerNavigationBlocker: (blocker: NavigationBlocker | null) => void
}

const api = new PennantApi()
const RECOVERY_INPUT_MAX_LENGTH = 40

export default function RuntimeIdentityControls({
  state,
  onRefresh,
  onRemove,
  registerNavigationBlocker,
}: RuntimeIdentityControlsProps) {
  const [renameName, setRenameName] = useState('')
  const [renameMessage, setRenameMessage] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [recovered, setRecovered] = useState<RecoveredIdentity | null>(null)
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [storageReady, setStorageReady] = useState<boolean | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const recoveryOperation = useRef<Readonly<{ code: string, id: string }> | null>(null)
  const renameRequestActive = useRef(false)
  const recoveryRequestActive = useRef(false)
  const renameController = useRef<AbortController | null>(null)
  const recoveryController = useRef<AbortController | null>(null)
  const abortTimer = useRef<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    if (abortTimer.current !== null) {
      window.clearTimeout(abortTimer.current)
      abortTimer.current = null
    }
    return () => {
      mounted.current = false
      abortTimer.current = window.setTimeout(() => {
        renameController.current?.abort()
        recoveryController.current?.abort()
      }, 0)
    }
  }, [])

  useEffect(() => {
    if (!recovered) {
      registerNavigationBlocker(null)
      return
    }
    registerNavigationBlocker(() => window.confirm(
      'Leave before saving the replacement recovery code? It will not be shown again.',
    ))
    const protectRefresh = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectRefresh)
    return () => {
      window.removeEventListener('beforeunload', protectRefresh)
      registerNavigationBlocker(null)
    }
  }, [recovered, registerNavigationBlocker])

  const rename = async (event: FormEvent) => {
    event.preventDefault()
    if (renameRequestActive.current || renaming || state.kind !== 'ready') return
    const validated = validateDisplayName(renameName)
    if (!validated) {
      setRenameMessage(`Use ${DISPLAY_NAME_MIN_CHARACTERS}–${DISPLAY_NAME_MAX_CHARACTERS} letters, numbers, spaces, hyphens, or underscores.`)
      return
    }
    if (!state.status.renameEligible) {
      setRenameMessage(state.status.nextEligibleRenameAt
        ? `Your next name change is available ${new Date(state.status.nextEligibleRenameAt).toLocaleDateString()}.`
        : 'A name change is not available yet.')
      return
    }
    renameRequestActive.current = true
    setRenaming(true)
    setRenameMessage('')
    const controller = new AbortController()
    renameController.current = controller
    const available = await api.checkDisplayName(validated.displayName, controller.signal)
    if (!mounted.current) return
    if (!available.ok) {
      renameRequestActive.current = false
      if (renameController.current === controller) renameController.current = null
      setRenaming(false)
      setRenameMessage(playerFacingApiMessage(available.error, 'identity'))
      return
    }
    if (!available.value.available && available.value.displayName !== state.identity.displayName) {
      renameRequestActive.current = false
      if (renameController.current === controller) renameController.current = null
      setRenaming(false)
      setRenameMessage('That display name is already in use. Try another.')
      return
    }
    const result = await api.renameIdentity(
      state.identity.deviceCredential,
      validated.displayName,
      controller.signal,
    )
    if (!mounted.current) return
    renameRequestActive.current = false
    if (renameController.current === controller) renameController.current = null
    setRenaming(false)
    if (!result.ok) {
      setRenameMessage(playerFacingApiMessage(result.error, 'identity'))
      return
    }
    const stored = storeLeaderboardIdentity({
      deviceCredential: state.identity.deviceCredential,
      displayName: result.value.displayName,
      recoveryVersion: result.value.recoveryVersion,
    }, window.localStorage)
    if (stored.kind !== 'stored') {
      setRenameMessage('The name changed, but this browser could not retain the update. Refresh identity status before continuing.')
      return
    }
    setRenameName('')
    setRenameMessage(result.value.displayName === state.identity.displayName
      ? 'Your display name is unchanged.'
      : 'Display name updated.')
    onRefresh()
  }

  const recover = async (event: FormEvent) => {
    event.preventDefault()
    if (recoveryRequestActive.current || recovering || !runtimeFeatureIsEnabled('recovery')) return
    const normalized = recoveryCode.trim().toUpperCase()
    if (normalized.length < 10 || normalized.length > RECOVERY_INPUT_MAX_LENGTH) {
      setRecoveryMessage('Enter the complete recovery code.')
      return
    }
    if (!recoveryOperation.current || recoveryOperation.current.code !== normalized) {
      try {
        recoveryOperation.current = Object.freeze({
          code: normalized,
          id: createRecoveryOperationId(),
        })
      } catch {
        setRecoveryMessage('Recovery could not start securely. Reload and try again.')
        return
      }
    }
    const recoveryAttempt = recoveryOperation.current
    if (!recoveryAttempt) return
    recoveryRequestActive.current = true
    setRecovering(true)
    setRecoveryMessage('')
    const controller = new AbortController()
    recoveryController.current = controller
    const result = await api.recoverIdentity(normalized, recoveryAttempt.id, controller.signal)
    if (!mounted.current) return
    recoveryRequestActive.current = false
    if (recoveryController.current === controller) recoveryController.current = null
    setRecovering(false)
    if (!result.ok) {
      setRecoveryMessage(playerFacingApiMessage(result.error, 'recovery'))
      return
    }
    recoveryOperation.current = null
    const stored = storeLeaderboardIdentity(result.value, window.localStorage)
    setRecovered(result.value)
    setStorageReady(stored.kind === 'stored')
    setRecoverySaved(false)
    setRecoveryCode('')
    setCopyMessage('')
    if (stored.kind === 'stored') onRefresh()
  }

  const copyReplacementCode = async () => {
    if (!recovered) return
    try {
      await navigator.clipboard.writeText(recovered.recoveryCode)
      if (mounted.current) setCopyMessage('Replacement recovery code copied.')
    } catch {
      if (mounted.current) setCopyMessage('Copy was unavailable. Select the code and copy it manually.')
    }
  }

  const finishRecovery = () => {
    if (!recovered || !recoverySaved) return
    setRecovered(null)
    setCopyMessage('')
    setRecoveryMessage('Recovery complete. Prior device credentials and recovery material are no longer valid.')
    recoveryOperation.current = null
  }

  const remove = () => {
    const confirmed = window.confirm('Remove this identity from this device? You will need the current recovery code to restore it here.')
    if (!confirmed) return
    const result = onRemove()
    setRenameMessage(result === 'removed'
      ? 'Identity removed from this device.'
      : 'This browser could not remove the saved identity.')
  }

  if (state.kind === 'disabled') return null

  if (recovered) {
    return (
      <section className="lb-identity lb-identity--recovery" aria-live="polite">
        <span>Recovery complete</span>
        <h2>Save the replacement recovery code</h2>
        <p>The prior device credential and recovery code are no longer valid. This replacement will not be stored or shown again.</p>
        {storageReady === false && <p role="alert">This browser could not retain the replacement device identity. Keep the code safe so you can recover again.</p>}
        <code aria-label="Replacement recovery code">{recovered.recoveryCode}</code>
        <button type="button" onClick={copyReplacementCode}>Copy Replacement Code</button>
        <p role="status">{copyMessage}</p>
        <label>
          <input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} />
          I saved the replacement code somewhere private.
        </label>
        <button type="button" disabled={!recoverySaved} onClick={finishRecovery}>Finish Recovery</button>
      </section>
    )
  }

  return (
    <section className="lb-identity" aria-label="Your leaderboard identity">
      <div>
        <span>Your identity</span>
        <h2>{state.kind === 'ready' ? state.identity.displayName : 'No verified identity on this device'}</h2>
        {state.kind === 'checking' && <p>Checking this device identity…</p>}
        {state.kind === 'invalid' && <p>The saved device identity is no longer valid. Recover it or remove the stale local record.</p>}
        {state.kind === 'corrupt' && <p>The saved identity record could not be read safely.</p>}
        {state.kind === 'outdated' && <p>The saved identity record uses an unsupported version.</p>}
        {state.kind === 'unavailable' && <p>This browser could not read or verify its saved identity.</p>}
        {state.kind === 'missing' && <p>A qualifying result can create an identity, or you can recover an existing one.</p>}
      </div>

      {state.kind === 'ready' && (
        <details>
          <summary>Change display name</summary>
          <form onSubmit={(event) => void rename(event)}>
            <label htmlFor="rename-display-name">New display name</label>
            <input
              id="rename-display-name"
              value={renameName}
              minLength={DISPLAY_NAME_MIN_CHARACTERS}
              maxLength={DISPLAY_NAME_MAX_CHARACTERS}
              autoComplete="off"
              disabled={renaming || !state.status.renameEligible}
              onChange={(event) => {
                setRenameName(event.target.value)
                setRenameMessage('')
              }}
            />
            <button type="submit" disabled={renaming || !state.status.renameEligible}>
              {renaming ? 'Updating…' : 'Update Display Name'}
            </button>
          </form>
          {!state.status.renameEligible && state.status.nextEligibleRenameAt && (
            <p>Next change: {new Date(state.status.nextEligibleRenameAt).toLocaleDateString()}</p>
          )}
        </details>
      )}

      {runtimeFeatureIsEnabled('recovery') && state.kind !== 'ready' && (
        <details open={state.kind === 'invalid'}>
          <summary>Recover an identity</summary>
          <form onSubmit={(event) => void recover(event)}>
            <label htmlFor="leaderboard-recovery-code">Recovery code</label>
            <input
              id="leaderboard-recovery-code"
              value={recoveryCode}
              maxLength={RECOVERY_INPUT_MAX_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={recovering}
              onChange={(event) => {
                setRecoveryCode(event.target.value)
                setRecoveryMessage('')
              }}
            />
            <button type="submit" disabled={recovering}>{recovering ? 'Recovering…' : 'Recover Identity'}</button>
          </form>
        </details>
      )}

      {(state.kind === 'ready' || state.kind === 'invalid' || state.kind === 'corrupt' || state.kind === 'outdated') && (
        <button className="lb-identity__remove" type="button" onClick={remove}>Remove Identity from This Device</button>
      )}
      <p role="status">{renameMessage || recoveryMessage}</p>
    </section>
  )
}
