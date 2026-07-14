import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BETA_PLAYERS, TEAM_DECADES } from '../../data/mlb'
import {
  POSITIONS,
  ROSTER_SLOTS,
  type Player,
  type Position,
  type PositionFilter,
  type Roster,
  type RosterSlotId,
  type SortKey,
  type TeamDecadeCombination,
} from '../../types/draft'
import { getAvailablePositions, getFirstOpenSlot } from '../../utils/draft'
import GameMenu from '../GameMenu'
import DraftHeader from './DraftHeader'
import FranchiseProfile from './FranchiseProfile'
import PlayerList from './PlayerList'
import PositionPicker from './PositionPicker'
import ResultsScreen from './ResultsScreen'
import RosterBar from './RosterBar'
import TeamDecadeReveal from './TeamDecadeReveal'
import './ClassicMode.css'

const FILTERS: PositionFilter[] = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP']
const ROLL_DECADES = [...new Set(TEAM_DECADES.map(({ decade }) => decade))]
const ROLL_TEAMS = [...new Map(TEAM_DECADES.map(({ franchiseId, team, teamName }) => (
  [franchiseId, { franchiseId, team, teamName }]
))).values()]
const FIRST_COMBINATION = TEAM_DECADES[0]
const ALL_ROLL_COMBINATIONS = TEAM_DECADES

interface SortOption { value: SortKey; label: string }

const UNIVERSAL_SORTS: SortOption[] = [
  { value: 'war', label: 'WAR' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'position', label: 'Position' },
]

const HITTER_STAT_SORTS: SortOption[] = [
  { value: 'opsPlus', label: 'OPS+' },
  { value: 'hr', label: 'HR' },
  { value: 'avg', label: 'AVG' },
  { value: 'obp', label: 'OBP' },
  { value: 'slg', label: 'SLG' },
  { value: 'rbi', label: 'RBI' },
  { value: 'sb', label: 'SB' },
]

const HITTER_SORTS: SortOption[] = [
  { value: 'war', label: 'WAR' },
  ...HITTER_STAT_SORTS,
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'position', label: 'Position' },
]

const PITCHER_STAT_SORTS: SortOption[] = [
  { value: 'eraPlus', label: 'ERA+' },
  { value: 'era', label: 'ERA' },
  { value: 'whip', label: 'WHIP' },
  { value: 'so', label: 'SO' },
  { value: 'wins', label: 'W' },
  { value: 'sv', label: 'SV' },
]

const PITCHER_SORTS: SortOption[] = [
  { value: 'war', label: 'WAR' },
  ...PITCHER_STAT_SORTS,
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'position', label: 'Position' },
]

const ALL_SORTS: SortOption[] = [...UNIVERSAL_SORTS, ...HITTER_STAT_SORTS, ...PITCHER_STAT_SORTS]
const HITTER_SORT_KEYS = new Set<SortKey>(HITTER_STAT_SORTS.map(({ value }) => value))
const PITCHER_SORT_KEYS = new Set<SortKey>(PITCHER_STAT_SORTS.map(({ value }) => value))

const POSITION_SORT_ORDER = new Map(POSITIONS.map((position, index) => [position, index]))
const ASCENDING_SORTS = new Set<SortKey>(['era', 'whip', 'name', 'position'])

function sortOptionsForFilter(filter: PositionFilter) {
  if (filter === 'ALL') return ALL_SORTS
  if (filter === 'SP' || filter === 'RP') return PITCHER_SORTS
  return HITTER_SORTS
}

interface ClassicModeProps {
  onHome: () => void
}

type RollMode = 'both' | 'team' | 'era'

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function matchesFilter(player: Player, filter: PositionFilter) {
  if (filter === 'ALL') return true
  if (filter === 'OF') return player.eligiblePositions.some((position) => ['LF', 'CF', 'RF'].includes(position))
  if (filter === 'DH') return player.type === 'hitter' || player.isTwoWay === true
  return player.eligiblePositions.includes(filter as Position)
}

function matchesAllSortType(player: Player, filter: PositionFilter, sort: SortKey) {
  if (filter !== 'ALL') return true
  if (HITTER_SORT_KEYS.has(sort)) return player.type === 'hitter'
  if (PITCHER_SORT_KEYS.has(sort)) return player.type === 'pitcher'
  return true
}

function statValue(player: Player, key: SortKey): number | string | null {
  if (key === 'name') return player.name
  if (key === 'position') return Math.min(...player.eligiblePositions.map((position) => POSITION_SORT_ORDER.get(position) ?? 99))
  if (key === 'war') return player.stats.war
  if (player.type === 'hitter') {
    if (key === 'opsPlus') return player.stats.opsPlus
    if (key === 'hr') return player.stats.hr
    if (key === 'avg') return player.stats.avg
    if (key === 'obp') return player.stats.obp
    if (key === 'slg') return player.stats.slg
    if (key === 'rbi') return player.stats.rbi
    if (key === 'sb') return player.stats.sb
  }
  if (player.type === 'pitcher') {
    if (key === 'eraPlus') return player.stats.eraPlus
    if (key === 'era') return player.stats.era
    if (key === 'whip') return player.stats.whip
    if (key === 'so') return player.stats.so
    if (key === 'wins') return player.stats.wins
    if (key === 'sv') return player.stats.sv
  }
  return null
}

function comparePlayers(a: Player, b: Player, key: SortKey) {
  const aValue = statValue(a, key)
  const bValue = statValue(b, key)
  if (aValue === null && bValue === null) return a.name.localeCompare(b.name)
  if (aValue === null) return 1
  if (bValue === null) return -1
  const primary = typeof aValue === 'string' && typeof bValue === 'string'
    ? aValue.localeCompare(bValue)
    : Number(aValue) - Number(bValue)
  const directed = ASCENDING_SORTS.has(key) ? primary : -primary
  return directed || a.name.localeCompare(b.name)
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
  const [rollingMode, setRollingMode] = useState<RollMode | null>(null)
  const [teamRerollAvailable, setTeamRerollAvailable] = useState(true)
  const [eraRerollAvailable, setEraRerollAvailable] = useState(true)
  const [committingPlayerId, setCommittingPlayerId] = useState<string | null>(null)
  const [recentlyFilledPosition, setRecentlyFilledPosition] = useState<RosterSlotId | null>(null)

  const rosterRef = useRef(roster)
  const currentCombinationRef = useRef(combination)
  const usedCombinationsRef = useRef(new Set<string>())
  const teamRerollAvailableRef = useRef(true)
  const eraRerollAvailableRef = useRef(true)
  const rollingRef = useRef(false)
  const assignmentLockRef = useRef(false)
  const rollTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rosterEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filledCount = Object.keys(roster).length
  const round = Math.min(filledCount + 1, ROSTER_SLOTS.length)
  const draftedIds = useMemo(() => new Set(Object.values(roster).map((player) => player.id)), [roster])
  const sortOptions = sortOptionsForFilter(filter)

  const clearRollTimers = useCallback(() => {
    rollTimersRef.current.forEach((timer) => clearTimeout(timer))
    rollTimersRef.current = []
  }, [])

  useEffect(() => {
    rosterRef.current = roster
  }, [roster])

  const beginRoundRoll = useCallback((mode: RollMode = 'both', rosterOverride?: Roster) => {
    if (rollingRef.current) return false

    const activeRoster = rosterOverride ?? rosterRef.current
    const activeCombination = currentCombinationRef.current
    const activeDraftedIds = new Set(Object.values(activeRoster).map((player) => player.id))
    const combinationHasValidPlayer = (candidate: TeamDecadeCombination) => BETA_PLAYERS.some((player) => (
      player.franchiseId === candidate.franchiseId
      && player.decade === candidate.decade
      && !activeDraftedIds.has(player.id)
      && getAvailablePositions(player, activeRoster).length > 0
    ))
    const candidates = ALL_ROLL_COMBINATIONS.filter((candidate) => {
      if (usedCombinationsRef.current.has(candidate.id)) return false
      if (mode === 'team' && candidate.decade !== activeCombination.decade) return false
      if (mode === 'era' && candidate.franchiseId !== activeCombination.franchiseId) return false
      if (mode === 'both' && teamRerollAvailableRef.current) {
        const decadeUseCount = ALL_ROLL_COMBINATIONS.filter((combinationOption) => (
          combinationOption.decade === candidate.decade && usedCombinationsRef.current.has(combinationOption.id)
        )).length
        if (decadeUseCount >= ROLL_TEAMS.length - 1) return false
      }
      if (mode === 'both' && eraRerollAvailableRef.current) {
        const teamUseCount = ALL_ROLL_COMBINATIONS.filter((combinationOption) => (
          combinationOption.team === candidate.team && usedCombinationsRef.current.has(combinationOption.id)
        )).length
        if (teamUseCount >= ROLL_DECADES.length - 1) return false
      }
      return combinationHasValidPlayer(candidate)
    })

    if (candidates.length === 0) {
      assignmentLockRef.current = false
      return false
    }

    const target = randomItem(candidates)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rollingRef.current = true
    setIsRolling(true)
    setRollingMode(mode)
    setSelectedPlayer(null)
    clearRollTimers()

    const reveal = () => {
      setDisplayTeam(target.team)
      setDisplayDecade(target.decade)
      setCombination(target)
      currentCombinationRef.current = target
      usedCombinationsRef.current.add(target.id)
      rollingRef.current = false
      assignmentLockRef.current = false
      setIsRolling(false)
      setRollingMode(null)
      rollTimersRef.current = []
    }

    if (reducedMotion) {
      rollTimersRef.current.push(setTimeout(reveal, 180))
      return true
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
        if (mode !== 'era') setDisplayTeam(randomItem(ROLL_TEAMS).team)
        if (mode !== 'team') setDisplayDecade(randomItem(ROLL_DECADES))
      }, elapsed))
    })
    return true
  }, [clearRollTimers])

  useEffect(() => {
    beginRoundRoll('both')
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
    return BETA_PLAYERS
      .filter((player) => player.franchiseId === combination.franchiseId && player.decade === combination.decade)
      .filter((player) => !draftedIds.has(player.id))
      .filter((player) => matchesFilter(player, filter))
      .filter((player) => matchesAllSortType(player, filter, sort))
      .filter((player) => !term || player.name.toLocaleLowerCase().includes(term))
      .sort((a, b) => comparePlayers(a, b, sort))
  }, [combination, draftedIds, filter, search, sort])

  const interactionsDisabled = isRolling || committingPlayerId !== null
  const allSortType = filter === 'ALL'
    ? HITTER_SORT_KEYS.has(sort) ? 'Hitters' : PITCHER_SORT_KEYS.has(sort) ? 'Pitchers' : null
    : null

  const selectPlayer = useCallback((player: Player) => {
    if (interactionsDisabled || assignmentLockRef.current || getAvailablePositions(player, roster).length === 0) return
    setSelectedPlayer(player)
  }, [interactionsDisabled, roster])

  const choosePosition = (position: Position) => {
    if (assignmentLockRef.current || interactionsDisabled || !selectedPlayer) return
    if (!getAvailablePositions(selectedPlayer, roster).includes(position)) return

    const slot = getFirstOpenSlot(position, roster)
    if (!slot || roster[slot]) return

    assignmentLockRef.current = true
    const committedPlayer = selectedPlayer
    setCommittingPlayerId(committedPlayer.id)
    setSelectedPlayer(null)
    const commitDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 300
    commitTimerRef.current = setTimeout(() => {
      const nextRoster = { ...rosterRef.current, [slot]: committedPlayer }
      rosterRef.current = nextRoster
      setRoster(nextRoster)
      setRecentlyFilledPosition(slot)
      setSearch('')
      setFilter('ALL')
      setSort((currentSort) => ALL_SORTS.some((option) => option.value === currentSort) ? currentSort : 'war')
      rosterEffectTimerRef.current = setTimeout(() => setRecentlyFilledPosition(null), 850)

      if (Object.keys(nextRoster).length === ROSTER_SLOTS.length) {
        resultsTimerRef.current = setTimeout(() => {
          setCommittingPlayerId(null)
          setComplete(true)
        }, 600)
        return
      }
      setCommittingPlayerId(null)
      beginRoundRoll('both', nextRoster)
    }, commitDuration)
  }

  const useTeamReroll = () => {
    if (!teamRerollAvailableRef.current || interactionsDisabled) return
    if (!beginRoundRoll('team')) return
    teamRerollAvailableRef.current = false
    setTeamRerollAvailable(false)
  }

  const useEraReroll = () => {
    if (!eraRerollAvailableRef.current || interactionsDisabled) return
    if (!beginRoundRoll('era')) return
    eraRerollAvailableRef.current = false
    setEraRerollAvailable(false)
  }

  const resetGame = () => {
    const emptyRoster: Roster = {}
    clearRollTimers()
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    if (rosterEffectTimerRef.current) clearTimeout(rosterEffectTimerRef.current)
    if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current)
    usedCombinationsRef.current.clear()
    teamRerollAvailableRef.current = true
    eraRerollAvailableRef.current = true
    rollingRef.current = false
    assignmentLockRef.current = false
    rosterRef.current = emptyRoster
    currentCombinationRef.current = FIRST_COMBINATION
    setRoster(emptyRoster)
    setSelectedPlayer(null)
    setSearch('')
    setFilter('ALL')
    setSort('war')
    setCombination(FIRST_COMBINATION)
    setDisplayTeam(FIRST_COMBINATION.team)
    setDisplayDecade(FIRST_COMBINATION.decade)
    setRollingMode(null)
    setTeamRerollAvailable(true)
    setEraRerollAvailable(true)
    setCommittingPlayerId(null)
    setRecentlyFilledPosition(null)
    setComplete(false)
    beginRoundRoll('both', emptyRoster)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const leaveGame = () => {
    clearRollTimers()
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    if (rosterEffectTimerRef.current) clearTimeout(rosterEffectTimerRef.current)
    if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current)
    rosterRef.current = {}
    currentCombinationRef.current = FIRST_COMBINATION
    usedCombinationsRef.current.clear()
    teamRerollAvailableRef.current = true
    eraRerollAvailableRef.current = true
    rollingRef.current = false
    assignmentLockRef.current = false
    onHome()
  }

  if (complete) return <ResultsScreen roster={roster} onPlayAgain={resetGame} onHome={onHome} />

  return (
    <main className={`classic-page${isRolling ? ' is-rolling' : ''}`}>
      <div className="classic-page__atmosphere" aria-hidden="true" />
      <div className="classic-shell">
        <DraftHeader
          round={round}
          totalRounds={ROSTER_SLOTS.length}
          teamRerollAvailable={teamRerollAvailable}
          eraRerollAvailable={eraRerollAvailable}
          interactionsDisabled={interactionsDisabled}
          onTeamReroll={useTeamReroll}
          onEraReroll={useEraReroll}
          menu={<GameMenu onHome={leaveGame} onRestart={resetGame} />}
        />
        <div className="draft-workspace">
          <div className="draft-primary">
            <TeamDecadeReveal combination={combination} displayTeam={displayTeam} displayDecade={displayDecade} rollingMode={rollingMode} />
            <FranchiseProfile />
            <section className="draft-board" aria-labelledby="draft-board-title" aria-busy={isRolling}>
              <div className="draft-board__heading">
                <div><span>{isRolling ? 'Drawing matchup' : 'Available players'}</span><h1 id="draft-board-title">{isRolling ? 'Rolling…' : 'Make your pick'}</h1></div>
                <small>{players.length} players{allSortType && <b> · {allSortType}</b>}</small>
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
                      if (!sortOptionsForFilter(positionFilter).some((option) => option.value === sort)) setSort('war')
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
        </div>
      </div>
      {selectedPlayer && !interactionsDisabled && (
        <PositionPicker player={selectedPlayer} roster={roster} onCancel={() => setSelectedPlayer(null)} onConfirm={choosePosition} />
      )}
    </main>
  )
}
