import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { DraftResult } from '../../types/draft'
import PennantPursuitLogo from '../PennantPursuitLogo'
import GameMenu from '../GameMenu'
import { getSimulationDuration, getSimulationPhase, getSimulationReveal, SIMULATION_PHASES } from './simulationSequence'
import './SeasonSimulation.css'

interface SeasonSimulationProps {
  result: DraftResult
  onContinue: () => void
  onRestart: () => void
  onHome: () => void
  onGameUpdates: () => void
  reducedMotion?: boolean
}

export default function SeasonSimulation({ result, onContinue, onRestart, onHome, onGameUpdates, reducedMotion }: SeasonSimulationProps) {
  const prefersReducedMotion = reducedMotion ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const duration = getSimulationDuration(prefersReducedMotion)
  const reveal = getSimulationReveal(result)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [isRevealed, setIsRevealed] = useState(false)
  const [canContinue, setCanContinue] = useState(false)
  const frameRef = useRef<number | null>(null)
  const continueTimerRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const continuedRef = useRef(false)
  const phaseRef = useRef(0)

  const scheduleContinue = useCallback(() => {
    if (continueTimerRef.current !== null) window.clearTimeout(continueTimerRef.current)
    continueTimerRef.current = window.setTimeout(() => setCanContinue(true), prefersReducedMotion ? 160 : 900)
  }, [prefersReducedMotion])

  useEffect(() => {
    let startedAt: number | null = null
    const advance = (timestamp: number) => {
      if (completedRef.current) return
      startedAt ??= timestamp
      const progress = Math.min(1, (timestamp - startedAt) / duration)
      const nextPhase = getSimulationPhase(progress)
      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase
        setPhaseIndex(nextPhase)
      }
      if (progress >= 1) {
        completedRef.current = true
        setIsRevealed(true)
        scheduleContinue()
        return
      }
      frameRef.current = window.requestAnimationFrame(advance)
    }
    frameRef.current = window.requestAnimationFrame(advance)
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      if (continueTimerRef.current !== null) window.clearTimeout(continueTimerRef.current)
    }
  }, [duration, scheduleContinue])

  const skip = () => {
    if (completedRef.current) return
    completedRef.current = true
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    phaseRef.current = 2
    setPhaseIndex(2)
    setIsRevealed(true)
    scheduleContinue()
  }

  const continueToResults = () => {
    if (!canContinue || continuedRef.current) return
    continuedRef.current = true
    onContinue()
  }

  const progressValue = isRevealed ? 100 : phaseIndex === 0 ? 35 : phaseIndex === 1 ? 84 : 96
  const style = { '--simulation-duration': `${duration}ms` } as CSSProperties

  return (
    <main className={`season-simulation${isRevealed ? ' is-revealed' : ''}${prefersReducedMotion ? ' is-reduced-motion' : ''}`} style={style}>
      <div className="season-simulation__lights" aria-hidden="true" />
      <div className="season-simulation__particles" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <GameMenu className="season-simulation__menu" onHome={onHome} onRestart={onRestart} onGameUpdates={onGameUpdates} />
      <button className="season-simulation__skip" type="button" disabled={isRevealed} onClick={skip}>Skip</button>
      <section className="season-simulation__shell" aria-live="polite">
        <PennantPursuitLogo className="season-simulation__logo" compact />
        <div className="season-simulation__moment">
          <div className="season-simulation__phase-region" aria-hidden={isRevealed}>
            {SIMULATION_PHASES.map((phase, index) => (
              <div className={index === phaseIndex ? 'is-active' : ''} aria-hidden={index !== phaseIndex || isRevealed} key={phase.label}>
                <small>Season simulation</small>
                <h1>{phase.label}</h1>
                <p>{phase.message}</p>
              </div>
            ))}
          </div>
          <div className="season-simulation__progress" aria-hidden={isRevealed}>
            <div
              className="season-simulation__timeline"
              role="progressbar"
              aria-label="Season simulation progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
            >
              <i />
              <span aria-hidden="true">⚾</span>
            </div>
            <div className="season-simulation__milestones" aria-hidden="true"><span>Season</span><span>Postseason</span><span>Final</span></div>
          </div>
          <div className="season-simulation__reveal" aria-hidden={!isRevealed}>
            <small>Projected record</small>
            <h1>{reveal.wins}–{reveal.losses}</h1>
            <strong>{reveal.tierLabel}</strong>
            <p>Overall <b>{reveal.overallGrade}</b></p>
          </div>
        </div>
        <div className="season-simulation__action-region">
          <button className="season-simulation__continue" type="button" aria-hidden={!canContinue} disabled={!canContinue} onClick={continueToResults}>View Full Results</button>
        </div>
      </section>
    </main>
  )
}
