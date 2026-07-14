import { useEffect, useRef, useState } from 'react'
import type { DraftResult } from '../../types/draft'
import DiamondDraftLogo from '../DiamondDraftLogo'
import GameMenu from '../GameMenu'
import { getSimulationReveal, getSimulationTiming, SIMULATION_STAGES } from './simulationSequence'
import './SeasonSimulation.css'

interface SeasonSimulationProps {
  result: DraftResult
  onContinue: () => void
  onRestart: () => void
  onHome: () => void
  reducedMotion?: boolean
}

export default function SeasonSimulation({ result, onContinue, onRestart, onHome, reducedMotion }: SeasonSimulationProps) {
  const prefersReducedMotion = reducedMotion ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const timing = getSimulationTiming(prefersReducedMotion)
  const [stageIndex, setStageIndex] = useState(0)
  const [isRevealed, setIsRevealed] = useState(false)
  const completedRef = useRef(false)
  const reveal = getSimulationReveal(result)

  useEffect(() => {
    if (isRevealed) return
    if (stageIndex < SIMULATION_STAGES.length - 1) {
      const timer = window.setTimeout(() => setStageIndex((index) => index + 1), timing.stageDuration)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      if (completedRef.current) return
      completedRef.current = true
      setIsRevealed(true)
    }, timing.stageDuration + timing.revealDelay)
    return () => window.clearTimeout(timer)
  }, [isRevealed, stageIndex, timing.revealDelay, timing.stageDuration])

  const skip = () => {
    if (completedRef.current) return
    completedRef.current = true
    setIsRevealed(true)
  }

  const stage = SIMULATION_STAGES[stageIndex]
  const progress = (stageIndex + 1) / SIMULATION_STAGES.length

  return (
    <main className={`season-simulation${isRevealed ? ' is-revealed' : ''}${prefersReducedMotion ? ' is-reduced-motion' : ''}`}>
      <div className="season-simulation__lights" aria-hidden="true" />
      <GameMenu className="season-simulation__menu" onHome={onHome} onRestart={onRestart} />
      {!isRevealed && <button className="season-simulation__skip" type="button" onClick={skip}>Skip</button>}
      <section className="season-simulation__shell" aria-live="polite">
        <DiamondDraftLogo className="season-simulation__logo" compact />
        {!isRevealed ? (
          <div className="season-simulation__progress-content" key={stage.label}>
            <div className="season-simulation__baseball" aria-hidden="true"><span>⚾</span></div>
            <small>Season simulation</small>
            <h1>{stage.label}</h1>
            <p>{stage.message}</p>
            <div className="season-simulation__timeline" aria-label={`Season simulation ${Math.round(progress * 100)} percent complete`}>
              <i style={{ transform: `scaleX(${progress})` }} />
              {SIMULATION_STAGES.map((item, index) => <span className={index <= stageIndex ? 'is-complete' : ''} key={item.label} />)}
            </div>
            <b>{Math.round(progress * 100)}%</b>
          </div>
        ) : (
          <div className="season-simulation__reveal">
            <small>Projected record</small>
            <h1>{reveal.wins}–{reveal.losses}</h1>
            <strong>{reveal.tierLabel}</strong>
            <p>Overall <b>{reveal.overallGrade}</b></p>
            <button type="button" onClick={onContinue}>View Full Results</button>
          </div>
        )}
      </section>
    </main>
  )
}
