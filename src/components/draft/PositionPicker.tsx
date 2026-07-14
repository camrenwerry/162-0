import { useEffect, useRef, useState } from 'react'
import { useDialogFocusTrap } from '../useDialogFocusTrap'
import type { Player, Position } from '../../types/draft'

interface PositionPickerProps {
  player: Player
  availablePositions: readonly Position[]
  onCancel: () => void
  onConfirm: (position: Position) => void
}

export default function PositionPicker({ player, availablePositions, onCancel, onConfirm }: PositionPickerProps) {
  const [position, setPosition] = useState<Position | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useDialogFocusTrap(true, dialogRef)

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return (
    <div className="picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="position-picker" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="position-picker-title">
        <div className="position-picker__handle" aria-hidden="true" />
        <button className="position-picker__close" type="button" aria-label="Close position picker" onClick={onCancel}>×</button>
        <div className="position-picker__heading">
          <span>{player.name}</span>
          <h2 id="position-picker-title">Choose a Position</h2>
          <p>Select an available position for this player.</p>
        </div>
        <div className="position-picker__options">
          {availablePositions.map((eligiblePosition) => (
            <button
              key={eligiblePosition}
              className={position === eligiblePosition ? 'is-selected' : ''}
              type="button"
              onClick={() => setPosition(eligiblePosition)}
            >
              <strong>{eligiblePosition}</strong>
              <span>{eligiblePosition === 'DH' && !player.eligiblePositions.includes('DH') ? 'Hitter utility slot' : 'Available'}</span>
            </button>
          ))}
        </div>
        <div className="position-picker__actions">
          <button className="picker-cancel" type="button" onClick={onCancel}>Cancel</button>
          <button className="picker-confirm" type="button" disabled={!position} onClick={() => {
            if (position) onConfirm(position)
          }}>Add to roster</button>
        </div>
      </section>
    </div>
  )
}
