import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalHash } from './lib/preview-release/canonical.mjs'
import { createReadOnlyCloudflareClient, inspectPreviewRemoteState } from './lib/preview-release/cloudflare-readonly.mjs'
import { asWorkflowError, EXIT_CODES, remoteError, usageError } from './lib/preview-release/errors.mjs'
import { computeReleaseHashes, inspectLocalState, inspectServerDevelop } from './lib/preview-release/local-state.mjs'
import { requireResolvedRemoteIdentity } from './lib/preview-release/manifest.mjs'
import { classifyMigrationState, loadRepositoryMigrations } from './lib/preview-release/migrations.mjs'
import { buildReleasePlan } from './lib/preview-release/plan.mjs'
import { failureReport, renderHumanPlan } from './lib/preview-release/reporting.mjs'
import { runOfflineReleaseValidation } from './preview-check.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')

export function assertStableObservationWindow({ initialLocal, finalLocal, initialServerHead, finalServerHead, initialRemote, finalRemote }) {
  if (canonicalHash(initialLocal) !== canonicalHash(finalLocal)) throw remoteError('Local repository state changed during Preview planning.', 'stale_local_snapshot', 'plan.snapshot')
  if (initialServerHead !== finalServerHead) throw remoteError('Server-side develop changed during Preview planning.', 'stale_server_snapshot', 'plan.snapshot')
  if (canonicalHash(initialRemote) !== canonicalHash(finalRemote)) throw remoteError('Cloudflare Preview state changed during Preview planning.', 'ambiguous_remote_state', 'plan.snapshot')
}

export function parsePreviewPlanArguments(argv) {
  let targetState
  let json = false
  let color = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--target-state') {
      if (targetState !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) throw usageError('--target-state requires exactly one value.')
      targetState = argv[index + 1]
      index += 1
    } else if (argument === '--json') {
      if (json) throw usageError('--json may be specified only once.')
      json = true
    } else if (argument === '--no-color') {
      if (!color) throw usageError('--no-color may be specified only once.')
      color = false
    } else {
      throw usageError(`Unknown argument: ${argument}.`)
    }
  }
  if (!targetState) throw usageError('preview:plan requires --target-state <disabled|submission-enabled|cron-enabled>.')
  if (!['disabled', 'submission-enabled', 'cron-enabled'].includes(targetState)) throw usageError(`Unknown target state: ${targetState}.`)
  return Object.freeze({ targetState, json, color })
}

export async function createPreviewPlan({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  targetState,
  token = process.env.PENNANT_PREVIEW_API_TOKEN,
  runner,
  processRunner,
  client,
  fetchImplementation,
  output = console,
  captureStages = false,
  runQualityStages = true,
  color = true,
} = {}) {
  const context = runOfflineReleaseValidation({ repositoryRoot, runner, processRunner, output, captureStages, runQualityStages, color })
  const compiled = context.compiledStates[targetState]
  if (!compiled) throw usageError(`Unknown target state: ${targetState}.`)
  if (typeof token !== 'string' || token.length === 0) createReadOnlyCloudflareClient({ manifest: context.loaded.manifest, token })
  requireResolvedRemoteIdentity(context.loaded.manifest)
  const serverHead = inspectServerDevelop({ repositoryRoot, manifest: context.loaded.manifest, ...(runner ? { runner } : {}) })
  if (serverHead !== context.local.head) throw remoteError('Current HEAD differs from server-side develop.', 'server_git_mismatch', 'remote.git-head')
  const readOnlyClient = client ?? createReadOnlyCloudflareClient({ manifest: context.loaded.manifest, token, fetchImplementation })
  const remote = await inspectPreviewRemoteState({ manifest: context.loaded.manifest, client: readOnlyClient })
  const knownMigrations = loadRepositoryMigrations(repositoryRoot, context.loaded.manifest.configuration.migrationsDirectory)
  const migration = classifyMigrationState({ knownMigrations, ...remote.migrationObservation })
  const hashes = computeReleaseHashes({
    repositoryRoot,
    manifestHash: context.loaded.hash,
    configurationHash: compiled.hashes.combined,
    toolchain: context.local.toolchain,
    ...(runner ? { runner } : {}),
  })
  buildReleasePlan({
    manifest: context.loaded.manifest,
    manifestHash: context.loaded.hash,
    local: context.local,
    serverHead,
    targetState,
    compiled,
    hashes,
    remote,
    migration,
  })
  const finalRemote = await inspectPreviewRemoteState({ manifest: context.loaded.manifest, client: readOnlyClient })
  const finalLocal = inspectLocalState({ repositoryRoot, manifest: context.loaded.manifest, ...(runner ? { runner } : {}) })
  const finalServerHead = inspectServerDevelop({ repositoryRoot, manifest: context.loaded.manifest, ...(runner ? { runner } : {}) })
  const finalHashes = computeReleaseHashes({
    repositoryRoot,
    manifestHash: context.loaded.hash,
    configurationHash: compiled.hashes.combined,
    toolchain: finalLocal.toolchain,
    ...(runner ? { runner } : {}),
  })
  assertStableObservationWindow({
    initialLocal: context.local,
    finalLocal,
    initialServerHead: serverHead,
    finalServerHead,
    initialRemote: remote,
    finalRemote,
  })
  const finalMigration = classifyMigrationState({ knownMigrations, ...finalRemote.migrationObservation })
  if (canonicalHash(migration) !== canonicalHash(finalMigration)) throw remoteError('Preview migration state changed during planning.', 'ambiguous_migration_state', 'plan.snapshot')
  if (canonicalHash(hashes) !== canonicalHash(finalHashes)) throw remoteError('Deployment inputs changed during planning.', 'stale_artifact_snapshot', 'plan.snapshot')
  return buildReleasePlan({
    manifest: context.loaded.manifest,
    manifestHash: context.loaded.hash,
    local: finalLocal,
    serverHead: finalServerHead,
    targetState,
    compiled,
    hashes: finalHashes,
    remote: finalRemote,
    migration: finalMigration,
  })
}

export async function runPreviewPlanCli(argv, options = {}) {
  const parsed = parsePreviewPlanArguments(argv)
  const plan = await createPreviewPlan({ ...options, ...parsed, captureStages: parsed.json })
  ;(options.output ?? console).log(parsed.json ? JSON.stringify(plan) : renderHumanPlan(plan, parsed.color))
  return EXIT_CODES.SUCCESS
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    process.exitCode = await runPreviewPlanCli(process.argv.slice(2))
  } catch (error) {
    const safe = asWorkflowError(error)
    if (process.argv.includes('--json')) console.log(JSON.stringify(failureReport('preview:plan', safe, [], [process.env.PENNANT_PREVIEW_API_TOKEN])))
    else console.error(`\n[preview:plan] ${safe.status}: ${safe.message}`)
    process.exitCode = safe.exitCode
  }
}
