import { getAvailablePositions, isPlayerSelectable, partitionPlayersByAvailability, resolveAssignmentSlot } from './Eligibility'
import { createGameState, type GameState, type RollMode } from './GameState'
import { CosmeticRandomizer, Randomizer, type RandomSource } from './Randomizer'
import { PennantPursuitScoring, type Scoring } from './ScoringEngine'
import { TeamPool, type SortOption, type TeamPoolSource } from './TeamPool'
import { ROSTER_SLOTS, type DraftPlayerView, type DraftResult, type Player, type Position, type PositionFilter, type Roster, type RosterSlotId, type SortKey, type TeamDecade } from '../types/draft'
import { APP_VERSION, DATA_DIGEST, DATA_VERSION, GAME_RULES_VERSION, RNG_VERSION, SCORING_VERSION } from '../config/versions'
import { appendDraftTranscriptEvent, createDraftTranscript, type DraftTranscript } from './DraftTranscript'
import { createLocalDraftId, createLocalGameplaySeed, createSeededRandom, type GameplaySeed } from './SeededRandom'

export interface DraftSnapshot {
  roster: Roster
  round: number
  totalRounds: number
  combination: TeamDecade
  displayTeam: string
  displayDecade: string
  usedCombinationIds: readonly string[]
  teamRerollAvailable: boolean
  eraRerollAvailable: boolean
  selectedPlayerIds: readonly string[]
  selectedPlayer: Player | null
  availablePositions: readonly Position[]
  players: readonly DraftPlayerView[]
  availablePlayerCount: number
  unavailablePlayerCount: number
  search: string
  filter: PositionFilter
  sort: SortKey
  sortOptions: readonly SortOption[]
  sortTypeLabel: string | null
  isRolling: boolean
  rollingMode: RollMode | null
  interactionsDisabled: boolean
  committingPlayerId: string | null
  recentlyFilledSlot: RosterSlotId | null
  isFinishing: boolean
  complete: boolean
  result: DraftResult | null
}

export interface DraftEngineOptions {
  pool?: TeamPoolSource
  scoring?: Scoring
  reducedMotion?: () => boolean
  timings?: Partial<DraftTimings>
  cosmeticRandom?: RandomSource
  sessionFactory?: DraftSessionFactory
}

export interface DraftSessionIdentity {
  readonly gameplaySeed: GameplaySeed
  readonly draftId: string
  readonly createdAt: string
}

export type DraftSessionFactory = () => DraftSessionIdentity

export interface DraftTimings {
  reducedRoll: number
  reducedCommit: number
  rosterEffect: number
  resultsReveal: number
}

const DEFAULT_TIMINGS: DraftTimings = { reducedRoll: 180, reducedCommit: 120, rosterEffect: 850, resultsReveal: 700 }
const REQUIRED_COMBINATION_CAPACITY = ROSTER_SLOTS.length + 2

type Listener = () => void

interface PendingRoll {
  readonly mode: RollMode
  readonly round: number
  readonly discardedCombination: TeamDecade
  readonly target: TeamDecade
}

function createLocalDraftSession(): DraftSessionIdentity {
  return Object.freeze({
    gameplaySeed: createLocalGameplaySeed(),
    draftId: createLocalDraftId(),
    createdAt: new Date().toISOString(),
  })
}

export class DraftEngine {
  private readonly pool: TeamPoolSource
  private gameplayRandomizer!: Randomizer
  private readonly cosmeticRandomizer: CosmeticRandomizer
  private readonly scoring: Scoring
  private readonly reducedMotion: () => boolean
  private readonly timings: DraftTimings
  private readonly sessionFactory: DraftSessionFactory
  private state: GameState
  private snapshot: DraftSnapshot
  private listeners = new Set<Listener>()
  private rollTimers: Array<ReturnType<typeof setTimeout>> = []
  private commitTimer: ReturnType<typeof setTimeout> | null = null
  private rosterEffectTimer: ReturnType<typeof setTimeout> | null = null
  private resultsTimer: ReturnType<typeof setTimeout> | null = null
  private assignmentLocked = false
  private started = false
  private pendingRoll: PendingRoll | null = null

  constructor(options: DraftEngineOptions = {}) {
    this.pool = options.pool ?? new TeamPool()
    this.sessionFactory = options.sessionFactory ?? createLocalDraftSession
    this.cosmeticRandomizer = new CosmeticRandomizer(this.pool, options.cosmeticRandom)
    this.scoring = options.scoring ?? new PennantPursuitScoring()
    this.reducedMotion = options.reducedMotion ?? (() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings }
    const supportedCombinations = this.pool.getCombinations()
    if (supportedCombinations.length < REQUIRED_COMBINATION_CAPACITY) {
      throw new Error(`DraftEngine requires at least ${REQUIRED_COMBINATION_CAPACITY} validated team/decade combinations for ${ROSTER_SLOTS.length} rounds and both rerolls; received ${supportedCombinations.length}.`)
    }
    const initial = supportedCombinations[0]
    this.state = this.createFreshState(initial)
    this.snapshot = this.createSnapshot()
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  /** Internal replay artifact; deliberately excluded from DraftSnapshot and UI. */
  getTranscript = (): DraftTranscript => this.state.transcript

  /** A transcript is final only after the existing result reveal completes. */
  getFinalizedTranscript = (): DraftTranscript | null => this.state.complete ? this.state.transcript : null

  private createFreshState(initial: TeamDecade) {
    const session = this.sessionFactory()
    this.gameplayRandomizer = new Randomizer(this.pool, createSeededRandom(session.gameplaySeed))
    const transcript = createDraftTranscript({
      appVersion: APP_VERSION,
      gameRulesVersion: GAME_RULES_VERSION,
      rngVersion: RNG_VERSION,
      scoringVersion: SCORING_VERSION,
      dataVersion: DATA_VERSION,
      canonicalDataDigest: DATA_DIGEST,
      draftId: session.draftId,
      gameplaySeed: session.gameplaySeed,
      createdAt: session.createdAt,
    })
    return createGameState(initial, session.gameplaySeed, transcript)
  }

  private createSnapshot(): DraftSnapshot {
    const sortOptions = this.pool.getAvailableSortOptions(
      this.state.currentCombination,
      this.state.selectedPlayerIds,
      this.state.filter,
    )
    if (!sortOptions.some(({ value }) => value === this.state.sort)) {
      this.state.sort = sortOptions.find(({ value }) => value === 'name')?.value
        ?? sortOptions[0].value
    }
    const selectedPlayer = this.pool.getPlayer(this.state.selectedPlayerId)
    const visiblePlayers = this.pool.query({
      combination: this.state.currentCombination,
      excludedIds: this.state.selectedPlayerIds,
      filter: this.state.filter,
      sort: this.state.sort,
      search: this.state.search,
    })
    const groupedPlayers = partitionPlayersByAvailability(visiblePlayers, this.state.roster)
    const statView = this.pool.getStatView(this.state.filter, this.state.sort)
    const players = [
      ...groupedPlayers.selectable.map((player) => ({ player, isAvailable: true, statView })),
      ...groupedPlayers.unavailable.map((player) => ({ player, isAvailable: false, statView })),
    ]
    return {
      roster: { ...this.state.roster },
      round: this.state.round,
      totalRounds: ROSTER_SLOTS.length,
      combination: this.state.currentCombination,
      displayTeam: this.state.displayTeam,
      displayDecade: this.state.displayDecade,
      usedCombinationIds: [...this.state.usedCombinationIds],
      teamRerollAvailable: this.state.teamRerollAvailable,
      eraRerollAvailable: this.state.eraRerollAvailable,
      selectedPlayerIds: [...this.state.selectedPlayerIds],
      selectedPlayer,
      availablePositions: selectedPlayer ? getAvailablePositions(selectedPlayer, this.state.roster) : [],
      players,
      availablePlayerCount: groupedPlayers.selectable.length,
      unavailablePlayerCount: groupedPlayers.unavailable.length,
      search: this.state.search,
      filter: this.state.filter,
      sort: this.state.sort,
      sortOptions,
      sortTypeLabel: this.pool.getSortTypeLabel(this.state.filter, this.state.sort),
      isRolling: this.state.isRolling,
      rollingMode: this.state.rollingMode,
      interactionsDisabled: this.state.isRolling || this.state.committingPlayerId !== null,
      committingPlayerId: this.state.committingPlayerId,
      recentlyFilledSlot: this.state.recentlyFilledSlot,
      isFinishing: this.state.isFinishing,
      complete: this.state.complete,
      result: this.state.result,
    }
  }

  private emit() {
    this.snapshot = this.createSnapshot()
    this.listeners.forEach((listener) => listener())
  }

  private clearRollTimers() {
    this.rollTimers.forEach((timer) => clearTimeout(timer))
    this.rollTimers = []
  }

  private clearTimers() {
    this.clearRollTimers()
    if (this.commitTimer) clearTimeout(this.commitTimer)
    if (this.rosterEffectTimer) clearTimeout(this.rosterEffectTimer)
    if (this.resultsTimer) clearTimeout(this.resultsTimer)
    this.commitTimer = null
    this.rosterEffectTimer = null
    this.resultsTimer = null
  }

  start() {
    if (this.started) return
    this.started = true
    if (this.pendingRoll) {
      this.beginPendingRoll(this.pendingRoll)
      return
    }
    if (!this.state.complete && this.state.usedCombinationIds.size === 0) this.roll('both')
  }

  dispose() {
    this.started = false
    this.clearTimers()
    this.state.isRolling = false
    this.state.rollingMode = null
    this.state.committingPlayerId = null
    this.state.isFinishing = false
    this.assignmentLocked = false
    this.emit()
  }

  private combinationIsPlayable(combination: TeamDecade, roster: Roster) {
    return this.pool.getPlayers(combination).some((player) => (
      !this.state.selectedPlayerIds.has(player.id) && isPlayerSelectable(player, roster)
    ))
  }

  private revealPendingRoll(pending: PendingRoll) {
    if (this.pendingRoll !== pending) return
    const { mode, target } = pending
    this.state.displayTeam = target.team
    this.state.displayDecade = target.decade
    this.state.currentCombination = target
    this.state.usedCombinationIds.add(target.id)
    this.state.transcript = appendDraftTranscriptEvent(this.state.transcript, mode === 'both'
      ? { type: 'initial-roll', round: pending.round, combinationId: target.id }
      : {
          type: 'reroll',
          reroll: mode,
          round: pending.round,
          discardedCombinationId: pending.discardedCombination.id,
          resultingCombinationId: target.id,
        })
    this.state.isRolling = false
    this.state.rollingMode = null
    this.assignmentLocked = false
    this.pendingRoll = null
    this.rollTimers = []
    this.emit()
  }

  private beginPendingRoll(pending: PendingRoll) {
    this.state.isRolling = true
    this.state.rollingMode = pending.mode
    this.state.selectedPlayerId = null
    this.clearRollTimers()
    this.emit()

    const reveal = () => this.revealPendingRoll(pending)
    if (this.reducedMotion()) {
      this.rollTimers.push(setTimeout(reveal, this.timings.reducedRoll))
      return
    }

    const delays = [55, 60, 65, 75, 90, 110, 135, 155, 180]
    let elapsed = 0
    delays.forEach((delay, index) => {
      elapsed += delay
      this.rollTimers.push(setTimeout(() => {
        if (index === delays.length - 1) return reveal()
        if (pending.mode !== 'era') this.state.displayTeam = this.cosmeticRandomizer.cycleTeam()
        if (pending.mode !== 'team') this.state.displayDecade = this.cosmeticRandomizer.cycleDecade()
        this.emit()
      }, elapsed))
    })
  }

  private roll(mode: RollMode, roster = this.state.roster) {
    if (this.state.isRolling || this.pendingRoll) return false
    const target = this.gameplayRandomizer.select({
      mode,
      current: this.state.currentCombination,
      usedCombinationIds: this.state.usedCombinationIds,
      teamRerollAvailable: this.state.teamRerollAvailable,
      eraRerollAvailable: this.state.eraRerollAvailable,
      roundsRemaining: ROSTER_SLOTS.length - this.state.selectedPlayerIds.size,
      isPlayable: (combination) => this.combinationIsPlayable(combination, roster),
    })
    if (!target) {
      this.assignmentLocked = false
      return false
    }
    this.pendingRoll = {
      mode,
      round: this.state.round,
      discardedCombination: this.state.currentCombination,
      target,
    }
    this.beginPendingRoll(this.pendingRoll)
    return true
  }

  setSearch(search: string) {
    if (this.snapshot.interactionsDisabled) return
    this.state.search = search
    this.emit()
  }

  setFilter(filter: PositionFilter) {
    if (this.snapshot.interactionsDisabled) return
    this.state.filter = filter
    this.emit()
  }

  setSort(sort: SortKey) {
    if (this.snapshot.interactionsDisabled || !this.snapshot.sortOptions.some(({ value }) => value === sort)) return
    this.state.sort = sort
    this.emit()
  }

  selectPlayer(playerId: string) {
    if (this.snapshot.interactionsDisabled || this.assignmentLocked) return
    const player = this.pool.getPlayer(playerId)
    if (!player || this.state.selectedPlayerIds.has(player.id) || !isPlayerSelectable(player, this.state.roster)) return
    if (player.franchiseId !== this.state.currentCombination.franchiseId || player.decade !== this.state.currentCombination.decade) return
    this.state.selectedPlayerId = player.id
    this.emit()
  }

  cancelPlayerSelection() {
    if (this.snapshot.interactionsDisabled) return
    this.state.selectedPlayerId = null
    this.emit()
  }

  assignSelectedPlayer(position: Position) {
    if (this.snapshot.interactionsDisabled || this.assignmentLocked) return
    const player = this.pool.getPlayer(this.state.selectedPlayerId)
    if (!player) return
    const slot = resolveAssignmentSlot(player, position, this.state.roster)
    if (!slot) return
    const round = this.state.round
    const combinationId = this.state.currentCombination.id

    this.assignmentLocked = true
    this.state.committingPlayerId = player.id
    this.state.selectedPlayerId = null
    this.emit()
    this.commitTimer = setTimeout(() => {
      this.state.roster = { ...this.state.roster, [slot]: player }
      this.state.selectedPlayerIds.add(player.id)
      this.state.transcript = appendDraftTranscriptEvent(this.state.transcript, {
        type: 'pick',
        round,
        pickOrder: this.state.selectedPlayerIds.size,
        combinationId,
        canonicalCardId: player.id,
        sourcePlayerId: player.playerId,
        assignedPosition: position,
        featuredSeason: player.featuredSeason,
      })
      this.state.round = Math.min(this.state.selectedPlayerIds.size + 1, ROSTER_SLOTS.length)
      this.state.recentlyFilledSlot = slot
      this.state.search = ''
      this.state.filter = 'ALL'
      this.rosterEffectTimer = setTimeout(() => {
        this.state.recentlyFilledSlot = null
        this.emit()
      }, this.timings.rosterEffect)

      if (this.state.selectedPlayerIds.size === ROSTER_SLOTS.length) {
        this.state.isFinishing = true
        this.resultsTimer = setTimeout(() => {
          this.state.committingPlayerId = null
          this.state.isFinishing = false
          this.state.complete = true
          this.state.result = this.scoring.calculate(this.state.roster)
          this.emit()
        }, this.reducedMotion() ? this.timings.reducedCommit : this.timings.resultsReveal)
        this.emit()
        return
      }
      this.state.committingPlayerId = null
      this.emit()
      this.roll('both')
    }, this.reducedMotion() ? this.timings.reducedCommit : 300)
  }

  rerollTeam() {
    if (!this.state.teamRerollAvailable || this.snapshot.interactionsDisabled) return
    if (!this.roll('team')) return
    this.state.teamRerollAvailable = false
    this.emit()
  }

  rerollEra() {
    if (!this.state.eraRerollAvailable || this.snapshot.interactionsDisabled) return
    if (!this.roll('era')) return
    this.state.eraRerollAvailable = false
    this.emit()
  }

  restart() {
    this.clearTimers()
    this.pendingRoll = null
    const initial = this.pool.getCombinations()[0]
    this.state = this.createFreshState(initial)
    this.assignmentLocked = false
    this.emit()
    this.roll('both')
  }

  abandon() {
    this.clearTimers()
    this.pendingRoll = null
    const initial = this.pool.getCombinations()[0]
    this.state = this.createFreshState(initial)
    this.assignmentLocked = false
    this.emit()
  }
}
