import type { TeamDecadeCombination } from '../../types/draft'

interface TeamDecadeRevealProps {
  combination: TeamDecadeCombination
  displayTeam: string
  displayDecade: string
  rollingMode: 'both' | 'team' | 'era' | null
}

export default function TeamDecadeReveal({ combination, displayTeam, displayDecade, rollingMode }: TeamDecadeRevealProps) {
  const teamIsRolling = rollingMode === 'both' || rollingMode === 'team'
  const eraIsRolling = rollingMode === 'both' || rollingMode === 'era'

  return (
    <section className="team-decade-reveal" aria-label={`${combination.teamName}, ${combination.decade}`}>
      <div className="reveal-badge reveal-badge--team">
        <span>Team</span>
        <div className="team-emblem" aria-hidden="true">
          <i /><i /><i /><i />
        </div>
        <strong key={combination.team} className={teamIsRolling ? 'is-rolling' : 'is-landed'}>{displayTeam}</strong>
        <small>{combination.teamName}</small>
      </div>
      <span className="reveal-multiplier" aria-hidden="true">×</span>
      <div className="reveal-badge reveal-badge--era">
        <span>Decade</span>
        <strong key={combination.decade} className={eraIsRolling ? 'is-rolling' : 'is-landed'}>{displayDecade}</strong>
        <small>Player era</small>
      </div>
    </section>
  )
}
