import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SAMPLE_PLAYERS, TEAM_DECADES } from '../../data/samplePlayers'
import {
  POSITIONS,
  type Player,
  type Position,
  type PositionFilter,
  type Roster,
  type SortKey,
  type TeamDecadeCombination,
} from '../../types/draft'
import { getAvailablePositions } from '../../utils/draft'
import DraftHeader from './DraftHeader'
import PlayerList from './PlayerList'
import PositionPicker from './PositionPicker'
import ResultsScreen from './ResultsScreen'
import RosterBar from './RosterBar'
import './ClassicMode.css'

const FILTERS: PositionFilter[] = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP']
// A larger prototype draw deck allows 11 unique rounds while the five existing
// team player pools continue to supply sample cards.
const ROLL_DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']
const ROLL_TEAMS = TEAM_DECADES.map(({ team, teamName }) => ({ team, teamName }))
const FIRST_COMBINATION = TEAM_DECADES[0]

const ALL_ROLL_COMBINATIONS: TeamDecadeCombination[] = ROLL_TEAMS.flatMap(({ team, teamName }) => (
  ROLL_DECADES.map((decade) => ({ id: `${team.toLowerCase()}-${decade}`, team, teamName, decade }))
))

const HITTER_SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'war', label: 'WAR' },
  { value: 'opsPlus', label: 'OPS+' },
  { value: 'hr', label: 'Home runs' },
  { value: 'avg', label: 'Batting average' },
]

const PITCHER_SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'war', label: 'WAR' },
  { value: 'eraPlus', label: 'ERA+' },
  { value: 'era', label: 'ERA' },
  { value: 'so', label: 'Strikeouts' },
  { value: 'sv', label: 'Saves' },
]

interface ClassicModeProps {
  onHome: () => void
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function matchesFilter(player: Player, filter: PositionFilter) {
  if (filter === 'ALL') return true
  if (filter === 'OF') return player.eligiblePositions.some((position) => ['LF', 'CF', 'RF'].includes(position))
  if (filter === 'DH') return player.type === 'hitter' || player.isTwoWay === true
  return player.eligiblePositions.includes(filter as Position)
}

function statValue(player: Player, key: SortKey) {
  if (key === 'war') return player.stats.war
  if (player.type === 'hitter') {
    if (key === 'opsPlus') return player.stats.opsPlus
    if (key === 'hr') return player.stats.hr
    if (key === 'avg') return player.stats.avg
  }
  if (player.type === 'pitcher') {
    if (key === 'eraPlus') return player.stats.eraPlus
    if (key === 'era') return player.stats.era
    if (key === 'so') return player.stats.so
    if (key === 'sv') return player.stats.sv
  }
  return Number.NEGATIVE_INFINITY
}

export default function ClassicMode({ onHome }: ClassicModeProps) {
  const [roster, setRoster] = useState<Roster>({})
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PositionFilter>('ALL')
  const [sort, setSort] = useState<SortKey>('war')
  const [complete, setComplete] = useState(false)
  const [combination, setCombination] = useState<TeamDecadeCombination>(FIRST_COMBINATION)
  const [displayTeam, setDisplayTeam] = useState(FIRST_COMBINATION.team)
  const [displayDecade, setDisplayDecade] = useState(FIRST_COMBINATION.decade)
  const [isRolling, setIsRolling] = useState(false)
  const [committingPlayerId, setCommittingPlayerId] = useState<string | null>(null)
  const [recentlyFilledPosition, setRecentlyFilledPosition] = useState<Position | null>(null)

  const rosterRef = useRef(roster)
  const usedCombinationsRef = useRef(new Set<string>())
  const rollingRef = useRef(false)
  const assignmentLockRef = useRef(false)
  const rollTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rosterEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filledCount = Object.keys(roster).length
  const round = Math.min(filledCount + 1, POSITIONS.length)
  const draftedIds = useMemo(() => new Set(Object.values(roster).map((player) => player.id)), [roster])
  const sortOptions = filter === 'SP' || filter === 'RP' ? PITCHER_SORTS : filter === 'ALL' ? HITTER_SORTS.slice(0, 1) : HITTER_SORTS

  const clearRollTimers = useCallback(() => {
    rollTimersRef.current.forEach((timer) => clearTimeout(timer))
    rollTimersRef.current = []
  }, [])

  useEffect(() => {
    rosterRef.current = roster
  }, [roster])

  const beginRoundRoll = useCallback((rosterOverride?: Roster) => {
    if (rollingRef.current) return

    const activeRoster = rosterOverride ?? rosterRef.current
    const activeDraftedIds = new Set(Object.values(activeRoster).map((player) => player.id))
    const teamHasValidPlayer = (team: string) => SAMPLE_PLAYERS.some((player) => (
      player.team === team
      && !activeDraftedIds.has(player.id)
      && getAvailablePositions(player, activeRoster).length > 0
    ))
    const candidates = ALL_ROLL_COMBINATIONS.filter((candidate) => {
      if (usedCombinationsRef.current.has(candidate.id)) return false
      return teamHasValidPlayer(candidate.team)
    })

    if (candidates.length === 0) {
      assignmentLockRef.current = false
      return
    }

    const target = randomItem(candidates)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rollingRef.current = true
    setIsRolling(true)
    setSelectedPlayer(null)
    clearRollTimers()

    const reveal = () => {
      setDisplayTeam(target.team)
      setDisplayDecade(target.decade)
      setCombination(target)
      usedCombinationsRef.current.add(target.id)
      rollingRef.current = false
      assignmentLockRef.current = false
      setIsRolling(false)
      rollTimersRef.current = []
    }

    if (reducedMotion) {
      rollTimersRef.current.push(setTimeout(reveal, 180))
      return
    }

    const delays = [55, 60, 65, 75, 90, 110, 135, 155, 180]
    let elapsed = 0
    delays.forEach((delay, index) => {
      elapsed += delay
      rollTimersRef.current.push(setTimeout(() => {
        if (index === delays.length - 1) {
          reveal()
          return
        }
        setDisplayTeam(randomItem(ROLL_TEAMS).team)
        setDisplayDecade(randomItem(ROLL_DECADES))
      }, elapsed))
    })
  }, [clearRollTimers])

  useEffect(() => {
    beginRoundRoll()
    return () => {
      clearRollTimers()
      rollingRef.current = false
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
      if (rosterEffectTimerRef.current) clearTimeout(rosterEffectTimerRef.current)
      if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current)
    }
  }, [beginRoundRoll, clearRollTimers])

  const players = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return SAMPLE_PLAYERS
      .filter((player) => player.team === combination.team)
      .filter((player) => !draftedIds.has(player.id))
      .map((player) => ({ ...player, decade: combination.decade }))
      .filter((player) => matchesFilter(player, filter))
      .filter((player) => !term || player.name.toLocaleLowerCase().includes(term))
      .sort((a, b) => {
        const aValue = statValue(a, sort)
        const bValue = statValue(b, sort)
        return sort === 'era' ? aValue - bValue : bValue - aValue
      })
  }, [combination, draftedIds, filter, search, sort])

  const interactionsDisabled = isRolling || committingPlayerId !== null

  const selectPlayer = useCallback((player: Player) => {
    if (interactionsDisabled || assignmentLockRef.current || getAvailablePositions(player, roster).length === 0) return
    setSelectedPlayer(player)
  }, [interactionsDisabled, roster])

  const choosePosition = (position: Position) => {
    if (assignmentLockRef.current || interactionsDisabled || !selectedPlayer) return
    if (roster[position] || !getAvailablePositions(selectedPlayer, roster).includes(position)) return

    assignmentLockRef.current = true
    const committedPlayer = selectedPlayer
    setCommittingPlayerId(committedPlayer.id)
    setSelectedPlayer(null)
    const commitDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 300
    commitTimerRef.current = setTimeout(() => {
      const nextRoster = { ...rosterRef.current, [position]: committedPlayer }
      rosterRef.current = nextRoster
      setRoster(nextRoster)
      setRecentlyFilledPosition(position)
      setSearch('')
      setFilter('ALL')
      setSort('war')
      rosterEffectTimerRef.current = setTimeout(() => setRecentlyFilledPosition(null), 850)

      if (Object.keys(nextRoster).length === POSITIONS.length) {
        resultsTimerRef.current = setTimeout(() => {
          setCommittingPlayerId(null)
          setComplete(true)
        }, 600)
        return
      }
      setCommittingPlayerId(null)
      beginRoundRoll(nextRoster)
    }, commitDuration)
  }

  const resetGame = () => {
    const emptyRoster: Roster = {}
    clearRollTimers()
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    if (rosterEffectTimerRef.current) clearTimeout(rosterEffectTimerRef.current)
    if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current)
    usedCombinationsRef.current.clear()
    rollingRef.current = false
    assignmentLockRef.current = false
    rosterRef.current = emptyRoster
    setRoster(emptyRoster)
    setSelectedPlayer(null)
    setSearch('')
    setFilter('ALL')
    setSort('war')
    setCombination(FIRST_COMBINATION)
    setDisplayTeam(FIRST_COMBINATION.team)
    setDisplayDecade(FIRST_COMBINATION.decade)
    setCommittingPlayerId(null)
    setRecentlyFilledPosition(null)
    setComplete(false)
    beginRoundRoll(emptyRoster)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (complete) return <ResultsScreen roster={roster} onPlayAgain={resetGame} onHome={onHome} />

  return (
    <main className={`classic-page${isRolling ? ' is-rolling' : ''}`}>
      <div className="classic-page__atmosphere" aria-hidden="true" />
      <div className="classic-shell">
        <DraftHeader
          round={round}
          totalRounds={POSITIONS.length}
          combination={combination}
          displayTeam={displayTeam}
          displayDecade={displayDecade}
          isRolling={isRolling}
        />

        <section className="draft-board" aria-labelledby="draft-board-title" aria-busy={isRolling}>
          <div className="draft-board__heading">
            <div><span>{isRolling ? 'Drawing matchup' : 'Available players'}</span><h1 id="draft-board-title">{isRolling ? 'Rolling…' : 'Make your pick'}</h1></div>
            <small>{players.length} players</small>
          </div>

          <div className="draft-controls">
            <label className="draft-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.25" /><path d="m15.2 15.2 4.2 4.2" /></svg>
              <input disabled={interactionsDisabled} value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search players" />
            </label>
            <label className="draft-sort">
              <span>Sort</span>
              <select disabled={interactionsDisabled} value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <div className="position-filters" aria-label="Filter players by position">
            {FILTERS.map((positionFilter) => (
              <button
                className={filter === positionFilter ? 'is-active' : ''}
                disabled={interactionsDisabled}
                key={positionFilter}
                type="button"
                onClick={() => {
                  setFilter(positionFilter)
                  setSort('war')
                }}
              >{positionFilter}</button>
            ))}
          </div>

          <PlayerList
            players={players}
            roster={roster}
            interactionsDisabled={interactionsDisabled}
            committingPlayerId={committingPlayerId}
            onSelect={selectPlayer}
          />
        </section>
      </div>

      <RosterBar roster={roster} recentlyFilledPosition={recentlyFilledPosition} />
      {selectedPlayer && !interactionsDisabled && (
        <PositionPicker player={selectedPlayer} roster={roster} onCancel={() => setSelectedPlayer(null)} onConfirm={choosePosition} />
      )}
    </main>
  )
}
