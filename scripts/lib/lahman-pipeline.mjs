import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
export const POSITION_ORDER = [...FIELD_POSITIONS, 'DH', 'SP', 'RP']
const FIELD_POSITION_SET = new Set(FIELD_POSITIONS)
const HITTER_POSITIONS = new Set([...FIELD_POSITIONS, 'DH'])
const FEATURED_SCORE_RETENTION = .98
const FEATURED_WORKLOAD_MULTIPLIER = 1.5
const ROUND = (value, places = 3) => Number.isFinite(value) ? Number(value.toFixed(places)) : null
const NUMBER = (value) => value === '' || value === undefined ? 0 : Number(value)
const decadeFor = (year) => `${Math.floor(year / 10) * 10}s`
const keyForTeamYear = (year, teamId) => `${year}:${teamId}`
const keyForSeason = (playerId, franchiseId, year) => `${playerId}:${franchiseId}:${year}`
const safeId = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const compareText = (a, b) => a.localeCompare(b, 'en')
const overrideValue = (entry, key = 'value') => entry && typeof entry === 'object' ? entry[key] ?? entry.value : entry
const GENERATED_POOL_DIRECTORIES = ['pools', 'runtime-pools']
const GENERATED_CONFLICT_COPY_PATTERN = /(?:\s+\d+|\s*\(\d+\))\.json$/u
const GENERATED_COMBINATION_ID_PATTERN = /^[a-z0-9-]+-\d{4}s$/u
const GENERATED_FRANCHISE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const GENERATED_DECADE_PATTERN = /^\d{4}s$/u
const RUNTIME_AUDIT_ONLY_FIELDS = new Set(['sourceMetadata', 'sourceNotes', 'notes', 'manualPositionOverride', 'selectionMetadata', 'stats'])

export const CANONICAL_DATA_DIGEST_ALGORITHM = 'sha256'
export const CANONICAL_DATA_DIGEST_SCHEMA = 'pennant-pursuit-runtime-data-v1'
export const READINESS_SCHEMA_VERSION = 2
export const WORKER_CATALOG_SCHEMA_VERSION = 1

const WORKER_PLAYER_KINDS = Object.freeze({ hitter: 0, pitcher: 1, twoWay: 2 })

const workerPositionMask = (positions) => positions.reduce((mask, position) => {
  const index = POSITION_ORDER.indexOf(position)
  if (index < 0) throw new Error(`Worker catalog cannot encode unknown position: ${position}`)
  return mask | (1 << index)
}, 0)

const workerHitterVisibleStats = (card) => card.playerType === 'pitcher' ? null : [
  card.visibleStats.ops,
  card.visibleStats.obp,
  card.visibleStats.slg,
  card.visibleStats.hr,
  card.visibleStats.rbi,
  card.visibleStats.sb,
  card.visibleStats.avg,
]

const workerPitcherVisibleStats = (card) => card.playerType === 'hitter' ? null : [
  (card.playerType === 'pitcher' ? card.visibleStats : card.pitchingVisibleStats).era,
  (card.playerType === 'pitcher' ? card.visibleStats : card.pitchingVisibleStats).whip,
  (card.playerType === 'pitcher' ? card.visibleStats : card.pitchingVisibleStats).so,
  (card.playerType === 'pitcher' ? card.visibleStats : card.pitchingVisibleStats).sv,
]

const workerHitterScoringStats = (card) => card.playerType === 'pitcher' ? null : [
  card.scoringStats.plateAppearances,
  card.scoringStats.games,
  card.scoringStats.baserunningValue,
  card.scoringStats.defensiveValue,
  card.scoringStats.eraAdjustedOffense ?? null,
]

const workerPitcherScoringStats = (card) => card.playerType === 'hitter' ? null : [
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).fip,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).inningsPitched,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).strikeoutRate,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).walkRate,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).starts ?? null,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).gamesStarted ?? null,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).reliefAppearances,
  (card.playerType === 'pitcher' ? card.scoringStats : card.pitchingScoringStats).eraAdjustedPitching ?? null,
]

export function projectWorkerCatalogCard(card) {
  const kind = WORKER_PLAYER_KINDS[card.playerType]
  if (kind === undefined) throw new Error(`Worker catalog cannot encode unknown player type for ${card.id}`)
  return [
    card.id,
    card.playerId,
    card.name,
    card.featuredSeason,
    workerPositionMask(card.eligiblePositions),
    kind,
    workerHitterVisibleStats(card),
    workerPitcherVisibleStats(card),
    workerHitterScoringStats(card),
    workerPitcherScoringStats(card),
  ]
}

export function createWorkerCatalog(combinations, runtimePools, metadata, dataDigest) {
  assertCanonicalCombinations(combinations)
  const versionErrors = validateSharedVersionMetadata(metadata)
  if (versionErrors.length) throw new Error(`Invalid shared version metadata:\n${versionErrors.join('\n')}`)
  if (typeof dataDigest !== 'string' || !/^[a-f0-9]{64}$/.test(dataDigest)) throw new Error('Worker catalog requires a canonical lowercase SHA-256 digest')
  return {
    schemaVersion: WORKER_CATALOG_SCHEMA_VERSION,
    scoringVersion: metadata.scoringVersion,
    dataVersion: metadata.dataVersion,
    dataDigest,
    combinations: combinations.map((combination) => {
      const cards = runtimePools[combination.id]
      if (!Array.isArray(cards)) throw new Error(`Canonical runtime pool is missing: ${combination.id}`)
      return [
        combination.id,
        combination.franchiseId,
        combination.team,
        combination.teamName,
        combination.decade,
        cards.map(projectWorkerCatalogCard),
      ]
    }),
  }
}

export const serializeWorkerCatalog = (catalog) => `${JSON.stringify(catalog)}\n`

export const isGeneratedConflictCopyFilename = (filename) => GENERATED_CONFLICT_COPY_PATTERN.test(filename)

export function findGeneratedConflictCopyFiles(root = process.cwd()) {
  const generated = path.join(root, 'src/data/generated')
  return GENERATED_POOL_DIRECTORIES.flatMap((directory) => {
    const folder = path.join(generated, directory)
    if (!fs.existsSync(folder)) return []
    return fs.readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isGeneratedConflictCopyFilename(entry.name))
      .map((entry) => path.posix.join('src/data/generated', directory, entry.name))
  }).sort(compareText)
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index += 1 }
      else if (char === '"') quoted = false
      else value += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(value); value = '' }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '' }
    else value += char
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row) }
  const headers = rows.shift() ?? []
  return rows.filter((cells) => cells.some(Boolean)).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])))
}

const readCsv = (root, name) => parseCsv(fs.readFileSync(path.join(root, 'data-import/lahman', `${name}.csv`), 'utf8'))
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

export function readSharedVersionMetadata(root = process.cwd()) {
  return readJson(path.join(root, 'src/config/versionMetadata.json'))
}

export function validateSharedVersionMetadata(metadata) {
  const errors = []
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return ['shared version metadata must be an object']
  if (metadata.schemaVersion !== 1) errors.push('shared version metadata schemaVersion must be 1')
  if (typeof metadata.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.appVersion)) errors.push('shared appVersion must be a semantic version string')
  if (typeof metadata.gameRulesVersion !== 'string' || !metadata.gameRulesVersion.trim()) errors.push('shared gameRulesVersion must be a non-empty string')
  if (typeof metadata.scoringVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(metadata.scoringVersion)) errors.push('shared scoringVersion must be a numeric version string')
  if (typeof metadata.dataVersion !== 'string' || !metadata.dataVersion.trim()) errors.push('shared dataVersion must be a non-empty string')
  for (const field of ['submissionSchemaVersion', 'leaderboardVersion']) {
    if (!Object.hasOwn(metadata, field) || metadata[field] !== null) errors.push(`shared ${field} must be explicitly null while inactive`)
  }
  if (metadata.rngVersion !== 'seeded-v1') errors.push('shared rngVersion must be seeded-v1 while deterministic gameplay RNG is active')
  return errors
}

export function validateCanonicalCombinations(combinations) {
  if (!Array.isArray(combinations)) return ['canonical combinations must be an array']
  const errors = []
  const ids = []
  combinations.forEach((combination, index) => {
    const label = `canonical combination at index ${index}`
    if (!combination || typeof combination !== 'object' || Array.isArray(combination)) {
      errors.push(`${label} must be an object`)
      return
    }
    for (const field of ['id', 'franchiseId', 'team', 'teamName', 'decade']) {
      if (typeof combination[field] !== 'string' || !combination[field].trim()) errors.push(`${label} ${field} must be a non-empty string`)
    }
    const { id, franchiseId, decade } = combination
    if (typeof id === 'string') {
      ids.push(id)
      if (!GENERATED_COMBINATION_ID_PATTERN.test(id)) errors.push(`${label} id is not a safe generated-data ID: ${id}`)
    }
    if (typeof franchiseId === 'string' && !GENERATED_FRANCHISE_ID_PATTERN.test(franchiseId)) errors.push(`${label} franchiseId is invalid: ${franchiseId}`)
    if (typeof decade === 'string' && !GENERATED_DECADE_PATTERN.test(decade)) errors.push(`${label} decade is invalid: ${decade}`)
    if (typeof id === 'string' && typeof franchiseId === 'string' && typeof decade === 'string' && id !== `${franchiseId}-${decade}`) {
      errors.push(`${label} id must equal franchiseId-decade`)
    }
  })
  if (new Set(ids).size !== ids.length) errors.push('canonical combinations contain duplicate IDs')
  return errors
}

function assertCanonicalCombinations(combinations) {
  const errors = validateCanonicalCombinations(combinations)
  if (errors.length) throw new Error(`Invalid canonical combinations:\n${errors.join('\n')}`)
}

function serializeCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(serializeCanonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function canonicalJson(value) {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Canonical data must be JSON-serializable')
  return serializeCanonicalJson(JSON.parse(serialized))
}

export function calculateCanonicalDataDigest(combinations, runtimePools) {
  assertCanonicalCombinations(combinations)
  const combinationIds = combinations.map(({ id }) => id)
  const pools = Object.fromEntries(combinations.map(({ id }) => {
    const cards = runtimePools[id]
    if (!Array.isArray(cards)) throw new Error(`Canonical runtime pool is missing: ${id}`)
    return [id, cards]
  }))
  const payload = canonicalJson({ domain: CANONICAL_DATA_DIGEST_SCHEMA, combinations, pools })
  return createHash(CANONICAL_DATA_DIGEST_ALGORITHM).update(payload, 'utf8').digest('hex')
}

export function createRuntimePools(pools) {
  return Object.fromEntries(Object.entries(pools).map(([id, cards]) => [
    id,
    cards.map((card) => Object.fromEntries(Object.entries(card).filter(([field]) => !RUNTIME_AUDIT_ONLY_FIELDS.has(field)))),
  ]))
}

export function createGeneratedRegistry(combinations) {
  assertCanonicalCombinations(combinations)
  const imports = combinations.map(({ id }, index) => `import pool${index} from './runtime-pools/${id}.json'`).join('\n')
  const entries = combinations.map(({ id }, index) => `  '${id}': pool${index} as unknown as PlayerCard[],`).join('\n')
  return `${imports}\nimport combinations from './combinations.json'\nimport readiness from './readiness.json'\nimport type { PlayerCard, TeamDecade } from '../../types/draft'\n\nexport const PLAYER_POOLS: Readonly<Record<string, readonly PlayerCard[]>> = {\n${entries}\n}\n\nexport const TEAM_DECADES = combinations as TeamDecade[]\nexport const PLAYER_CARDS = Object.values(PLAYER_POOLS).flat()\nexport const DATA_READINESS = readiness\n`
}

function generatedVersionFields(metadata, dataDigest) {
  return {
    versionMetadataSchemaVersion: metadata.schemaVersion,
    appVersion: metadata.appVersion,
    gameRulesVersion: metadata.gameRulesVersion,
    scoringVersion: metadata.scoringVersion,
    dataVersion: metadata.dataVersion,
    dataDigestAlgorithm: CANONICAL_DATA_DIGEST_ALGORITHM,
    dataDigestSchema: CANONICAL_DATA_DIGEST_SCHEMA,
    dataDigest,
    submissionSchemaVersion: metadata.submissionSchemaVersion,
    rngVersion: metadata.rngVersion,
    leaderboardVersion: metadata.leaderboardVersion,
  }
}

function deriveFranchiseIdentity(franchiseId, franchiseRow, teamRows) {
  const latest = [...teamRows].sort((a, b) => NUMBER(b.yearID) - NUMBER(a.yearID))[0]
  return {
    franchiseId: safeId(franchiseId),
    lahmanFranchiseId: franchiseId,
    team: latest?.teamIDBR || latest?.teamID || franchiseId,
    teamName: franchiseRow?.franchName || latest?.name || franchiseId,
    historicalNames: [...new Set(teamRows.map(({ name }) => name).filter(Boolean))],
    sourceTeamIds: [...new Set(teamRows.map(({ teamID }) => teamID))].sort(compareText),
    firstSeason: Math.min(...teamRows.map(({ yearID }) => NUMBER(yearID))),
    lastSeason: Math.max(...teamRows.map(({ yearID }) => NUMBER(yearID))),
  }
}

function leagueContext(teams) {
  const totals = new Map()
  for (const row of teams) {
    const year = NUMBER(row.yearID)
    const key = `${year}:${row.lgID}`
    const current = totals.get(key) ?? { ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, hbp: 0, sf: 0, er: 0, ipouts: 0 }
    current.ab += NUMBER(row.AB); current.h += NUMBER(row.H); current.doubles += NUMBER(row['2B'])
    current.triples += NUMBER(row['3B']); current.hr += NUMBER(row.HR); current.bb += NUMBER(row.BB)
    current.hbp += NUMBER(row.HBP); current.sf += NUMBER(row.SF); current.er += NUMBER(row.ER); current.ipouts += NUMBER(row.IPouts)
    totals.set(key, current)
  }
  return new Map([...totals].map(([key, row]) => {
    const singles = row.h - row.doubles - row.triples - row.hr
    const obpDenominator = row.ab + row.bb + row.hbp + row.sf
    const obp = obpDenominator ? (row.h + row.bb + row.hbp) / obpDenominator : null
    const slg = row.ab ? (singles + row.doubles * 2 + row.triples * 3 + row.hr * 4) / row.ab : null
    return [key, { ops: obp !== null && slg !== null ? obp + slg : null, era: row.ipouts ? row.er * 27 / row.ipouts : null }]
  }))
}

export function aggregateRows(rows, teamByYear, kind) {
  const groups = new Map()
  for (const row of rows) {
    const year = NUMBER(row.yearID)
    const team = teamByYear.get(keyForTeamYear(year, row.teamID))
    if (!team) continue
    const key = keyForSeason(row.playerID, team.franchise.franchiseId, year)
    let target = groups.get(key)
    if (!target) {
      target = { playerID: row.playerID, year, franchise: team.franchise, teamRows: new Map(), leagues: new Set(), observed: new Set() }
      groups.set(key, target)
    }
    const weight = kind === 'batting' ? NUMBER(row.G) : NUMBER(row.IPouts)
    const priorWeight = target.teamRows.get(row.teamID)?.weight ?? 0
    target.teamRows.set(row.teamID, { team, weight: priorWeight + weight })
    if (row.lgID) target.leagues.add(row.lgID)
    if (kind === 'batting') {
      for (const field of ['G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'CS', 'BB', 'SO', 'IBB', 'HBP', 'SH', 'SF', 'GIDP']) {
        target[field] = (target[field] ?? 0) + NUMBER(row[field])
        if (row[field] !== '') target.observed.add(field)
      }
    } else {
      for (const field of ['W', 'L', 'G', 'GS', 'CG', 'SHO', 'SV', 'IPouts', 'H', 'ER', 'HR', 'BB', 'SO', 'IBB', 'WP', 'HBP', 'BK', 'BFP', 'GF', 'R', 'SH', 'SF', 'GIDP']) {
        target[field] = (target[field] ?? 0) + NUMBER(row[field])
        if (row[field] !== '') target.observed.add(field)
      }
    }
  }
  return groups
}

function aggregateFielding(rows, teamByYear) {
  const groups = new Map()
  for (const row of rows) {
    const year = NUMBER(row.yearID)
    const team = teamByYear.get(keyForTeamYear(year, row.teamID))
    if (!team || !HITTER_POSITIONS.has(row.POS)) continue
    const key = keyForSeason(row.playerID, team.franchise.franchiseId, year)
    const positions = groups.get(key) ?? new Map()
    positions.set(row.POS, (positions.get(row.POS) ?? 0) + NUMBER(row.G))
    groups.set(key, positions)
  }
  return groups
}

export function aggregateAppearances(rows, teamByYear) {
  const fields = { C: 'G_c', '1B': 'G_1b', '2B': 'G_2b', '3B': 'G_3b', SS: 'G_ss', LF: 'G_lf', CF: 'G_cf', RF: 'G_rf', DH: 'G_dh' }
  const groups = new Map()
  for (const row of rows) {
    const year = NUMBER(row.yearID)
    const team = teamByYear.get(keyForTeamYear(year, row.teamID))
    if (!team) continue
    const key = keyForSeason(row.playerID, team.franchise.franchiseId, year)
    const positions = groups.get(key) ?? new Map()
    for (const [position, field] of Object.entries(fields)) if (row[field] !== '') positions.set(position, (positions.get(position) ?? 0) + NUMBER(row[field]))
    groups.set(key, positions)
  }
  return groups
}

function aggregateLegacyOutfield(rows, fieldingRows, teamByYear) {
  const stintTeams = new Map()
  for (const row of fieldingRows) stintTeams.set(`${row.playerID}:${row.yearID}:${row.stint}`, row.teamID)
  const groups = new Map()
  for (const row of rows) {
    const teamId = stintTeams.get(`${row.playerID}:${row.yearID}:${row.stint}`)
    const year = NUMBER(row.yearID)
    const team = teamByYear.get(keyForTeamYear(year, teamId))
    if (!team) continue
    const key = keyForSeason(row.playerID, team.franchise.franchiseId, year)
    const positions = groups.get(key) ?? new Map()
    for (const [position, field] of [['LF', 'Glf'], ['CF', 'Gcf'], ['RF', 'Grf']]) if (row[field] !== '') positions.set(position, (positions.get(position) ?? 0) + NUMBER(row[field]))
    groups.set(key, positions)
  }
  return groups
}

function mergePositionMaps(target, source, overwrite = false) {
  for (const [key, additions] of source) {
    const positions = target.get(key) ?? new Map()
    for (const [position, games] of additions) if (overwrite || !positions.has(position)) positions.set(position, games)
    target.set(key, positions)
  }
}

function primaryTeam(group) {
  return [...group.teamRows.values()].sort((a, b) => b.weight - a.weight || compareText(a.team.teamID, b.team.teamID))[0]?.team
}

function contextFor(group, contexts) {
  const values = [...group.leagues].map((league) => contexts.get(`${group.year}:${league}`)).filter(Boolean)
  if (!values.length) return { ops: null, era: null }
  return {
    ops: values.map(({ ops }) => ops).filter(Number.isFinite).reduce((a, b) => a + b, 0) / values.filter(({ ops }) => Number.isFinite(ops)).length || null,
    era: values.map(({ era }) => era).filter(Number.isFinite).reduce((a, b) => a + b, 0) / values.filter(({ era }) => Number.isFinite(era)).length || null,
  }
}

export function hitterStats(group, context) {
  const ab = group.AB ?? 0; const hits = group.H ?? 0
  const doubles = group['2B'] ?? 0; const triples = group['3B'] ?? 0; const homeRuns = group.HR ?? 0
  const singles = hits - doubles - triples - homeRuns
  const pa = ab + (group.BB ?? 0) + (group.HBP ?? 0) + (group.SF ?? 0) + (group.SH ?? 0)
  const obpDenominator = ab + (group.BB ?? 0) + (group.HBP ?? 0) + (group.SF ?? 0)
  const avg = ab ? hits / ab : null
  const obp = obpDenominator ? (hits + (group.BB ?? 0) + (group.HBP ?? 0)) / obpDenominator : null
  const slg = ab ? (singles + doubles * 2 + triples * 3 + homeRuns * 4) / ab : null
  const ops = obp !== null && slg !== null ? obp + slg : null
  return {
    games: group.G ?? 0, plateAppearances: pa, atBats: ab, hits,
    hr: group.observed.has('HR') ? homeRuns : null,
    rbi: group.observed.has('RBI') ? group.RBI : null,
    sb: group.observed.has('SB') ? group.SB : null,
    avg: ROUND(avg), obp: ROUND(obp), slg: ROUND(slg), ops: ROUND(ops),
    eraAdjustedOffense: ops !== null && context.ops ? ROUND(ops / context.ops * 100, 1) : null,
  }
}

export function pitcherStats(group, context) {
  const innings = (group.IPouts ?? 0) / 3
  const era = innings && group.observed.has('ER') ? (group.ER ?? 0) * 9 / innings : null
  const whip = innings && group.observed.has('H') && group.observed.has('BB') ? ((group.H ?? 0) + (group.BB ?? 0)) / innings : null
  const k9 = innings && group.observed.has('SO') ? (group.SO ?? 0) * 9 / innings : null
  const bb9 = innings && group.observed.has('BB') ? (group.BB ?? 0) * 9 / innings : null
  const games = group.G ?? 0; const starts = group.GS ?? 0
  return {
    games, starts, reliefAppearances: Math.max(0, games - starts), inningsPitched: ROUND(innings, 1),
    era: ROUND(era, 2), whip: ROUND(whip), so: group.observed.has('SO') ? group.SO : null,
    wins: group.observed.has('W') ? group.W : null, sv: group.observed.has('SV') ? group.SV : null,
    k9: ROUND(k9, 2), bb9: ROUND(bb9, 2),
    eraAdjustedPitching: era && context.era ? ROUND(context.era / era * 100, 1) : null,
  }
}

function normalized(value, poor, elite, lower = false) {
  if (!Number.isFinite(value)) return 0
  const amount = lower ? (poor - value) / (poor - elite) : (value - poor) / (elite - poor)
  return Math.max(0, Math.min(1, amount))
}

function hitterScore(stats, positions, weights) {
  const paScale = Math.max(1, stats.plateAppearances)
  const difficulty = Math.max(0, ...positions.map((position) => ({ C: 1, SS: .95, CF: .85, '2B': .8, '3B': .65, RF: .5, LF: .4, '1B': .3 }[position] ?? 0)))
  return weights.eraAdjustedOps * normalized(stats.eraAdjustedOffense, 70, 180)
    + weights.ops * normalized(stats.ops, .5, 1.25)
    + weights.plateAppearances * normalized(stats.plateAppearances, 100, 750)
    + weights.homeRunRate * normalized(stats.hr / paScale * 650, 0, 65)
    + weights.rbiRate * normalized((stats.rbi ?? 0) / paScale * 650, 0, 160)
    + weights.stolenBaseRate * normalized((stats.sb ?? 0) / paScale * 650, 0, 70)
    + weights.positionValue * difficulty
}

function pitcherScore(stats, role, weights) {
  return weights.eraAdjustedRunPrevention * normalized(stats.eraAdjustedPitching, 65, 220)
    + weights.whip * normalized(stats.whip, 1.8, .7, true)
    + weights.strikeoutsPerNine * normalized(stats.k9, 2, 16)
    + weights.walksPerNine * normalized(stats.bb9, 7, .5, true)
    + (role === 'SP' ? weights.innings * normalized(stats.inningsPitched, 30, 320) + weights.starts * normalized(stats.starts, 10, 40)
      : weights.reliefAppearances * normalized(stats.reliefAppearances, 15, 90) + weights.saves * normalized(stats.sv, 0, 60))
}

function overridePositions(base, override) {
  if (!override) return base
  return [...new Set([...base.filter((position) => !(override.remove ?? []).includes(position)), ...(override.add ?? [])])]
    .filter((position) => POSITION_ORDER.includes(position)).sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))
}

export function buildCandidate({ player, franchise, year, batting, pitching, positions, context, config, overrides }) {
  const hitter = batting ? hitterStats(batting, contextFor(batting, context)) : null
  const pitcher = pitching ? pitcherStats(pitching, contextFor(pitching, context)) : null
  const qualifiesHitter = hitter && hitter.plateAppearances >= config.eligibility.minimumHitterPlateAppearances
  const qualifiesPitcher = pitcher && pitcher.inningsPitched >= config.eligibility.minimumPitcherInnings
  const positionEntries = [...(positions ?? new Map())]
  const selectionFieldingMinimum = config.eligibility.minimumSelectionFieldingGames ?? config.eligibility.minimumFieldingGames
  const dhMinimum = config.eligibility.minimumDhGames ?? selectionFieldingMinimum
  const fieldPositionsAt = (minimum) => positionEntries
    .filter(([position, games]) => FIELD_POSITION_SET.has(position) && games >= minimum)
    .map(([position]) => position)
  const dhPositions = qualifiesHitter && positionEntries.some(([position, games]) => position === 'DH' && games >= dhMinimum) ? ['DH'] : []
  const selectionFieldPositions = [...fieldPositionsAt(selectionFieldingMinimum), ...dhPositions]
  const pitcherPositions = []
  if (qualifiesPitcher && pitcher.starts >= config.eligibility.minimumStarts) pitcherPositions.push('SP')
  if (qualifiesPitcher && pitcher.reliefAppearances >= config.eligibility.minimumReliefAppearances) pitcherPositions.push('RP')
  const selectionSourceEligiblePositions = [...selectionFieldPositions, ...pitcherPositions].sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))
  const cardId = `${franchise.franchiseId}-${decadeFor(year)}-${player.playerID}`
  const positionOverride = overrides.positions?.[cardId]
  const selectionEligiblePositions = overridePositions(selectionSourceEligiblePositions, positionOverride)
  const isHitter = Boolean(qualifiesHitter && selectionEligiblePositions.some((position) => HITTER_POSITIONS.has(position)))
  const isPitcher = Boolean(qualifiesPitcher && selectionEligiblePositions.some((position) => position === 'SP' || position === 'RP'))
  if (!isHitter && !isPitcher) return null
  const sourceEligiblePositions = [...fieldPositionsAt(config.eligibility.minimumFieldingGames), ...dhPositions, ...pitcherPositions]
    .sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))
  const eligiblePositions = overridePositions(sourceEligiblePositions, positionOverride)
  const primaryPitchingRole = pitcherPositions.includes('SP') && pitcherPositions.includes('RP')
    ? (pitcher.starts >= pitcher.reliefAppearances ? 'SP' : 'RP') : pitcherPositions[0] ?? null
  const playerType = isHitter && isPitcher ? 'twoWay' : isHitter ? 'hitter' : 'pitcher'
  const team = primaryTeam(batting ?? pitching)
  const hitterSelection = isHitter ? hitterScore(hitter, selectionEligiblePositions, config.selection.hitter) : 0
  const pitcherSelection = isPitcher ? Math.max(...pitcherPositions.map((role) => pitcherScore(pitcher, role, config.selection[role === 'SP' ? 'starter' : 'reliever']))) : 0
  const selectionRole = isHitter && hitterSelection >= pitcherSelection ? 'H' : primaryPitchingRole
  const selectionWorkload = selectionRole === 'H' ? hitter.plateAppearances : pitcher.inningsPitched
  return {
    id: cardId, playerId: player.playerID, playerSlug: player.bbrefID || player.playerID,
    name: overrideValue(overrides.names?.[player.playerID], 'name') ?? [player.nameFirst, player.nameLast].filter(Boolean).join(' '),
    franchiseId: franchise.franchiseId, teamAbbreviation: team?.teamIDBR || team?.teamID || franchise.team,
    teamDisplayName: team?.name || franchise.teamName, historicalTeamName: team?.name || franchise.teamName,
    team: team?.teamIDBR || team?.teamID || franchise.team, decade: decadeFor(year), featuredSeason: year,
    eligiblePositions, isTwoWay: playerType === 'twoWay', pitchingRole: primaryPitchingRole,
    bats: player.bats || null, throws: player.throws || null, playerType, type: playerType === 'pitcher' ? 'pitcher' : 'hitter',
    hitter, pitcher, selectionScore: Math.max(hitterSelection, pitcherSelection), selectionRole, selectionWorkload,
    sourceTeamIds: [...(batting ?? pitching).teamRows.keys()].sort(compareText),
    sourceNote: overrides.notes?.[cardId] ?? '', manualPositionOverride: Boolean(overrides.positions?.[cardId]),
    sourceEligiblePositions, selectionEligiblePositions, selectionSourceEligiblePositions,
    positionAppearances: Object.fromEntries([...(positions ?? new Map())].sort(([left], [right]) => POSITION_ORDER.indexOf(left) - POSITION_ORDER.indexOf(right))),
  }
}

export function selectFeatured(candidates, overrides) {
  const groups = new Map()
  for (const candidate of candidates) {
    const key = `${candidate.franchiseId}-${candidate.decade}-${candidate.playerId}`
    const existing = groups.get(key) ?? []
    existing.push(candidate); groups.set(key, existing)
  }
  return [...groups].map(([key, seasons]) => {
    const requested = overrideValue(overrides.featuredSeasons?.[key], 'season')
    const sorted = seasons.sort((a, b) => b.selectionScore - a.selectionScore || b.featuredSeason - a.featuredSeason)
    const rawWinner = sorted[0]
    const formulaWinner = sorted.find((candidate, index) => (
      index > 0
      && candidate.selectionRole === rawWinner.selectionRole
      && candidate.selectionScore >= rawWinner.selectionScore * FEATURED_SCORE_RETENTION
      && candidate.selectionWorkload >= rawWinner.selectionWorkload * FEATURED_WORKLOAD_MULTIPLIER
    )) ?? rawWinner
    const overrideWinner = requested ? sorted.find(({ featuredSeason }) => featuredSeason === requested) : null
    const chosen = overrideWinner ?? formulaWinner
    return {
      ...chosen,
      featuredSelection: {
        rawWinnerSeason: rawWinner.featuredSeason,
        rawWinnerScore: rawWinner.selectionScore,
        rawWinnerRole: rawWinner.selectionRole,
        rawWinnerWorkload: rawWinner.selectionWorkload,
        formulaWinnerSeason: formulaWinner.featuredSeason,
        formulaWinnerScore: formulaWinner.selectionScore,
        formulaWinnerRole: formulaWinner.selectionRole,
        formulaWinnerWorkload: formulaWinner.selectionWorkload,
        workloadGuardApplied: formulaWinner !== rawWinner,
        manualOverrideSeason: requested ?? null,
        manualOverrideApplied: Boolean(overrideWinner && overrideWinner !== formulaWinner),
      },
    }
  })
}

function toCard(candidate, source, formulaVersion) {
  const hitterVisible = candidate.hitter ? {
    war: null, opsPlus: null, ops: candidate.hitter.ops, hr: candidate.hitter.hr, avg: candidate.hitter.avg,
    obp: candidate.hitter.obp, slg: candidate.hitter.slg, rbi: candidate.hitter.rbi, sb: candidate.hitter.sb,
    games: candidate.hitter.games, plateAppearances: candidate.hitter.plateAppearances,
  } : null
  const pitcherVisible = candidate.pitcher ? {
    war: null, eraPlus: null, era: candidate.pitcher.era, whip: candidate.pitcher.whip, so: candidate.pitcher.so,
    wins: candidate.pitcher.wins, saves: candidate.pitcher.sv, sv: candidate.pitcher.sv,
    inningsPitched: candidate.pitcher.inningsPitched, games: candidate.pitcher.games, starts: candidate.pitcher.starts,
    reliefAppearances: candidate.pitcher.reliefAppearances, k9: candidate.pitcher.k9, bb9: candidate.pitcher.bb9,
  } : null
  const hitterScoring = candidate.hitter ? {
    obp: candidate.hitter.obp, slg: candidate.hitter.slg, wrcPlus: null, offensiveValue: null,
    defensiveValue: null, baserunningValue: null, games: candidate.hitter.games,
    plateAppearances: candidate.hitter.plateAppearances, eraAdjustedOffense: candidate.hitter.eraAdjustedOffense,
  } : null
  const pitcherScoring = candidate.pitcher ? {
    whip: candidate.pitcher.whip, fip: null, inningsPitched: candidate.pitcher.inningsPitched,
    strikeoutRate: candidate.pitcher.k9, walkRate: candidate.pitcher.bb9, starts: candidate.pitcher.starts,
    gamesStarted: candidate.pitcher.starts, games: candidate.pitcher.games,
    reliefAppearances: candidate.pitcher.reliefAppearances, eraAdjustedPitching: candidate.pitcher.eraAdjustedPitching,
  } : null
  const visibleStats = candidate.playerType === 'pitcher' ? pitcherVisible : hitterVisible
  return {
    id: candidate.id, playerId: candidate.playerId, playerSlug: candidate.playerSlug, name: candidate.name,
    franchiseId: candidate.franchiseId, teamAbbreviation: candidate.teamAbbreviation,
    teamDisplayName: candidate.teamDisplayName, historicalTeamName: candidate.historicalTeamName, team: candidate.team,
    decade: candidate.decade, featuredSeason: candidate.featuredSeason, eligiblePositions: candidate.eligiblePositions,
    isTwoWay: candidate.isTwoWay, pitchingRole: candidate.pitchingRole, bats: candidate.bats, throws: candidate.throws,
    sourceMetadata: { verified: true, sourceLabel: source.label, sourceUrl: source.url, advancedStatsSourceUrls: [], verifiedAt: source.verifiedAt, lahmanTeamIds: candidate.sourceTeamIds, sourcePlayerId: candidate.playerId },
    sourceNotes: candidate.sourceNote, notes: candidate.sourceNote || null, manualPositionOverride: candidate.manualPositionOverride,
    selectionMetadata: { score: ROUND(candidate.selectionScore * 100, 3), formulaVersion },
    playerType: candidate.playerType, type: candidate.type, visibleStats,
    pitchingVisibleStats: candidate.playerType === 'twoWay' ? pitcherVisible : null, stats: visibleStats,
    scoringStats: candidate.playerType === 'pitcher' ? pitcherScoring : hitterScoring,
    pitchingScoringStats: candidate.playerType === 'twoWay' ? pitcherScoring : null,
  }
}

function applyFieldCorrections(card, corrections) {
  const applicable = corrections.filter(({ cardId }) => cardId === card.id)
  if (!applicable.length) return card
  const corrected = structuredClone(card)
  for (const correction of applicable) {
    let target = corrected
    const parts = correction.field.split('.')
    for (const part of parts.slice(0, -1)) {
      if (!target || typeof target !== 'object' || !(part in target)) throw new Error(`Invalid correction path ${correction.field} for ${card.id}`)
      target = target[part]
    }
    const final = parts.at(-1)
    if (!final || !target || typeof target !== 'object' || !(final in target)) throw new Error(`Invalid correction path ${correction.field} for ${card.id}`)
    target[final] = correction.value
  }
  corrected.sourceNotes = [corrected.sourceNotes, ...applicable.map(({ sourceLabel, reason }) => `${sourceLabel}: ${reason}`)].filter(Boolean).join(' ')
  corrected.notes = corrected.sourceNotes || null
  return corrected
}

export function canCompleteRoster(cards) {
  const slots = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'SP', 'SP', 'RP', 'RP']
  const assignedSlotByCard = new Map()
  function assign(slotIndex, visitedCards) {
    const position = slots[slotIndex]
    for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
      const card = cards[cardIndex]
      const positions = card.selectionEligiblePositions ?? card.eligiblePositions
      const eligible = position === 'DH' ? card.playerType !== 'pitcher' : positions.includes(position)
      if (!eligible || visitedCards.has(cardIndex)) continue
      visitedCards.add(cardIndex)
      const priorSlot = assignedSlotByCard.get(cardIndex)
      if (priorSlot === undefined || assign(priorSlot, visitedCards)) {
        assignedSlotByCard.set(cardIndex, slotIndex)
        return true
      }
    }
    return false
  }
  return slots.every((_, slotIndex) => assign(slotIndex, new Set()))
}

function coverageFor(cards) {
  return Object.fromEntries(Object.keys({ C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0, LF: 0, CF: 0, RF: 0, SP: 0, RP: 0 }).map((position) => [position, cards.filter(({ eligiblePositions }) => eligiblePositions.includes(position)).length]))
}

export function curatePool(cards, config) {
  const selected = new Map()
  for (const [position, target] of Object.entries(config.coverage)) {
    cards.filter((card) => (card.selectionEligiblePositions ?? card.eligiblePositions).includes(position)).sort((a, b) => b.selectionScore - a.selectionScore || compareText(a.name, b.name)).slice(0, target).forEach((card) => selected.set(card.id, card))
  }
  const ranked = [...cards].sort((a, b) => b.selectionScore - a.selectionScore || compareText(a.name, b.name))
  const legacyCoreTarget = Math.min(
    Object.values(config.coverage).reduce((total, target) => total + target, 0),
    config.pool.targetCards,
  )
  for (const card of ranked) if (selected.size < legacyCoreTarget) selected.set(card.id, card)
  const configuredQualityFloor = config.pool.minimumExpansionScore ?? Number.NEGATIVE_INFINITY
  const qualityFloor = selected.size
    ? Math.max(configuredQualityFloor, Math.min(...[...selected.values()].map(({ selectionScore }) => selectionScore)))
    : configuredQualityFloor
  for (const card of ranked) {
    if (selected.size >= config.pool.targetCards || card.selectionScore < qualityFloor) break
    selected.set(card.id, card)
  }
  for (const card of ranked) {
    if (selected.size >= config.pool.maximumCards || canCompleteRoster([...selected.values()]) || card.selectionScore < qualityFloor) break
    selected.set(card.id, card)
  }
  const result = [...selected.values()].sort((a, b) => b.selectionScore - a.selectionScore || compareText(a.name, b.name)).slice(0, config.pool.maximumCards)
  return result
}

export function validatePool(cards, combination, config) {
  const errors = []; const warnings = []
  if (cards.length < config.pool.minimumCards) errors.push(`Pool has ${cards.length} cards; minimum is ${config.pool.minimumCards}`)
  if (cards.length > config.pool.maximumCards) errors.push(`Pool has ${cards.length} cards; maximum is ${config.pool.maximumCards}`)
  const duplicateIds = cards.filter((card, index) => cards.findIndex(({ id }) => id === card.id) !== index)
  if (duplicateIds.length) errors.push('Duplicate card IDs')
  for (const card of cards) {
    if (card.franchiseId !== combination.franchiseId || card.decade !== combination.decade) errors.push(`${card.id}: franchise/decade mismatch`)
    if (decadeFor(card.featuredSeason) !== combination.decade) errors.push(`${card.id}: featured season outside decade`)
    if (!card.name || !card.eligiblePositions.length) errors.push(`${card.id}: missing identity or eligibility`)
    const duplicatePositions = card.eligiblePositions.filter((position, index) => card.eligiblePositions.indexOf(position) !== index)
    if (duplicatePositions.length) errors.push(`${card.id}: duplicate eligible positions ${[...new Set(duplicatePositions)].join(', ')}`)
    const invalidPositions = card.eligiblePositions.filter((position) => !POSITION_ORDER.includes(position))
    if (invalidPositions.length) errors.push(`${card.id}: invalid eligible positions ${[...new Set(invalidPositions)].join(', ')}`)
    if (card.playerType !== 'pitcher') {
      for (const field of ['ops', 'hr', 'avg', 'obp', 'slg', 'games', 'plateAppearances']) if (!Number.isFinite(card.visibleStats[field])) errors.push(`${card.id}: missing hitter ${field}`)
      for (const field of ['rbi', 'sb']) if (!Number.isFinite(card.visibleStats[field])) warnings.push(`${card.id}: unavailable hitter ${field}`)
    }
    const pitcherStats = card.playerType === 'twoWay' ? card.pitchingVisibleStats : card.playerType === 'pitcher' ? card.visibleStats : null
    if (pitcherStats) {
      for (const field of ['era', 'whip', 'so', 'wins', 'inningsPitched', 'games', 'starts', 'reliefAppearances', 'k9', 'bb9']) if (!Number.isFinite(pitcherStats[field])) errors.push(`${card.id}: missing pitcher ${field}`)
      if (!Number.isFinite(pitcherStats.sv)) warnings.push(`${card.id}: unavailable pitcher sv`)
    }
  }
  if (!canCompleteRoster(cards)) errors.push('Pool cannot complete the 14-slot roster')
  const coverage = coverageFor(cards)
  for (const [position, target] of Object.entries(config.coverage)) if (coverage[position] < target) warnings.push(`${position}: ${coverage[position]} choices; target is ${target}`)
  return { errors: [...new Set(errors)], warnings, coverage, rosterCompletable: canCompleteRoster(cards) }
}

export function buildLahmanData(root = process.cwd()) {
  const config = readJson(path.join(root, 'data-import/lahman-build-config.json'))
  const overrides = readJson(path.join(root, 'data-import/lahman-overrides.json'))
  const correctionErrors = (overrides.fieldCorrections ?? []).flatMap((correction, index) => {
    const missing = ['cardId', 'field', 'sourceLabel', 'reason'].filter((field) => !correction[field])
    if (correction.verified !== true) missing.push('verified=true')
    return missing.length ? [`fieldCorrections[${index}] missing ${missing.join(', ')}`] : []
  })
  for (const category of ['featuredSeasons', 'positions', 'names']) {
    for (const [id, entry] of Object.entries(overrides[category] ?? {})) {
      if (!entry || typeof entry !== 'object') correctionErrors.push(`${category}.${id} must be a documented override object`)
      else {
        const missing = ['sourceLabel', 'reason'].filter((field) => !entry[field])
        if (entry.verified !== true) missing.push('verified=true')
        if (missing.length) correctionErrors.push(`${category}.${id} missing ${missing.join(', ')}`)
      }
    }
  }
  if (correctionErrors.length) throw new Error(`Invalid Lahman overrides:\n${correctionErrors.join('\n')}`)
  const peopleRows = readCsv(root, 'People')
  const teams = readCsv(root, 'Teams').filter(({ yearID }) => NUMBER(yearID) >= config.years.minimum && NUMBER(yearID) <= config.years.maximum)
  const franchiseSourceRows = readCsv(root, 'TeamsFranchises')
  const franchiseRows = new Map(franchiseSourceRows.map((row) => [row.franchID, row]))
  const teamsByFranchise = new Map()
  for (const row of teams) { const list = teamsByFranchise.get(row.franchID) ?? []; list.push(row); teamsByFranchise.set(row.franchID, list) }
  const franchises = new Map([...teamsByFranchise].map(([id, rows]) => [id, deriveFranchiseIdentity(id, franchiseRows.get(id), rows)]))
  const teamByYear = new Map(teams.map((row) => [keyForTeamYear(NUMBER(row.yearID), row.teamID), { ...row, franchise: franchises.get(row.franchID) }]))
  const people = new Map(peopleRows.map((row) => [row.playerID, row]))
  const contexts = leagueContext(teams)
  const battingRows = readCsv(root, 'Batting').filter(({ yearID }) => NUMBER(yearID) >= config.years.minimum)
  const pitchingRows = readCsv(root, 'Pitching').filter(({ yearID }) => NUMBER(yearID) >= config.years.minimum)
  const fieldingRows = readCsv(root, 'Fielding')
  const appearancesRows = readCsv(root, 'Appearances')
  const legacyOutfieldRows = readCsv(root, 'FieldingOF')
  const outfieldSplitRows = readCsv(root, 'FieldingOFsplit')
  const batting = aggregateRows(battingRows, teamByYear, 'batting')
  const pitching = aggregateRows(pitchingRows, teamByYear, 'pitching')
  const baseFielding = aggregateFielding(fieldingRows, teamByYear)
  const appearanceFielding = aggregateAppearances(appearancesRows, teamByYear)
  const legacyOutfield = aggregateLegacyOutfield(legacyOutfieldRows, fieldingRows, teamByYear)
  const splitFielding = aggregateFielding(outfieldSplitRows, teamByYear)
  mergePositionMaps(baseFielding, appearanceFielding)
  mergePositionMaps(baseFielding, legacyOutfield)
  mergePositionMaps(baseFielding, splitFielding, true)
  const seasonKeys = new Set([...batting.keys(), ...pitching.keys()])
  const candidates = []
  for (const key of seasonKeys) {
    const battingRow = batting.get(key); const pitchingRow = pitching.get(key); const group = battingRow ?? pitchingRow
    const player = people.get(group.playerID)
    if (!player) continue
    const candidate = buildCandidate({ player, franchise: group.franchise, year: group.year, batting: battingRow, pitching: pitchingRow, positions: baseFielding.get(key), context: contexts, config, overrides })
    if (candidate) candidates.push(candidate)
  }
  const selected = selectFeatured(candidates, overrides)
  const byCombination = new Map()
  for (const candidate of selected) { const id = `${candidate.franchiseId}-${candidate.decade}`; const list = byCombination.get(id) ?? []; list.push(candidate); byCombination.set(id, list) }
  const combinations = []; const pools = {}; const poolReports = []; const excludedPools = []
  for (const [id, candidatesForPool] of [...byCombination].sort(([a], [b]) => compareText(a, b))) {
    const curated = curatePool(candidatesForPool, config)
    const cards = curated.map((candidate) => applyFieldCorrections(toCard(candidate, config.source, config.selection.formulaVersion), overrides.fieldCorrections ?? []))
    const [franchiseId, decade] = id.match(/^(.*)-(\d{4}s)$/).slice(1)
    const franchise = [...franchises.values()].find((value) => value.franchiseId === franchiseId)
    const combination = { id, franchiseId, team: franchise.team, teamName: franchise.teamName, decade }
    const validation = validatePool(cards, combination, config)
    const report = { id, cards: cards.length, candidateCards: candidatesForPool.length, ...validation }
    poolReports.push(report)
    if (validation.errors.length) { excludedPools.push(report); continue }
    combinations.push(combination); pools[id] = cards
  }
  const report = {
    schemaVersion: 1, generatedAt: config.source.verifiedAt, source: config.source,
    summary: {
      sourceRows: { people: peopleRows.length, teams: teams.length, teamFranchises: franchiseSourceRows.length, batting: battingRows.length, pitching: pitchingRows.length, fielding: fieldingRows.length, appearances: appearancesRows.length, legacyOutfield: legacyOutfieldRows.length, outfieldSplits: outfieldSplitRows.length },
      franchises: franchises.size, candidateSeasons: candidates.length, featuredCards: selected.length,
      attemptedPools: poolReports.length, validPools: combinations.length, excludedPools: excludedPools.length,
      cards: Object.values(pools).reduce((count, cards) => count + cards.length, 0),
      warnings: poolReports.reduce((count, pool) => count + pool.warnings.length, 0),
    },
    configuration: { years: config.years, pool: config.pool, eligibility: config.eligibility, coverage: config.coverage, selection: config.selection },
    franchises: [...franchises.values()].sort((a, b) => compareText(a.franchiseId, b.franchiseId)),
    validPoolCountsByDecade: Object.fromEntries([...new Set(combinations.map(({ decade }) => decade))].sort().map((decade) => [decade, combinations.filter((combination) => combination.decade === decade).length])),
    validPoolCountsByFranchise: Object.fromEntries([...franchises.values()].sort((a, b) => compareText(a.franchiseId, b.franchiseId)).map(({ franchiseId }) => [franchiseId, combinations.filter((combination) => combination.franchiseId === franchiseId).length])),
    pools: poolReports, excludedPools,
    overrides: {
      featuredSeasons: Object.keys(overrides.featuredSeasons ?? {}).length,
      positions: Object.keys(overrides.positions ?? {}).length,
      names: Object.keys(overrides.names ?? {}).length,
      notes: Object.keys(overrides.notes ?? {}).length,
      fieldCorrections: overrides.fieldCorrections?.length ?? 0,
    },
  }
  return { config, combinations, pools, report, auditContext: { candidates, selected, overrides } }
}

export function validateGeneratedData(root = process.cwd(), options = {}) {
  const config = readJson(path.join(root, 'data-import/lahman-build-config.json'))
  const sharedVersionMetadata = readSharedVersionMetadata(root)
  const sharedVersionMetadataErrors = validateSharedVersionMetadata(sharedVersionMetadata)
  const generated = path.join(root, 'src/data/generated')
  const combinations = readJson(path.join(generated, 'combinations.json'))
  const combinationErrors = validateCanonicalCombinations(combinations)
  const errors = findGeneratedConflictCopyFiles(root)
    .map((file) => `generated data conflict-copy filename is not allowed: ${file}`)
  errors.push(...sharedVersionMetadataErrors, ...combinationErrors)
  if (combinationErrors.length) {
    return { errors, combinations: Array.isArray(combinations) ? combinations.length : 0, cards: 0, pools: [], dataDigest: null }
  }
  const combinationIds = combinations.map(({ id }) => id)
  const expectedFiles = new Set(combinationIds.map((id) => `${id}.json`))
  const validateWorkerCatalog = options.validateWorkerCatalog !== false
  const expectedTopLevelJson = new Set(['combinations.json', 'data-report.json', 'franchises.json', 'readiness.json', 'worker-catalog.json'])
  for (const entry of fs.readdirSync(generated, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json') && !expectedTopLevelJson.has(entry.name)) {
      errors.push(`unexpected generated JSON file: src/data/generated/${entry.name}`)
    }
  }
  const allPoolFiles = fs.readdirSync(path.join(generated, 'pools')).filter((name) => name.endsWith('.json'))
  const allRuntimeFiles = fs.readdirSync(path.join(generated, 'runtime-pools')).filter((name) => name.endsWith('.json'))
  const poolFiles = allPoolFiles.filter((name) => expectedFiles.has(name))
  const runtimeFiles = allRuntimeFiles.filter((name) => expectedFiles.has(name))
  const indexedIds = new Set(combinationIds)
  if (combinationIds.some((id, index) => index > 0 && compareText(combinationIds[index - 1], id) > 0)) errors.push('canonical combinations must remain sorted by ID')
  for (const [directory, files] of [['pools', allPoolFiles], ['runtime-pools', allRuntimeFiles]]) {
    for (const file of files) {
      if (!expectedFiles.has(file) && !isGeneratedConflictCopyFilename(file)) errors.push(`unexpected generated JSON file: src/data/generated/${directory}/${file}`)
    }
  }
  const runtimePools = Object.fromEntries(combinations.flatMap(({ id }) => {
    const filename = `${id}.json`
    return runtimeFiles.includes(filename)
      ? [[id, readJson(path.join(generated, 'runtime-pools', filename))]]
      : []
  }))
  const pools = []; const cardLocations = new Map()
  for (const file of poolFiles) {
    const id = file.slice(0, -5)
    const cards = readJson(path.join(generated, 'pools', file))
    const combination = combinations.find((value) => value.id === id)
    if (!combination) { errors.push(`${id}: pool file is not indexed`); continue }
    const validation = validatePool(cards, combination, config)
    errors.push(...validation.errors.map((message) => `${id}: ${message}`))
    for (const card of cards) {
      const existingPool = cardLocations.get(card.id)
      if (existingPool) errors.push(`${card.id}: canonical card ID is duplicated across ${existingPool} and ${id}`)
      else cardLocations.set(card.id, id)
    }
    const runtimeFile = `${id}.json`
    if (runtimeFiles.includes(runtimeFile)) {
      const runtimeCards = runtimePools[id]
      if (runtimeCards.length !== cards.length) errors.push(`${id}: runtime pool card count mismatch`)
      if (runtimeCards.some((card, index) => card.id !== cards[index]?.id)) errors.push(`${id}: runtime pool identity mismatch`)
      const expectedRuntimeCards = createRuntimePools({ [id]: cards })[id]
      if (canonicalJson(runtimeCards) !== canonicalJson(expectedRuntimeCards)) errors.push(`${id}: runtime pool payload does not match canonical generated data`)
    }
    pools.push({ id, cards: cards.length, ...validation })
  }
  for (const id of indexedIds) if (!poolFiles.includes(`${id}.json`)) errors.push(`${id}: indexed pool file is missing`)
  for (const id of indexedIds) if (!runtimeFiles.includes(`${id}.json`)) errors.push(`${id}: indexed runtime pool file is missing`)
  const indexPath = path.join(generated, 'index.ts')
  if (!fs.existsSync(indexPath)) errors.push('generated runtime index is missing')
  else if (fs.readFileSync(indexPath, 'utf8') !== createGeneratedRegistry(combinations)) errors.push('generated runtime index does not match canonical combinations')
  const cards = pools.reduce((total, pool) => total + pool.cards, 0)
  const runtimeDataComplete = combinations.every(({ id }) => Array.isArray(runtimePools[id]))
  const dataDigest = runtimeDataComplete && indexedIds.size === combinationIds.length
    ? calculateCanonicalDataDigest(combinations, runtimePools)
    : null
  const readinessPath = path.join(generated, 'readiness.json')
  if (!fs.existsSync(readinessPath)) errors.push('runtime readiness manifest is missing')
  else {
    const readiness = readJson(readinessPath)
    if (readiness.schemaVersion !== READINESS_SCHEMA_VERSION) errors.push(`runtime readiness schema must be ${READINESS_SCHEMA_VERSION}`)
    if (readiness.blockingErrors !== 0) errors.push('runtime readiness manifest contains blocking errors')
    if (readiness.combinations !== combinations.length || readiness.pools !== pools.length || readiness.cards !== cards) errors.push('runtime readiness manifest does not match generated data')
    if (!sharedVersionMetadataErrors.length) {
      const expectedVersionFields = generatedVersionFields(sharedVersionMetadata, dataDigest)
      for (const [field, expected] of Object.entries(expectedVersionFields)) {
        if (field === 'dataDigest' && dataDigest === null) continue
        if (readiness[field] !== expected) errors.push(`runtime readiness ${field} does not match shared/generated version metadata`)
      }
    }
    if (typeof readiness.dataDigest !== 'string' || !/^[a-f0-9]{64}$/.test(readiness.dataDigest)) errors.push('runtime readiness dataDigest must be a lowercase SHA-256 hex digest')
  }
  if (validateWorkerCatalog && dataDigest !== null && !sharedVersionMetadataErrors.length) {
    const workerCatalogPath = path.join(generated, 'worker-catalog.json')
    if (!fs.existsSync(workerCatalogPath)) errors.push('generated Worker catalog is missing')
    else {
      const expectedWorkerCatalog = serializeWorkerCatalog(createWorkerCatalog(
        combinations,
        runtimePools,
        sharedVersionMetadata,
        dataDigest,
      ))
      if (fs.readFileSync(workerCatalogPath, 'utf8') !== expectedWorkerCatalog) {
        errors.push('generated Worker catalog does not match canonical runtime data')
      }
    }
  }
  return { errors, combinations: combinations.length, cards, pools, dataDigest }
}

export function writeGeneratedData(root, built) {
  const directory = path.join(root, 'src/data/generated')
  const poolsDirectory = path.join(directory, 'pools')
  const runtimePoolsDirectory = path.join(directory, 'runtime-pools')
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  const combinationErrors = validateCanonicalCombinations(built.combinations)
  const combinationIds = combinationErrors.length ? [] : built.combinations.map(({ id }) => id)
  if (combinationIds.some((id, index) => index > 0 && compareText(combinationIds[index - 1], id) > 0)) {
    combinationErrors.push('canonical combinations must remain sorted by ID')
  }
  const expectedPoolIds = new Set(combinationIds)
  const poolIds = Object.keys(built.pools)
  for (const id of combinationIds) if (!Object.hasOwn(built.pools, id)) combinationErrors.push(`canonical pool is missing: ${id}`)
  for (const id of poolIds) if (!expectedPoolIds.has(id)) combinationErrors.push(`canonical pool is not indexed: ${id}`)
  if (combinationErrors.length) throw new Error(`Invalid generated data allowlist:\n${combinationErrors.join('\n')}`)
  const runtimePools = createRuntimePools(built.pools)
  const sharedVersionMetadata = readSharedVersionMetadata(root)
  const versionMetadataErrors = validateSharedVersionMetadata(sharedVersionMetadata)
  if (versionMetadataErrors.length) throw new Error(`Invalid shared version metadata:\n${versionMetadataErrors.join('\n')}`)
  const dataDigest = calculateCanonicalDataDigest(built.combinations, runtimePools)
  const workerCatalog = createWorkerCatalog(built.combinations, runtimePools, sharedVersionMetadata, dataDigest)
  const generatedRegistry = createGeneratedRegistry(built.combinations)
  const expectedPoolFiles = new Set(poolIds.map((id) => `${id}.json`))
  const generatedPoolFiles = Object.entries(built.pools).map(([id, cards]) => ({
    filename: `${id}.json`,
    full: json(cards),
    runtime: json(runtimePools[id]),
  }))
  const topLevelFiles = {
    'combinations.json': json(built.combinations),
    'franchises.json': json(built.report.franchises),
    'data-report.json': json(built.report),
    'readiness.json': json({
      schemaVersion: READINESS_SCHEMA_VERSION,
      ...generatedVersionFields(sharedVersionMetadata, dataDigest),
      combinations: built.combinations.length,
      pools: Object.keys(built.pools).length,
      cards: Object.values(built.pools).reduce((total, cards) => total + cards.length, 0),
      blockingErrors: 0,
    }),
    'worker-catalog.json': serializeWorkerCatalog(workerCatalog),
  }

  // Finish every validation and serialization step before mutating generated data.
  fs.mkdirSync(poolsDirectory, { recursive: true })
  fs.mkdirSync(runtimePoolsDirectory, { recursive: true })
  for (const [filename, contents] of Object.entries(topLevelFiles)) {
    fs.writeFileSync(path.join(directory, filename), contents)
  }
  for (const { filename, full, runtime } of generatedPoolFiles) {
    fs.writeFileSync(path.join(poolsDirectory, filename), full)
    fs.writeFileSync(path.join(runtimePoolsDirectory, filename), runtime)
  }
  for (const name of fs.readdirSync(poolsDirectory)) if (name.endsWith('.json') && !expectedPoolFiles.has(name)) fs.unlinkSync(path.join(poolsDirectory, name))
  for (const name of fs.readdirSync(runtimePoolsDirectory)) if (name.endsWith('.json') && !expectedPoolFiles.has(name)) fs.unlinkSync(path.join(runtimePoolsDirectory, name))
  fs.writeFileSync(path.join(directory, 'index.ts'), generatedRegistry)
}
