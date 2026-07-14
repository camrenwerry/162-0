import { useEffect, useRef } from 'react'
import { useDialogFocusTrap } from '../useDialogFocusTrap'

interface HowToPlayModalProps {
  onClose: () => void
  onReplayTutorial: () => void
}

const STEPS = [
  ['The draw', 'Each round gives you a random franchise and decade. Every card uses that player’s best eligible season for that franchise in that decade.'],
  ['Make a pick', 'Choose one player and assign them to a valid open position. Grey cards cannot fit your remaining roster.'],
  ['Build 14', 'Fill C, the infield, three outfield spots, DH, three SP slots, and two RP slots.'],
  ['Use rerolls wisely', 'You receive one Team reroll and one Era reroll for the entire game—not once per round.'],
  ['Project the season', 'After pick 14, Diamond Draft grades your roster and projects a 162-game record.'],
]

export default function HowToPlayModal({ onClose, onReplayTutorial }: HowToPlayModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogFocusTrap(true, dialogRef)
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div className="how-to-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="how-to-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="how-to-title">
        <button type="button" aria-label="Close how to play" onClick={onClose}>×</button>
        <span>Classic Mode</span>
        <h2 id="how-to-title">How to Play</h2>
        <ol>
          {STEPS.map(([title, description], index) => <li key={title}><strong>{index + 1}</strong><span><b>{title}</b>{description}</span></li>)}
        </ol>
        <div className="how-to-modal__actions">
          <button className="how-to-modal__replay" type="button" onClick={onReplayTutorial}>Replay first-game tips</button>
          <button className="how-to-modal__done" type="button" onClick={onClose}>Got It</button>
        </div>
      </section>
    </div>
  )
}
