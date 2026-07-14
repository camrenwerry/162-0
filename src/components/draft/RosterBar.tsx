import { ROSTER_SLOTS, type Roster, type RosterSlotId } from '../../types/draft'

interface RosterBarProps {
  roster: Roster
  recentlyFilledPosition: RosterSlotId | null
}

function surname(name: string) {
  const parts = name.split(' ')
  const last = parts[parts.length - 1]
  return /^(Jr\.|Sr\.|II|III)$/.test(last) ? parts[parts.length - 2] : last
}

export default function RosterBar({ roster, recentlyFilledPosition }: RosterBarProps) {
  const filled = Object.keys(roster).length

  return (
    <aside className="roster-bar" aria-label={`Roster, ${filled} of ${ROSTER_SLOTS.length} positions filled`}>
      <div className="roster-bar__summary">
        <span>Your Roster</span>
        <strong>{filled}<i>/</i>{ROSTER_SLOTS.length}</strong>
      </div>
      <div className="roster-bar__slots">
        {ROSTER_SLOTS.map((slot) => {
          const player = roster[slot.id]
          return (
            <div className={`${player ? 'is-filled' : ''}${recentlyFilledPosition === slot.id ? ' is-new' : ''}`} key={slot.id}>
              <strong>{slot.label}</strong>
              {player && <span>{surname(player.name)}</span>}
              {player && <small>{player.team} · {player.decade}</small>}
              {recentlyFilledPosition === slot.id && <i aria-hidden="true">✓</i>}
            </div>
          )
        })}
      </div>
      <div className="roster-how">
        <strong>How It Works</strong>
        <ol>
          <li><i>1</i><span>Receive a random team and decade.</span></li>
          <li><i>2</i><span>Draft one eligible player.</span></li>
          <li><i>3</i><span>Fill every open roster position.</span></li>
          <li><i>4</i><span>Complete your Diamond Draft.</span></li>
        </ol>
      </div>
    </aside>
  )
}
