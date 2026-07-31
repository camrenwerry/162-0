import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadRepositoryMigrations } from './preview-release/migrations.mjs'

const MODEL_PATH = 'config/preview-schema4-readiness.json'
const TARGET_SCHEMA = 4
const REQUIRED_MIGRATION = '0004_leaderboard_identity_ranking.sql'
const EXPECTED_PREFIX = [
  '0001_backend_foundation.sql',
  '0002_draft_submissions.sql',
  '0003_leaderboard_foundation.sql',
  REQUIRED_MIGRATION,
]

function refuse(message) {
  throw new Error(`Schema-4 activation refused: ${message}`)
}

function parseModel(repositoryRoot) {
  let model
  try {
    model = JSON.parse(readFileSync(path.join(repositoryRoot, MODEL_PATH), 'utf8'))
  } catch {
    refuse('the local readiness model is missing or malformed.')
  }
  if (
    model?.modelVersion !== 1
    || model.targetDatabaseSchema !== TARGET_SCHEMA
    || model.requiredMigration !== REQUIRED_MIGRATION
    || model.checkedInState !== 'disabled'
    || !Array.isArray(model.expectedMigrationPrefix)
    || model.expectedMigrationPrefix.at(-1) !== REQUIRED_MIGRATION
    || model.expectedHealth?.databaseSchemaVersion !== TARGET_SCHEMA
    || model.expectedHealth?.leaderboardRecovery !== 'schema-ready'
  ) refuse('the local readiness model is not the reviewed schema-4 contract.')
  return model
}

export function assertSchema4RepositoryReadiness(repositoryRoot) {
  const model = parseModel(repositoryRoot)
  const migrations = loadRepositoryMigrations(repositoryRoot)
  const names = migrations.map(({ name }) => name)
  if (JSON.stringify(names) !== JSON.stringify(model.expectedMigrationPrefix)) {
    refuse('the repository migration prefix is unexpected or migration 0004 is missing.')
  }
  const frontendSource = readFileSync(
    path.join(repositoryRoot, 'src/features/leaderboard/runtimeConfig.ts'),
    'utf8',
  )
  const recoverySource = readFileSync(
    path.join(repositoryRoot, 'functions/lib/leaderboard-recovery-mode.ts'),
    'utf8',
  )
  for (const gate of model.requiredPreviewGates.frontend) {
    if (!frontendSource.includes(gate)) refuse(`frontend gate ${gate} is missing.`)
  }
  if (!recoverySource.includes('LEADERBOARD_RECOVERY_MODE')) {
    refuse('the independent backend recovery gate is missing.')
  }
  return Object.freeze({ model, migrations })
}

export function assertSchema4MigrationTarget(migration, knownMigrations) {
  const names = knownMigrations.map(({ name }) => name)
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_PREFIX)) {
    refuse('migration 0004 is missing or the migration prefix is unexpected.')
  }
  if (!migration || migration.status !== 'valid') refuse('the database schema or migration state is unknown.')
  if (migration.backendVersion === 3) {
    if (
      migration.pending.length !== 1
      || migration.pending[0]?.name !== REQUIRED_MIGRATION
    ) refuse('exact schema 3 must have only migration 0004 pending.')
    return migration
  }
  if (migration.backendVersion === TARGET_SCHEMA && migration.pending.length === 0) return migration
  refuse(`expected exact schema 3 with one pending migration or exact schema ${TARGET_SCHEMA} with none pending.`)
}

function exactEnabledGate(source, gate) {
  return new RegExp(`^${gate} = "enabled"$`, 'm').test(source)
}

export function assertSchema4StateModelSupportsActivation(repositoryRoot) {
  const { model } = assertSchema4RepositoryReadiness(repositoryRoot)
  const pages = readFileSync(path.join(repositoryRoot, 'wrangler.toml'), 'utf8')
  const worker = readFileSync(
    path.join(repositoryRoot, 'workers/draft-validation/wrangler.toml'),
    'utf8',
  )
  const legacyStates = readFileSync(
    path.join(repositoryRoot, 'workers/draft-validation/d1c4-activation-states.json'),
    'utf8',
  )
  const missing = [
    ...model.requiredPreviewGates.pages.filter((gate) => !exactEnabledGate(pages, gate)),
    ...model.requiredPreviewGates.worker.filter((gate) => !exactEnabledGate(worker, gate)),
  ]
  if (
    missing.length > 0
    || !legacyStates.includes('"recoveryMode"')
    || !legacyStates.includes('"identityMode"')
  ) {
    refuse('the protected legacy activation model lacks the independent schema-4 identity/recovery gates; disabled state is the only allowed target.')
  }
}

export function assertSchema4ActivationPlan({
  repositoryRoot,
  targetState,
  migration,
  manifest,
}) {
  const { migrations } = assertSchema4RepositoryReadiness(repositoryRoot)
  if (targetState === 'disabled') return
  assertSchema4MigrationTarget(migration, migrations)
  if (
    manifest.cloudflare.account.status !== 'resolved'
    || manifest.cloudflare.production.pages.branch.status !== 'resolved'
    || manifest.cloudflare.production.pages.domains.status !== 'resolved'
  ) refuse('Production identity remains ambiguous.')
  assertSchema4StateModelSupportsActivation(repositoryRoot)
}
