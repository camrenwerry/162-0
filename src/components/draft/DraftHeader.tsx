import Logo162 from '../Logo162'
import type { TeamDecadeCombination } from '../../types/draft'

interface DraftHeaderProps {
  round: number
  totalRounds: number
  combination: TeamDecadeCombination
  displayTeam: string
  displayDecade: string
  isRolling: boolean
}

export default function DraftHeader({
  round,
  totalRounds,
  combination,
  displayTeam,
  displayDecade,
  isRolling,
}: DraftHeaderProps) {
  return (
    <header className="classic-header">
      <div className="classic-header__top">
        <Logo162 className="classic-header__logo" />
        <div className="classic-header__round">
          <span>Round</span>
          <strong>{round} <i>of</i> {totalRounds}</strong>
        </div>
      </div>

      <div className="matchup-card">
        <div className="matchup-card__identity">
          <span className="matchup-card__label">On the clock</span>
          <div className={`matchup-card__badges${isRolling ? ' is-rolling' : ''}`} aria-live="polite">
            <strong>{displayTeam}</strong>
            <span>{displayDecade}</span>
          </div>
          <small>{combination.teamName}</small>
        </div>
      </div>
    </header>
  )
}
