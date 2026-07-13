import { POSITIONS, type Roster } from '../../types/draft'

interface RosterBarProps {
  roster: Roster
}

function surname(name: string) {
  const parts = name.split(' ')
  const last = parts[parts.length - 1]
  return /^(Jr\.|Sr\.|II|III)$/.test(last) ? parts[parts.length - 2] : last
}

export default function RosterBar({ roster }: RosterBarProps) {
  const filled = Object.keys(roster).length

  return (
    <aside className="roster-bar" aria-label={`Roster, ${filled} of ${POSITIONS.length} positions filled`}>
      <div className="roster-bar__summary">
        <span>Your roster</span>
        <strong>{filled}<i>/</i>{POSITIONS.length}</strong>
      </div>
      <div className="roster-bar__slots">
        {POSITIONS.map((position) => (
          <div className={roster[position] ? 'is-filled' : ''} key={position}>
            <strong>{position}</strong>
            {roster[position] && <span>{surname(roster[position].name)}</span>}
          </div>
        ))}
      </div>
    </aside>
  )
}
