import { POSITIONS, type Position, type Roster } from '../../types/draft'

interface RosterBarProps {
  roster: Roster
  recentlyFilledPosition: Position | null
}

function surname(name: string) {
  const parts = name.split(' ')
  const last = parts[parts.length - 1]
  return /^(Jr\.|Sr\.|II|III)$/.test(last) ? parts[parts.length - 2] : last
}

export default function RosterBar({ roster, recentlyFilledPosition }: RosterBarProps) {
  const filled = Object.keys(roster).length

  return (
    <aside className="roster-bar" aria-label={`Roster, ${filled} of ${POSITIONS.length} positions filled`}>
      <div className="roster-bar__summary">
        <span>Your roster</span>
        <strong>{filled}<i>/</i>{POSITIONS.length}</strong>
      </div>
      <div className="roster-bar__slots">
        {POSITIONS.map((position) => (
          <div className={`${roster[position] ? 'is-filled' : ''}${recentlyFilledPosition === position ? ' is-new' : ''}`} key={position}>
            <strong>{position}</strong>
            {roster[position] && <span>{surname(roster[position].name)}</span>}
            {recentlyFilledPosition === position && <i aria-hidden="true">✓</i>}
          </div>
        ))}
      </div>
    </aside>
  )
}
