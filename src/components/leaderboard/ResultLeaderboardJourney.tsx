import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  DISPLAY_NAME_MAX_CHARACTERS,
  DISPLAY_NAME_MIN_CHARACTERS,
  validateDisplayName,
} from '../../../shared/leaderboard-display-name'
import {
  confirmResultJourneyNavigation,
  createJourneyTransitionGuard,
  isResultJourneyBlocking,
  RESULT_JOURNEY_TRANSITION_LOCK_MS,
  selectPlacementStories,
  type DevelopmentResultJourneyData,
  type ResultJourneyStage,
  type ResultPlacement,
} from '../../features/leaderboard/leaderboardFixtures'
import './Leaderboard.css'

export interface ResultLeaderboardJourneyProps {
  data: DevelopmentResultJourneyData
  onBlockingChange: (blocking: boolean) => void
  onLeave: () => void
  registerNavigationBlocker: (blocker: (() => boolean) | null) => void
}

const LEAVE_PROMPT = 'Leave this local leaderboard preview? Your unfinished name and recovery acknowledgement will be discarded.'

function PlacementGrid({ placement }: { placement: ResultPlacement }) {
  const periods = [placement.daily, placement.weekly, placement.allTime]
  return (
    <div className="result-lb__placements" aria-label="Leaderboard placements">
      {periods.map((period) => (
        <div key={period.label}>
          <span>{period.label}</span>
          <strong>#{period.rank}</strong>
          <small>Best Run</small>
        </div>
      ))}
    </div>
  )
}

function LeavePreviewButton({ onLeave }: { onLeave: () => void }) {
  return (
    <button className="result-lb__leave" type="button" onClick={onLeave}>
      Leave Local Preview
    </button>
  )
}

function identitySetupMessage(data: DevelopmentResultJourneyData) {
  if (data.scenario === 'first-time') {
    return 'Choose a display name for this browser-local preview. Nothing is sent to a public board.'
  }
  const messages = {
    missing: 'No browser-local identity was found. Choose a display name to set up this local preview.',
    corrupt: 'The saved browser-local identity could not be read safely. Choose a display name to replace it.',
    outdated: 'The saved browser-local identity uses an unsupported version. Choose a display name to replace it.',
    invalid: 'The saved browser-local name no longer meets the display-name rules. Choose a new name.',
    unavailable: 'This browser did not allow the local identity to be read. You can try choosing a name, but saving may remain unavailable.',
  } as const
  return data.identityState.kind === 'ready'
    ? 'Choose a display name for this browser-local preview.'
    : messages[data.identityState.kind]
}

export default function ResultLeaderboardJourney({
  data,
  onBlockingChange,
  onLeave,
  registerNavigationBlocker,
}: ResultLeaderboardJourneyProps) {
  const [stage, setStage] = useState<ResultJourneyStage>('suspense')
  const [displayName, setDisplayName] = useState('')
  const [validatedName, setValidatedName] = useState('')
  const [nameError, setNameError] = useState('')
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)
  const [recoveryControlsLocked, setRecoveryControlsLocked] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const focusTarget = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  const recoveryUnlockTimer = useRef<number | null>(null)
  const transitionGuard = useRef(createJourneyTransitionGuard())
  const blocking = isResultJourneyBlocking(stage)

  const confirmLeave = useCallback(() => confirmResultJourneyNavigation(
    blocking,
    () => window.confirm(LEAVE_PROMPT),
  ), [blocking])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (recoveryUnlockTimer.current !== null) {
        window.clearTimeout(recoveryUnlockTimer.current)
        recoveryUnlockTimer.current = null
      }
    }
  }, [])

  useEffect(() => {
    onBlockingChange(blocking)
    registerNavigationBlocker(blocking ? confirmLeave : null)
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
  }, [blocking, confirmLeave, onBlockingChange, registerNavigationBlocker])

  useEffect(() => {
    if (stage === 'recovery' && recoveryControlsLocked) return
    focusTarget.current?.focus()
  }, [recoveryControlsLocked, stage])

  const transitionTo = (nextStage: ResultJourneyStage) => {
    transitionGuard.current.tryTransition(() => setStage(nextStage))
  }

  const revealStanding = () => {
    const needsIdentity = data.scenario === 'first-time'
      || (data.scenario === 'returning' && data.identityState.kind !== 'ready')
    transitionTo(needsIdentity ? 'claim' : 'story')
  }

  const claimName = (event: FormEvent) => {
    event.preventDefault()
    const validated = validateDisplayName(displayName)
    if (!validated) {
      setNameError(`Use ${DISPLAY_NAME_MIN_CHARACTERS}–${DISPLAY_NAME_MAX_CHARACTERS} letters, numbers, spaces, hyphens, or underscores. Avoid leading, trailing, or repeated spaces.`)
      return
    }
    if (!data.isDisplayNameAvailable(validated.nameKey)) {
      setNameError('That display name is unavailable here. Try another.')
      return
    }
    transitionGuard.current.tryTransition(() => {
      setValidatedName(validated.displayName)
      setNameError('')
      setStage('claimed')
    })
  }

  const copyRecoveryCode = async () => {
    if (recoveryControlsLocked) return
    try {
      await navigator.clipboard.writeText(data.recoveryCode)
      if (mounted.current) setCopyStatus('Demonstration code copied.')
    } catch {
      if (mounted.current) {
        setCopyStatus('Copy was unavailable. Select the demonstration code and copy it manually.')
      }
    }
  }

  const confirmRecovery = () => {
    if (recoveryControlsLocked || !recoveryAcknowledged) return
    transitionGuard.current.tryTransition(() => {
      const outcome = data.saveIdentity(validatedName, window.localStorage)
      if (outcome.kind === 'invalid') {
        setNameError('That display name no longer passes validation. Choose another name.')
        setCopyStatus('')
        setStage('claim')
        transitionGuard.current.reset()
        return
      }
      if (outcome.kind === 'unavailable') {
        setCopyStatus('This browser could not save the local preview name. Nothing was sent or stored.')
        transitionGuard.current.reset()
        return
      }
      setCopyStatus('')
      setStage('complete')
    })
  }

  const enterRecovery = () => {
    const transitioned = transitionGuard.current.tryTransition(() => {
      setRecoveryAcknowledged(false)
      setCopyStatus('')
      setRecoveryControlsLocked(true)
      setStage('recovery')
    })
    if (!transitioned) return

    if (recoveryUnlockTimer.current !== null) {
      window.clearTimeout(recoveryUnlockTimer.current)
    }
    const unlockWhenReady = () => {
      const remaining = transitionGuard.current.remainingMilliseconds()
      if (remaining > 0) {
        recoveryUnlockTimer.current = window.setTimeout(unlockWhenReady, remaining)
        return
      }
      recoveryUnlockTimer.current = null
      if (mounted.current) setRecoveryControlsLocked(false)
    }
    recoveryUnlockTimer.current = window.setTimeout(
      unlockWhenReady,
      Math.min(
        RESULT_JOURNEY_TRANSITION_LOCK_MS,
        transitionGuard.current.remainingMilliseconds(),
      ),
    )
  }

  if (stage === 'suspense') {
    return (
      <section className="result-lb result-lb--suspense" aria-labelledby="result-lb-suspense-title">
        <LeavePreviewButton onLeave={onLeave} />
        <div className="result-lb__diamond" aria-hidden="true"><i /></div>
        <span>One more reveal</span>
        <h2 id="result-lb-suspense-title" ref={focusTarget} tabIndex={-1}>Did your club make the board?</h2>
        <p>Your projected season is in. Now see where this local sample places the roster.</p>
        <button className="result-lb__primary" type="button" onClick={revealStanding}>Reveal My Standing</button>
      </section>
    )
  }

  if (stage === 'claim') {
    return (
      <section className="result-lb result-lb--claim" aria-labelledby="result-lb-claim-title">
        <LeavePreviewButton onLeave={onLeave} />
        <span>Local identity setup</span>
        <h2 id="result-lb-claim-title" ref={focusTarget} tabIndex={-1}>Name this local preview.</h2>
        <p>{identitySetupMessage(data)}</p>
        <form onSubmit={claimName} noValidate>
          <label htmlFor="leaderboard-display-name">Display name</label>
          <input
            aria-describedby="display-name-help display-name-error"
            aria-invalid={nameError ? 'true' : 'false'}
            autoComplete="off"
            id="leaderboard-display-name"
            onChange={(event) => {
              setDisplayName(event.target.value)
              setNameError('')
            }}
            spellCheck={false}
            type="text"
            value={displayName}
          />
          <small id="display-name-help">{DISPLAY_NAME_MIN_CHARACTERS}–{DISPLAY_NAME_MAX_CHARACTERS} characters · letters, numbers, spaces, hyphens, and underscores</small>
          <p className="result-lb__error" id="display-name-error" role="alert">{nameError}</p>
          <button className="result-lb__primary" type="submit">Continue with This Name</button>
        </form>
      </section>
    )
  }

  if (stage === 'claimed') {
    return (
      <section className="result-lb result-lb--claimed" aria-labelledby="result-lb-claimed-title">
        <LeavePreviewButton onLeave={onLeave} />
        <span>Local preview placement</span>
        <h2 id="result-lb-claimed-title" ref={focusTarget} tabIndex={-1}>{validatedName}, here’s the sample placement.</h2>
        <p>The name is not saved yet. Review the demonstration recovery step before confirming browser-local storage.</p>
        <PlacementGrid placement={data.placement} />
        <button className="result-lb__primary" type="button" onClick={enterRecovery}>Review Demonstration Code</button>
      </section>
    )
  }

  if (stage === 'recovery') {
    return (
      <section
        aria-busy={recoveryControlsLocked}
        aria-labelledby="result-lb-recovery-title"
        className="result-lb result-lb--recovery"
      >
        <LeavePreviewButton onLeave={onLeave} />
        <span>Demonstration recovery step</span>
        <h2 id="result-lb-recovery-title" ref={focusTarget} tabIndex={-1}>Review this private-code example.</h2>
        <p>Recovery is off. This code is not stored or connected to a recovery service, and it cannot restore a public identity. It only demonstrates the private-code experience.</p>
        <div className="result-lb__code">
          <code>{data.recoveryCode}</code>
          <button type="button" disabled={recoveryControlsLocked} onClick={copyRecoveryCode}>Copy Demonstration Code</button>
        </div>
        <p className="result-lb__copy-status" aria-live="polite" role="status">{copyStatus}</p>
        <label className="result-lb__confirmation" data-disabled={recoveryControlsLocked || undefined}>
          <input
            checked={recoveryAcknowledged}
            disabled={recoveryControlsLocked}
            onChange={(event) => {
              if (!recoveryControlsLocked) setRecoveryAcknowledged(event.target.checked)
            }}
            type="checkbox"
          />
          <span>I reviewed or stored this demonstration code somewhere private.</span>
        </label>
        <button
          className="result-lb__primary"
          disabled={recoveryControlsLocked || !recoveryAcknowledged}
          onClick={confirmRecovery}
          type="button"
        >
          Save Local Preview Name
        </button>
      </section>
    )
  }

  if (stage === 'complete') {
    return (
      <section className="result-lb result-lb--complete" aria-labelledby="result-lb-complete-title">
        <span>Browser-local preview saved</span>
        <h2 id="result-lb-complete-title" ref={focusTarget} tabIndex={-1}>Your local preview name is ready.</h2>
        <p>The display name is saved in this browser. This result and demonstration code were not stored, and no public service was contacted.</p>
        <PlacementGrid placement={data.placement} />
      </section>
    )
  }

  const stories = selectPlacementStories(data.placement)
  return (
    <section className="result-lb result-lb--story" aria-labelledby="result-lb-story-title">
      <span>{data.scenario === 'near-miss' ? 'So close' : `Welcome back, ${data.placement.displayName}`}</span>
      <h2 id="result-lb-story-title" ref={focusTarget} tabIndex={-1}>
        {data.scenario === 'near-miss' ? 'The Top 10 is one roster away.' : 'This team moved your story forward.'}
      </h2>
      <div className="result-lb__stories">
        {stories.map((story) => (
          <article key={story.eyebrow}>
            <span>{story.eyebrow}</span>
            <strong>{story.headline}</strong>
            <p>{story.detail}</p>
          </article>
        ))}
      </div>
      <PlacementGrid placement={data.placement} />
    </section>
  )
}
