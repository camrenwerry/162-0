import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_MIN_CHARACTERS,
  validateDisplayName,
} from '../../../shared/leaderboard-display-name'
import type { DraftTranscript } from '../../game/DraftTranscript'
import {
  storeLeaderboardIdentity,
} from '../../features/leaderboard/identityStorage'
import {
  PennantApi,
  playerFacingApiMessage,
  type ClaimedIdentity,
  type DraftSubmissionReceipt,
  type DraftTicket,
  type PennantApiError,
} from '../../features/leaderboard/pennantApi'
import { runtimeFeatureIsEnabled } from '../../features/leaderboard/runtimeConfig'
import {
  resolveRuntimeSubmissionIdentity,
  type RuntimeIdentityState,
  type RuntimeSubmissionIdentityDecision,
} from '../../features/leaderboard/runtimeIdentityState'
import type { NavigationBlocker } from '../../appNavigation'
import './Leaderboard.css'

interface RuntimeResultLeaderboardJourneyProps {
  ticket: DraftTicket | null
  transcript: DraftTranscript
  identityState: RuntimeIdentityState
  onIdentityChanged: () => void
  onBlockingChange: (blocking: boolean) => void
  registerNavigationBlocker: (blocker: NavigationBlocker | null) => void
}

type SubmissionState =
  | Readonly<{ kind: 'disabled' }>
  | Readonly<{ kind: 'waiting-identity' }>
  | Readonly<{
    kind: 'identity-blocked'
    reason: Extract<RuntimeSubmissionIdentityDecision, { kind: 'blocked' }>['reason']
  }>
  | Readonly<{ kind: 'submitting' }>
  | Readonly<{ kind: 'error', error: PennantApiError }>
  | Readonly<{ kind: 'success', receipt: DraftSubmissionReceipt }>

const api = new PennantApi()
const LEAVE_PROMPT = 'Leave before finishing this leaderboard setup? Your one-time recovery code will not be shown again.'

function submissionCredential(identityState: RuntimeIdentityState): string | null {
  const decision = resolveRuntimeSubmissionIdentity(identityState)
  return decision.kind === 'credential' ? decision.credential : null
}

function blockedIdentityGuidance(
  reason: Extract<RuntimeSubmissionIdentityDecision, { kind: 'blocked' }>['reason'],
): string {
  switch (reason) {
    case 'corrupt':
      return 'The saved identity record is damaged. Restore it with its current recovery code when recovery is available. Anonymous submission is blocked to protect identity continuity.'
    case 'outdated':
      return 'The saved identity record uses an unsupported version. Restore it with its current recovery code when recovery is available. Anonymous submission is blocked to protect identity continuity.'
    case 'invalid':
      return 'The saved device credential was rejected. Restore the identity with its current recovery code when recovery is available. Anonymous submission is blocked to prevent a replacement identity.'
    case 'unavailable':
      return 'This browser cannot safely read or verify its saved identity. Restore local storage access before submitting or removing the record.'
    case 'disabled':
      return 'Identity continuity is unavailable for this submission. Your local result remains safe.'
    default:
      return assertNeverBlockedReason(reason)
  }
}

function assertNeverBlockedReason(reason: never): never {
  throw new TypeError(`Unhandled blocked identity reason: ${String(reason)}`)
}

function initialSubmissionState(
  ticket: DraftTicket | null,
  identityState: RuntimeIdentityState,
): SubmissionState {
  if (!ticket || !runtimeFeatureIsEnabled('submission')) return Object.freeze({ kind: 'disabled' })
  const decision = resolveRuntimeSubmissionIdentity(identityState)
  if (decision.kind === 'checking') return Object.freeze({ kind: 'waiting-identity' })
  if (decision.kind === 'blocked') {
    return Object.freeze({ kind: 'identity-blocked', reason: decision.reason })
  }
  return Object.freeze({ kind: 'submitting' })
}

function rankLabel(rank: number | null, qualifies: boolean): string {
  return qualifies && rank !== null ? `#${rank}` : '—'
}

function submissionCanRetry(error: PennantApiError): boolean {
  return error.kind === 'offline'
    || error.kind === 'rate-limited'
    || error.kind === 'unavailable'
    || error.kind === 'aborted'
    || error.kind === 'timeout'
}

function PlacementGrid({ receipt }: { receipt: DraftSubmissionReceipt }) {
  const periods = [
    ['Daily', receipt.leaderboard.periods.daily],
    ['Weekly', receipt.leaderboard.periods.weekly],
    ['All-Time', receipt.leaderboard.periods['all-time']],
  ] as const
  return (
    <div className="result-lb__placements" aria-label="Confirmed leaderboard placements">
      {periods.map(([label, placement]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{rankLabel(placement.rank, placement.qualifies)}</strong>
          <small>{placement.qualifies ? 'Best Run' : 'Outside the board'}</small>
        </div>
      ))}
    </div>
  )
}

export default function RuntimeResultLeaderboardJourney({
  ticket,
  transcript,
  identityState,
  onIdentityChanged,
  onBlockingChange,
  registerNavigationBlocker,
}: RuntimeResultLeaderboardJourneyProps) {
  const [submission, setSubmission] = useState<SubmissionState>(
    () => initialSubmissionState(ticket, identityState),
  )
  const [claiming, setClaiming] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [nameMessage, setNameMessage] = useState('')
  const [claimedIdentity, setClaimedIdentity] = useState<ClaimedIdentity | null>(null)
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)
  const [storageReady, setStorageReady] = useState<boolean | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [completedSetup, setCompletedSetup] = useState(false)
  const submissionRequest = useRef<Promise<Awaited<ReturnType<PennantApi['submitDraft']>>> | null>(null)
  const submissionController = useRef<AbortController | null>(null)
  const claimController = useRef<AbortController | null>(null)
  const abortTimer = useRef<number | null>(null)
  const claimRequestActive = useRef(false)
  const mounted = useRef(true)
  const blocking = claimedIdentity !== null && !completedSetup
  const claimSetupPending = submission.kind === 'success'
    && runtimeFeatureIsEnabled('identityClaim')
    && submission.receipt.leaderboard.identity.setupRequired
    && submission.receipt.leaderboard.claim.state === 'available'
    && identityState.kind === 'missing'
    && !completedSetup
  const controlsHidden = blocking
    || claimSetupPending
    || submission.kind === 'submitting'
    || submission.kind === 'waiting-identity'

  const submit = useCallback(() => {
    if (!ticket || !runtimeFeatureIsEnabled('submission') || submissionRequest.current !== null) return
    if (Date.now() >= ticket.expiresAt) {
      setSubmission(Object.freeze({
        kind: 'error',
        error: Object.freeze({ kind: 'expired-ticket', retryAfterSeconds: null }),
      }))
      return
    }
    if (identityState.kind === 'checking') {
      setSubmission(Object.freeze({ kind: 'waiting-identity' }))
      return
    }
    const identityDecision = resolveRuntimeSubmissionIdentity(identityState)
    if (identityDecision.kind === 'blocked') {
      setSubmission(Object.freeze({
        kind: 'identity-blocked',
        reason: identityDecision.reason,
      }))
      return
    }
    setSubmission(Object.freeze({ kind: 'submitting' }))
    const controller = new AbortController()
    submissionController.current = controller
    submissionRequest.current = api.submitDraft(
      ticket.value,
      transcript,
      submissionCredential(identityState),
      controller.signal,
    )
    void submissionRequest.current.then((result) => {
      if (!mounted.current) return
      submissionRequest.current = null
      if (submissionController.current === controller) submissionController.current = null
      setSubmission(result.ok
        ? Object.freeze({ kind: 'success', receipt: result.value })
        : Object.freeze({ kind: 'error', error: result.error }))
    })
  }, [identityState, ticket, transcript])

  useEffect(() => {
    mounted.current = true
    if (abortTimer.current !== null) {
      window.clearTimeout(abortTimer.current)
      abortTimer.current = null
    }
    return () => {
      mounted.current = false
      abortTimer.current = window.setTimeout(() => {
        submissionController.current?.abort()
        claimController.current?.abort()
      }, 0)
    }
  }, [])

  useEffect(() => {
    if (submission.kind === 'submitting' || submission.kind === 'waiting-identity') {
      queueMicrotask(() => {
        if (mounted.current) submit()
      })
    }
  }, [submission.kind, submit])

  useEffect(() => {
    onBlockingChange(controlsHidden)
  }, [controlsHidden, onBlockingChange])

  useEffect(() => {
    const blocker = blocking ? () => window.confirm(LEAVE_PROMPT) : null
    registerNavigationBlocker(blocker)
    if (!blocking) return () => registerNavigationBlocker(null)
    const protectRefresh = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectRefresh)
    return () => {
      window.removeEventListener('beforeunload', protectRefresh)
      registerNavigationBlocker(null)
    }
  }, [blocking, registerNavigationBlocker])

  const retrySubmission = () => {
    if (submissionRequest.current !== null) return
    submit()
  }

  const claimName = async (event: FormEvent) => {
    event.preventDefault()
    if (
      claimRequestActive.current
      || claiming
      || submission.kind !== 'success'
      || !runtimeFeatureIsEnabled('identityClaim')
      || identityState.kind !== 'missing'
    ) return
    const claim = submission.receipt.leaderboard.claim
    if (claim.state !== 'available') return
    const validated = validateDisplayName(displayName)
    if (!validated) {
      setNameMessage(`Use ${DISPLAY_NAME_MIN_CHARACTERS}–${DISPLAY_NAME_MAX_CHARACTERS} letters, numbers, spaces, hyphens, or underscores. Avoid leading, trailing, or repeated spaces.`)
      return
    }
    claimRequestActive.current = true
    setClaiming(true)
    setNameMessage('')
    const controller = new AbortController()
    claimController.current = controller
    const available = await api.checkDisplayName(validated.displayName, controller.signal)
    if (!mounted.current) return
    if (!available.ok) {
      claimRequestActive.current = false
      if (claimController.current === controller) claimController.current = null
      setClaiming(false)
      setNameMessage(playerFacingApiMessage(available.error, 'identity'))
      return
    }
    if (!available.value.available) {
      claimRequestActive.current = false
      if (claimController.current === controller) claimController.current = null
      setClaiming(false)
      setNameMessage('That display name is already in use. Try another.')
      return
    }
    const claimed = await api.claimIdentity(claim.capability, validated.displayName, controller.signal)
    if (!mounted.current) return
    claimRequestActive.current = false
    if (claimController.current === controller) claimController.current = null
    setClaiming(false)
    if (!claimed.ok) {
      setNameMessage(playerFacingApiMessage(claimed.error, 'identity'))
      return
    }
    const stored = storeLeaderboardIdentity(claimed.value, window.localStorage)
    setClaimedIdentity(claimed.value)
    setStorageReady(stored.kind === 'stored')
    setRecoveryAcknowledged(false)
    setCopyMessage('')
    if (stored.kind === 'stored') onIdentityChanged()
  }

  const copyRecoveryCode = async () => {
    if (!claimedIdentity) return
    try {
      await navigator.clipboard.writeText(claimedIdentity.recoveryCode)
      if (mounted.current) setCopyMessage('Recovery code copied.')
    } catch {
      if (mounted.current) setCopyMessage('Copy was unavailable. Select the code and copy it manually.')
    }
  }

  const finishSetup = () => {
    if (!claimedIdentity || !recoveryAcknowledged) return
    setCompletedSetup(true)
    setClaimedIdentity(null)
    setCopyMessage('')
  }

  if (submission.kind === 'disabled') {
    return (
      <section className="result-lb result-lb--disabled" aria-label="Leaderboard status">
        <div className="result-lb__signal" aria-hidden="true">◇</div>
        <div>
          <span>Local result only</span>
          <h2>Keep chasing your best season</h2>
          <p>Public submission is off. This projected season remains available to share and replay on this device.</p>
        </div>
      </section>
    )
  }

  if (submission.kind === 'submitting') {
    return (
      <section className="result-lb" aria-live="polite" aria-busy="true">
        <div className="result-lb__signal" aria-hidden="true">◇</div>
        <div><span>Checking your result</span><h2>Confirming the official placement…</h2><p>Your local result is safe while the server verifies the draft.</p></div>
      </section>
    )
  }

  if (submission.kind === 'waiting-identity') {
    return (
      <section className="result-lb" aria-live="polite" aria-busy="true">
        <div className="result-lb__signal" aria-hidden="true">◇</div>
        <div>
          <span>Checking this device</span>
          <h2>Confirming your leaderboard identity…</h2>
          <p>Your local result is safe while this device is verified.</p>
        </div>
      </section>
    )
  }

  if (submission.kind === 'identity-blocked') {
    return (
      <section className="result-lb" aria-live="polite">
        <div className="result-lb__signal" aria-hidden="true">!</div>
        <div>
          <span>Identity continuity needs attention</span>
          <h2>Your local result is still safe</h2>
          <p>{blockedIdentityGuidance(submission.reason)}</p>
        </div>
      </section>
    )
  }

  if (submission.kind === 'error') {
    return (
      <section className="result-lb" aria-live="polite">
        <div className="result-lb__signal" aria-hidden="true">!</div>
        <div>
          <span>Not submitted</span>
          <h2>Your local result is still safe</h2>
          <p>{playerFacingApiMessage(submission.error, 'submission')}</p>
          {submissionCanRetry(submission.error) && (
            <button type="button" onClick={retrySubmission}>Try Submission Again</button>
          )}
        </div>
      </section>
    )
  }

  const receipt = submission.receipt
  const claim = receipt.leaderboard.claim
  const needsClaim = claimSetupPending

  if (claimedIdentity) {
    return (
      <section className="result-lb result-lb--recovery" aria-live="polite">
        <span>One-time recovery code</span>
        <h2 tabIndex={-1}>Save this code before continuing</h2>
        <p>
          It can move <strong>{claimedIdentity.displayName}</strong> to another device. Pennant Pursuit will not show or store this code again.
        </p>
        {storageReady === false && (
          <p role="alert">This browser could not retain the device identity. Keep the recovery code safe so you can recover later.</p>
        )}
        <code aria-label="One-time recovery code">{claimedIdentity.recoveryCode}</code>
        <button type="button" onClick={copyRecoveryCode}>Copy Recovery Code</button>
        <p role="status">{copyMessage}</p>
        <label>
          <input
            type="checkbox"
            checked={recoveryAcknowledged}
            onChange={(event) => setRecoveryAcknowledged(event.target.checked)}
          />
          I saved this recovery code somewhere private.
        </label>
        <button type="button" disabled={!recoveryAcknowledged} onClick={finishSetup}>Finish Identity Setup</button>
      </section>
    )
  }

  if (needsClaim && !completedSetup) {
    return (
      <section className="result-lb result-lb--claim" aria-live="polite">
        <span>{receipt.idempotentRetry ? 'Submission already confirmed' : 'Qualifying result confirmed'}</span>
        <h2>Claim your place on the board</h2>
        <PlacementGrid receipt={receipt} />
        <form onSubmit={(event) => void claimName(event)}>
          <label htmlFor="result-display-name">Display name</label>
          <input
            id="result-display-name"
            value={displayName}
            minLength={DISPLAY_NAME_MIN_CHARACTERS}
            maxLength={DISPLAY_NAME_MAX_CHARACTERS}
            autoComplete="off"
            disabled={claiming}
            onChange={(event) => {
              setDisplayName(event.target.value)
              setNameMessage('')
            }}
          />
          <button type="submit" disabled={claiming}>{claiming ? 'Claiming…' : 'Claim Display Name'}</button>
        </form>
        <p role="status">{nameMessage}</p>
      </section>
    )
  }

  const qualifying = [
    receipt.leaderboard.periods.daily,
    receipt.leaderboard.periods.weekly,
    receipt.leaderboard.periods['all-time'],
  ].some(({ qualifies }) => qualifies)
  return (
    <section className="result-lb result-lb--complete" aria-live="polite">
      <span>{receipt.idempotentRetry ? 'Submission already confirmed' : 'Submission confirmed'}</span>
      <h2>{qualifying ? 'Your place is official' : 'Your result is recorded'}</h2>
      <p>
        {qualifying
          ? 'These placements come from the server-verified draft.'
          : 'This run did not reach a public Best Run place, but the server verified it successfully.'}
      </p>
      <PlacementGrid receipt={receipt} />
      {receipt.leaderboard.newPersonalBest && <p><strong>New personal best.</strong> This is your strongest verified run so far.</p>}
      {receipt.leaderboard.identity.setupRequired && claim.state !== 'available' && identityState.kind === 'missing' && (
        <p>Identity setup is not available right now, so this placement is not public yet.</p>
      )}
    </section>
  )
}
