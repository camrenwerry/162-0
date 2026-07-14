import type { ReactNode } from 'react'

interface DraftHeaderProps {
  round: number
  totalRounds: number
  teamRerollAvailable: boolean
  eraRerollAvailable: boolean
  interactionsDisabled: boolean
  onTeamReroll: () => void
  onEraReroll: () => void
  menu: ReactNode
}

function RollIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.7 7.2A6.2 6.2 0 1 0 16 12M15.7 3.8v3.7h-3.8" /></svg>
}

export default function DraftHeader({
  round,
  totalRounds,
  teamRerollAvailable,
  eraRerollAvailable,
  interactionsDisabled,
  onTeamReroll,
  onEraReroll,
  menu,
}: DraftHeaderProps) {
  return (
    <header className="dd-draft-header">
      {menu}
      <div className="dd-draft-header__round">
        <strong>Round {round}</strong>
        <span>of {totalRounds}</span>
      </div>
      <div className="dd-draft-header__rerolls" aria-label="Game rerolls">
        <button className="team-reroll" type="button" disabled={interactionsDisabled || !teamRerollAvailable} onClick={onTeamReroll}>
          <RollIcon /><span>Team <small>{teamRerollAvailable ? 'Available' : 'Used'}</small></span>
        </button>
        <button className="era-reroll" type="button" disabled={interactionsDisabled || !eraRerollAvailable} onClick={onEraReroll}>
          <RollIcon /><span>Era <small>{eraRerollAvailable ? 'Available' : 'Used'}</small></span>
        </button>
      </div>
    </header>
  )
}
