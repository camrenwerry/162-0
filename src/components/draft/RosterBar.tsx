import { useEffect, useId, useRef, useState } from 'react'
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
  const [overviewExpanded, setOverviewExpanded] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const overviewId = useId()
  const disclosureRef = useRef<HTMLButtonElement>(null)
  const compactSlotsRef = useRef<HTMLDivElement>(null)
  const compactSlotRefs = useRef<Partial<Record<RosterSlotId, HTMLDivElement>>>({})
  const previousRosterRef = useRef<Roster | null>(null)

  useEffect(() => {
    const previousRoster = previousRosterRef.current
    previousRosterRef.current = roster
    if (!previousRoster) return

    const newlyFilledSlot = ROSTER_SLOTS.find(({ id }) => !previousRoster[id] && roster[id])
    if (!newlyFilledSlot) return

    const player = roster[newlyFilledSlot.id]
    if (!player) return
    setAnnouncement(`${player.name} added to ${newlyFilledSlot.id}. ${filled} of ${ROSTER_SLOTS.length} positions filled.`)

    if (overviewExpanded || window.innerWidth >= 900) return
    const scrollContainer = compactSlotsRef.current
    const slotElement = compactSlotRefs.current[newlyFilledSlot.id]
    if (!scrollContainer || !slotElement) return

    const visibleStart = scrollContainer.scrollLeft
    const visibleEnd = visibleStart + scrollContainer.clientWidth
    const slotStart = slotElement.offsetLeft
    const slotEnd = slotStart + slotElement.offsetWidth
    if (slotStart >= visibleStart && slotEnd <= visibleEnd) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scrollContainer.scrollTo({
      left: Math.max(0, slotStart - ((scrollContainer.clientWidth - slotElement.offsetWidth) / 2)),
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }, [filled, overviewExpanded, roster])

  const collapseOverview = () => {
    setOverviewExpanded(false)
    disclosureRef.current?.focus()
  }

  return (
    <aside
      className={`roster-bar${overviewExpanded ? ' is-overview-expanded' : ''}`}
      aria-label={`Roster, ${filled} of ${ROSTER_SLOTS.length} positions filled`}
      onKeyDown={(event) => {
        if (overviewExpanded && event.key === 'Escape') {
          event.preventDefault()
          collapseOverview()
        }
      }}
    >
      <div className="roster-bar__summary">
        <span>Your Roster</span>
        <button
          aria-controls={overviewId}
          aria-expanded={overviewExpanded}
          className="roster-bar__disclosure"
          onClick={() => setOverviewExpanded((expanded) => !expanded)}
          ref={disclosureRef}
          type="button"
        >
          {overviewExpanded ? 'Hide full roster' : 'View full roster'}
          <i aria-hidden="true">⌃</i>
        </button>
        <strong>{filled}<i>/</i>{ROSTER_SLOTS.length}</strong>
      </div>
      <div className="roster-bar__overview" hidden={!overviewExpanded} id={overviewId}>
        <div className="roster-bar__overview-grid" role="list" aria-label="Full roster positions">
          {ROSTER_SLOTS.map((slot) => {
            const player = roster[slot.id]
            return (
              <div className={player ? 'is-filled' : ''} key={slot.id} role="listitem" aria-label={`${slot.id}, ${player ? player.name : 'open slot'}`}>
                <strong>{slot.id}</strong>
                <span className={player ? '' : 'is-empty'}>{player ? surname(player.name) : 'Open slot'}</span>
                <small>{player ? `${player.team} · ${player.decade}` : 'Waiting for a player'}</small>
              </div>
            )
          })}
        </div>
      </div>
      <div className="roster-bar__slots" ref={compactSlotsRef} role="list" aria-label="Roster positions">
        {ROSTER_SLOTS.map((slot) => {
          const player = roster[slot.id]
          return (
            <div
              className={`${player ? 'is-filled' : ''}${recentlyFilledPosition === slot.id ? ' is-new' : ''}`}
              key={slot.id}
              ref={(element) => {
                if (element) compactSlotRefs.current[slot.id] = element
                else delete compactSlotRefs.current[slot.id]
              }}
              role="listitem"
              aria-label={`${slot.id}, ${player ? player.name : 'open'}`}
            >
              <strong>{slot.id}</strong>
              {player && <span>{surname(player.name)}</span>}
              {player && <small>{player.team} · {player.decade}</small>}
              {recentlyFilledPosition === slot.id && <i aria-hidden="true">✓</i>}
            </div>
          )
        })}
      </div>
      <p className="roster-bar__announcement" aria-atomic="true" aria-live="polite">{announcement}</p>
      <div className="roster-how">
        <strong>How It Works</strong>
        <ol>
          <li><i>1</i><span>Receive a random team and decade.</span></li>
          <li><i>2</i><span>Draft one eligible player.</span></li>
          <li><i>3</i><span>Fill every open roster position.</span></li>
          <li><i>4</i><span>Complete your Pennant Pursuit roster.</span></li>
        </ol>
      </div>
    </aside>
  )
}
