import { useEffect, useState } from 'react'
import './GameMenu.css'

export interface GameMenuProps {
  onHome: () => void
  onRestart: () => void
  confirmHome?: boolean
  className?: string
}

type Confirmation = 'home' | 'restart' | null

export default function GameMenu({ onHome, onRestart, confirmHome = true, className }: GameMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)

  useEffect(() => {
    if (!isOpen && !confirmation) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setConfirmation(null)
      setIsOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [confirmation, isOpen])

  const chooseHome = () => {
    setIsOpen(false)
    if (confirmHome) setConfirmation('home')
    else onHome()
  }

  const chooseRestart = () => {
    setIsOpen(false)
    setConfirmation('restart')
  }

  const confirmAction = () => {
    const action = confirmation
    setConfirmation(null)
    if (action === 'home') onHome()
    if (action === 'restart') onRestart()
  }

  return (
    <div className={`game-menu${className ? ` ${className}` : ''}`}>
      <button
        className="game-menu__trigger"
        type="button"
        aria-label="Game menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span /><span /><span />
      </button>

      {isOpen && (
        <>
          <button className="game-menu__dismiss" type="button" aria-label="Close game menu" onClick={() => setIsOpen(false)} />
          <div className="game-menu__popover">
            <span>Game menu</span>
            <button type="button" onClick={chooseHome}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 9 7-6 7 6v8h-5v-5H8v5H3Z" /></svg>
              Home
            </button>
            <button type="button" onClick={chooseRestart}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.7 7.2A6.2 6.2 0 1 0 16 12M15.7 3.8v3.7h-3.8" /></svg>
              Restart Game
            </button>
          </div>
        </>
      )}

      {confirmation && (
        <div className="game-confirmation" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmation(null)
        }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="game-confirmation-title" aria-describedby="game-confirmation-message">
            <span>{confirmation === 'home' ? 'Exit draft' : 'New draft'}</span>
            <h2 id="game-confirmation-title">{confirmation === 'home' ? 'Leave this game?' : 'Restart this game?'}</h2>
            <p id="game-confirmation-message">
              {confirmation === 'home' ? 'Your current draft will be lost.' : 'Your current roster and progress will be lost.'}
            </p>
            <div>
              <button className="game-confirmation__cancel" type="button" onClick={() => setConfirmation(null)}>
                {confirmation === 'home' ? 'Stay' : 'Cancel'}
              </button>
              <button className="game-confirmation__confirm" type="button" onClick={confirmAction}>
                {confirmation === 'home' ? 'Leave Game' : 'Restart'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
