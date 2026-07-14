import { useEffect, useRef } from 'react'
import { useDialogFocusTrap } from '../useDialogFocusTrap'

interface HowToPlayModalProps {
  onClose: () => void
}

const STEPS = [
  'Receive a random team and decade.',
  'Select one eligible player.',
  'Assign them to an open position.',
  'Build a 14-player roster.',
  'Complete the draft and receive a projected result.',
]

export default function HowToPlayModal({ onClose }: HowToPlayModalProps) {
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
          {STEPS.map((step, index) => <li key={step}><strong>{index + 1}</strong><span>{step}</span></li>)}
        </ol>
        <button className="how-to-modal__done" type="button" onClick={onClose}>Got It</button>
      </section>
    </div>
  )
}
