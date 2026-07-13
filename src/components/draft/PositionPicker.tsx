import { useEffect, useState } from 'react'
import type { Player, Position, Roster } from '../../types/draft'
import { getAvailablePositions } from '../../utils/draft'

interface PositionPickerProps {
  player: Player
  roster: Roster
  onCancel: () => void
  onConfirm: (position: Position) => void
}

export default function PositionPicker({ player, roster, onCancel, onConfirm }: PositionPickerProps) {
  const [position, setPosition] = useState<Position | null>(null)
  const availablePositions = getAvailablePositions(player, roster)

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
      <section className="position-picker" role="dialog" aria-modal="true" aria-labelledby="position-picker-title">
        <div className="position-picker__handle" aria-hidden="true" />
        <div className="position-picker__heading">
          <span>Assign position</span>
          <h2 id="position-picker-title">{player.name}</h2>
          <p>Choose one eligible roster slot.</p>
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
