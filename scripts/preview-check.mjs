import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compilePreviewState, validateConfigurationModel } from './lib/preview-release/configuration.mjs'
import { validateRuntimeCommandGraph } from './lib/preview-release/command-safety.mjs'
import { canonicalHash } from './lib/preview-release/canonical.mjs'
import { createReadOnlyCloudflareClient, inspectPreviewRemoteState } from './lib/preview-release/cloudflare-readonly.mjs'
import { asWorkflowError, EXIT_CODES, remoteError, usageError } from './lib/preview-release/errors.mjs'
import { computeReleaseHashes, inspectLocalState, inspectServerDevelop } from './lib/preview-release/local-state.mjs'
import { loadReleaseManifest, requireResolvedRemoteIdentity } from './lib/preview-release/manifest.mjs'
import { classifyMigrationState, loadRepositoryMigrations } from './lib/preview-release/migrations.mjs'
import { buildReleasePlan } from './lib/preview-release/plan.mjs'
import { check, checkReport, failureReport, renderHumanCheck } from './lib/preview-release/reporting.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const EXPECTED_PACKAGE_NAME = 'pennant-pursuit'
const EXPECTED_BRANCH = 'develop'
const EXPECTED_UPSTREAM = 'origin/develop'

function stage(label, command, args) {
  return Object.freeze({ label, command, args: Object.freeze([...args]) })
}

function npmRunStage(label, scriptName) {
  return stage(label, 'npm', ['run', scriptName])
}

export const TYPECHECK_STAGES = Object.freeze([
  npmRunStage('Application type check', 'app:typecheck'),
  npmRunStage('Pages Functions generated-type check', 'functions:types:check'),
  npmRunStage('Pages Functions type check', 'functions:typecheck'),
  npmRunStage('Private Worker generated-type check', 'validation-worker:types:check'),
  npmRunStage('Private Worker type check', 'validation-worker:typecheck'),
  npmRunStage('D1C.4 tooling type check', 'd1c4:typecheck'),
])

export const TEST_STAGES = Object.freeze([
  npmRunStage('Lahman data pipeline tests', 'test:data'),
  npmRunStage('Legacy player pipeline tests', 'test:data:legacy'),
  npmRunStage('Draft engine tests', 'test:engine'),
  npmRunStage('Game smoke tests', 'test:game'),
  npmRunStage('Navigation tests', 'test:navigation'),
  npmRunStage('Scoring tests', 'test:scoring'),
  npmRunStage('Seeded random tests', 'test:rng'),
  npmRunStage('Transcript replay tests', 'test:replay'),
  npmRunStage('Server validation tests', 'test:server-validation'),
  npmRunStage('Draft ticket tests', 'test:draft-ticket'),
  npmRunStage('Workerd timing-safe-equality tests', 'test:draft-timing-safe-workerd'),
  npmRunStage('Private Worker tests', 'test:validation-worker'),
  npmRunStage('Randomizer tests', 'test:randomizer'),
  npmRunStage('Randomizer distribution tests', 'test:randomizer-distribution'),
  npmRunStage('Responsive layout contract tests', 'test:responsive'),
  npmRunStage('Presentation tests', 'test:presentation'),
  npmRunStage('Backend and resource identity tests', 'test:backend'),
  npmRunStage('Production migration guard tests', 'test:production-migration'),
  npmRunStage('Release readiness tests', 'test:release'),
  npmRunStage('PWA tests', 'test:pwa'),
  npmRunStage('Preview check orchestration tests', 'test:preview-check'),
  npmRunStage('Preview workflow Phase 1 tests', 'test:preview-workflow'),
])

export const RELEASE_STAGES = Object.freeze([
  npmRunStage('D1C.4 activation-state validation', 'd1c4:activation:check'),
  stage('All repository type checks', 'npm', ['run', 'typecheck']),
  stage('All release-relevant automated tests and resource identity checks', 'npm', ['test']),
  npmRunStage('Lint', 'lint'),
  npmRunStage('Production build', 'build'),
  npmRunStage('PWA validation', 'test:pwa'),
  npmRunStage('Preview private Worker dry-run build', 'validation-worker:build'),
  npmRunStage('Production private Worker dry-run build', 'validation-worker:production:build'),
  npmRunStage('Pages Functions build', 'pages:functions:build'),
  npmRunStage('Bundle size and hash validation', 'validation-bundles:check'),
])

export class StageFailure extends Error {
  constructor(stageName, message) {
    super(`[${stageName}] ${message}`)
    this.name = 'StageFailure'
    this.stageName = stageName
  }
}

const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR', 'FORCE_COLOR',
])

export function credentialFreeEnvironment(environment = process.env) {
  const safe = Object.fromEntries(SAFE_ENVIRONMENT_KEYS
    .filter((key) => typeof environment[key] === 'string')
    .map((key) => [key, environment[key]]))
  return {
    ...safe,
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_HIDE_BANNER: 'true',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
  }
}

export function createProcessRunner(spawn = spawnSync, environment = process.env) {
  const safeEnvironment = credentialFreeEnvironment(environment)
  return (command, args, { capture = false, cwd = DEFAULT_REPOSITORY_ROOT } = {}) => spawn(command, args, {
    cwd,
    shell: false,
    env: safeEnvironment,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
}

function commandText(command, args) {
  return [command, ...args].join(' ')
}

function announce(output, stageDefinition) {
  output.log(`\n[preview:check] ${stageDefinition.label}`)
  output.log(`> ${commandText(stageDefinition.command, stageDefinition.args)}`)
}

function resultOutput(result) {
  return [result.stdout, result.stderr]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()
}

function assertCompleted(stageName, result, includeOutput = true) {
  if (result.error) throw new StageFailure(stageName, result.error.message)
  if (result.signal) throw new StageFailure(stageName, `Command terminated by signal ${result.signal}.`)
  if (result.status !== 0) {
    const details = includeOutput ? resultOutput(result) : ''
    throw new StageFailure(stageName, details || `Command exited with status ${result.status ?? 'unknown'}.`)
  }
}

function runCaptured(stageDefinition, context) {
  announce(context.output, stageDefinition)
  const result = context.runner(stageDefinition.command, stageDefinition.args, {
    capture: true,
    cwd: context.cwd,
  })
  return result
}

function readPackageName(repositoryRoot) {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
  return packageJson.name
}

function parseRepositoryRoot(stdout) {
  const paths = String(stdout ?? '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)

  if (paths.length !== 1 || !path.isAbsolute(paths[0])) {
    throw new StageFailure('Repository identity', 'Git returned an unreadable repository root.')
  }

  return path.normalize(paths[0])
}

export function runRepositoryPreflight({
  cwd = DEFAULT_REPOSITORY_ROOT,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  runner = createProcessRunner(),
  output = console,
  packageName = () => readPackageName(repositoryRoot),
} = {}) {
  const context = { cwd, runner, output }

  const identityStage = stage('Repository identity', 'git', ['rev-parse', '--show-toplevel'])
  const identity = runCaptured(identityStage, context)
  assertCompleted(identityStage.label, identity)
  const actualRoot = parseRepositoryRoot(identity.stdout)
  const expectedRoot = path.normalize(path.resolve(repositoryRoot))
  if (actualRoot !== expectedRoot) {
    throw new StageFailure(identityStage.label, `Expected repository root ${expectedRoot}; found ${actualRoot}.`)
  }
  if (packageName() !== EXPECTED_PACKAGE_NAME) {
    throw new StageFailure(identityStage.label, `Expected package ${EXPECTED_PACKAGE_NAME} at ${expectedRoot}.`)
  }
  output.log(`[preview:check] Repository root: ${actualRoot}`)

  const branchStage = stage('Current branch', 'git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const branch = runCaptured(branchStage, context)
  assertCompleted(branchStage.label, branch)
  if (String(branch.stdout).trim() !== EXPECTED_BRANCH) {
    throw new StageFailure(branchStage.label, `Expected ${EXPECTED_BRANCH}; found ${String(branch.stdout).trim() || 'detached HEAD'}.`)
  }
  output.log(`[preview:check] Branch: ${EXPECTED_BRANCH}`)

  const upstreamStage = stage('Upstream branch', 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  const upstream = runCaptured(upstreamStage, context)
  if (upstream.status !== 0 || upstream.error || upstream.signal) {
    throw new StageFailure(upstreamStage.label, `Expected upstream ${EXPECTED_UPSTREAM}, but no valid upstream is configured.`)
  }
  if (String(upstream.stdout).trim() !== EXPECTED_UPSTREAM) {
    throw new StageFailure(upstreamStage.label, `Expected ${EXPECTED_UPSTREAM}; found ${String(upstream.stdout).trim() || 'none'}.`)
  }
  output.log(`[preview:check] Upstream: ${EXPECTED_UPSTREAM}`)

  const trackedStage = stage('Tracked worktree changes', 'git', ['diff', '--quiet', '--exit-code'])
  const tracked = runCaptured(trackedStage, context)
  if (tracked.status === 1) throw new StageFailure(trackedStage.label, 'Tracked worktree changes are not allowed.')
  assertCompleted(trackedStage.label, tracked)

  const stagedStage = stage('Staged changes', 'git', ['diff', '--cached', '--quiet', '--exit-code'])
  const staged = runCaptured(stagedStage, context)
  if (staged.status === 1) throw new StageFailure(stagedStage.label, 'Staged changes are not allowed.')
  assertCompleted(stagedStage.label, staged)

  const untrackedStage = stage('Untracked files', 'git', ['ls-files', '--others', '--exclude-standard', '-z'])
  const untracked = runCaptured(untrackedStage, context)
  assertCompleted(untrackedStage.label, untracked)
  const untrackedPaths = String(untracked.stdout).split('\0').filter(Boolean)
  if (untrackedPaths.length > 0) {
    const sample = untrackedPaths.slice(0, 5).join(', ')
    const remainder = untrackedPaths.length > 5 ? ` and ${untrackedPaths.length - 5} more` : ''
    throw new StageFailure(untrackedStage.label, `Untracked files are not allowed: ${sample}${remainder}.`)
  }

  const divergenceStage = stage('Divergence from origin/develop', 'git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop'])
  const divergence = runCaptured(divergenceStage, context)
  assertCompleted(divergenceStage.label, divergence)
  const divergenceMatch = String(divergence.stdout).trim().match(/^(\d+)\s+(\d+)$/)
  if (!divergenceMatch) throw new StageFailure(divergenceStage.label, 'Git returned an unreadable divergence count.')
  const [, ahead, behind] = divergenceMatch
  if (ahead !== '0' || behind !== '0') {
    throw new StageFailure(divergenceStage.label, `Expected 0 0; found ${ahead} ${behind}.`)
  }
  output.log(`[preview:check] Divergence: ${ahead} ${behind}`)

  const diffCheckStage = stage('Git whitespace validation', 'git', ['diff', '--check'])
  const diffCheck = runCaptured(diffCheckStage, context)
  assertCompleted(diffCheckStage.label, diffCheck)
}

export function runStages(stages, {
  cwd = DEFAULT_REPOSITORY_ROOT,
  runner = createProcessRunner(),
  output = console,
  capture = false,
} = {}) {
  for (const stageDefinition of stages) {
    announce(output, stageDefinition)
    const result = runner(stageDefinition.command, stageDefinition.args, { capture, cwd })
    assertCompleted(stageDefinition.label, result, !capture)
  }
}

export function parsePreviewCheckArguments(argv) {
  if (argv.includes('--tests') || argv.includes('--typecheck')) {
    if (argv.length !== 1) throw usageError('Internal test and typecheck modes cannot be combined with other flags.')
    return { internal: argv[0] }
  }
  const allowed = new Set(['--offline', '--online', '--json', '--no-color'])
  for (const argument of argv) if (!allowed.has(argument)) throw usageError(`Unknown argument: ${argument}.`)
  if (new Set(argv).size !== argv.length) throw usageError('Preview check flags may be specified only once.')
  if (argv.includes('--offline') && argv.includes('--online')) throw usageError('Choose either --offline or --online.')
  return Object.freeze({
    mode: argv.includes('--online') ? 'online' : 'offline',
    json: argv.includes('--json'),
    color: !argv.includes('--no-color'),
  })
}

export function runOfflineReleaseValidation({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  runner,
  processRunner,
  output = console,
  captureStages = false,
  runQualityStages = true,
  color = true,
} = {}) {
  const loaded = loadReleaseManifest(repositoryRoot)
  const local = inspectLocalState({ repositoryRoot, manifest: loaded.manifest, ...(runner ? { runner } : {}) })
  if (!captureStages) {
    output.log(`[preview:check] Repository root: ${local.repositoryRoot}`)
    output.log(`[preview:check] Branch: ${local.branch}`)
    output.log(`[preview:check] Upstream: ${local.upstream}`)
    output.log(`[preview:check] Divergence: ${local.divergence.ahead} ${local.divergence.behind}`)
  }
  const compiledStates = validateConfigurationModel(repositoryRoot, loaded.manifest)
  validateRuntimeCommandGraph(repositoryRoot, [...RELEASE_STAGES, ...TYPECHECK_STAGES, ...TEST_STAGES])
  const stageOutput = captureStages ? { log() {}, error() {} } : output
  const effectiveProcessRunner = processRunner ?? createProcessRunner(spawnSync, {
    ...process.env,
    ...(color ? {} : { NO_COLOR: '1', FORCE_COLOR: '0' }),
  })
  if (runQualityStages) runStages(RELEASE_STAGES, { cwd: repositoryRoot, runner: effectiveProcessRunner, output: stageOutput, capture: captureStages })
  return Object.freeze({ loaded, local, compiledStates })
}

export async function runPreviewCheck(options = {}) {
  const output = options.output ?? console
  const mode = options.mode ?? 'offline'
  const context = runOfflineReleaseValidation({
    ...options,
    output,
    captureStages: options.json === true,
  })
  const checks = [
    check('repository.local-state', 'PASS', 'Repository, Git, package, lockfile, and toolchain identities are exact.'),
    check('manifest.topology', 'PASS', 'Immutable Preview/Production topology is valid and separated.'),
    check('configuration.activation-states', 'PASS', 'All three Preview-only activation artifacts compile and preserve fail-closed invariants.'),
    check('quality.release-suite', 'PASS', 'All existing release-readiness stages passed.'),
  ]
  if (mode === 'online') {
    const token = options.token ?? process.env.PENNANT_PREVIEW_API_TOKEN
    if (typeof token !== 'string' || token.length === 0) createReadOnlyCloudflareClient({ manifest: context.loaded.manifest, token })
    requireResolvedRemoteIdentity(context.loaded.manifest)
    const serverHead = inspectServerDevelop({ repositoryRoot: options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT, manifest: context.loaded.manifest, ...(options.runner ? { runner: options.runner } : {}) })
    if (serverHead !== context.local.head) throw remoteError('Current HEAD differs from server-side develop.', 'server_git_mismatch', 'remote.git-head')
    const client = options.client ?? createReadOnlyCloudflareClient({ manifest: context.loaded.manifest, token, fetchImplementation: options.fetchImplementation })
    const remote = await inspectPreviewRemoteState({ manifest: context.loaded.manifest, client })
    const migrations = loadRepositoryMigrations(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT, context.loaded.manifest.configuration.migrationsDirectory)
    const migration = classifyMigrationState({ knownMigrations: migrations, ...remote.migrationObservation })
    const compiled = compilePreviewState(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT, context.loaded.manifest, 'disabled')
    const hashes = computeReleaseHashes({
      repositoryRoot: options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
      manifestHash: context.loaded.hash,
      configurationHash: compiled.hashes.combined,
      toolchain: context.local.toolchain,
      ...(options.runner ? { runner: options.runner } : {}),
    })
    buildReleasePlan({ manifest: context.loaded.manifest, manifestHash: context.loaded.hash, local: context.local, serverHead, targetState: 'disabled', compiled, hashes, remote, migration })
    const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT
    const finalRemote = await inspectPreviewRemoteState({ manifest: context.loaded.manifest, client })
    const finalLocal = inspectLocalState({ repositoryRoot, manifest: context.loaded.manifest, ...(options.runner ? { runner: options.runner } : {}) })
    const finalServerHead = inspectServerDevelop({ repositoryRoot, manifest: context.loaded.manifest, ...(options.runner ? { runner: options.runner } : {}) })
    const finalHashes = computeReleaseHashes({
      repositoryRoot,
      manifestHash: context.loaded.hash,
      configurationHash: compiled.hashes.combined,
      toolchain: finalLocal.toolchain,
      ...(options.runner ? { runner: options.runner } : {}),
    })
    if (canonicalHash(context.local) !== canonicalHash(finalLocal)) throw remoteError('Local repository state changed during online Preview checking.', 'stale_local_snapshot', 'remote.snapshot')
    if (serverHead !== finalServerHead) throw remoteError('Server-side develop changed during online Preview checking.', 'stale_server_snapshot', 'remote.snapshot')
    if (canonicalHash(remote) !== canonicalHash(finalRemote)) throw remoteError('Cloudflare Preview state changed during online Preview checking.', 'ambiguous_remote_state', 'remote.snapshot')
    if (canonicalHash(hashes) !== canonicalHash(finalHashes)) throw remoteError('Deployment inputs changed during online Preview checking.', 'stale_artifact_snapshot', 'remote.snapshot')
    const finalMigration = classifyMigrationState({ knownMigrations: migrations, ...finalRemote.migrationObservation })
    if (canonicalHash(migration) !== canonicalHash(finalMigration)) throw remoteError('Preview migration state changed during online checking.', 'ambiguous_migration_state', 'remote.snapshot')
    buildReleasePlan({ manifest: context.loaded.manifest, manifestHash: context.loaded.hash, local: finalLocal, serverHead: finalServerHead, targetState: 'disabled', compiled, hashes: finalHashes, remote: finalRemote, migration: finalMigration })
    checks.push(
      check('remote.git-head', 'PASS', 'Server-side develop exactly matches HEAD.'),
      check('remote.preview-topology', 'PASS', 'Allowlisted Cloudflare Preview identities and restrictions are exact.'),
      check('remote.migrations', 'PASS', `SELECT-only migration inspection classified stable state as ${finalMigration.classification}.`),
    )
  } else {
    checks.push(check('remote.preview-topology', 'NOT CHECKED', 'Offline mode made no network requests.'))
  }
  return checkReport({ mode, checks })
}

export async function runCli(argv, options = {}) {
  if (argv.length === 1 && argv[0] === '--tests') {
    validateRuntimeCommandGraph(options.cwd ?? DEFAULT_REPOSITORY_ROOT, [...RELEASE_STAGES, ...TYPECHECK_STAGES, ...TEST_STAGES])
    runStages(TEST_STAGES, options)
    ;(options.output ?? console).log('\n[test] All release-relevant automated tests passed.')
    return EXIT_CODES.SUCCESS
  }
  if (argv.length === 1 && argv[0] === '--typecheck') {
    validateRuntimeCommandGraph(options.cwd ?? DEFAULT_REPOSITORY_ROOT, [...RELEASE_STAGES, ...TYPECHECK_STAGES, ...TEST_STAGES])
    runStages(TYPECHECK_STAGES, options)
    ;(options.output ?? console).log('\n[typecheck] All repository type checks passed.')
    return EXIT_CODES.SUCCESS
  }
  const parsed = parsePreviewCheckArguments(argv)
  const report = await runPreviewCheck({ ...options, ...parsed })
  ;(options.output ?? console).log(parsed.json ? JSON.stringify(report) : renderHumanCheck(report, parsed.color))
  return EXIT_CODES.SUCCESS
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    process.exitCode = await runCli(process.argv.slice(2))
  } catch (error) {
    const safe = asWorkflowError(error)
    const json = process.argv.includes('--json')
    if (json) console.log(JSON.stringify(failureReport('preview:check', safe, [], [process.env.PENNANT_PREVIEW_API_TOKEN])))
    else console.error(`\n[preview:check] ${safe.status}: ${safe.message}`)
    process.exitCode = safe.exitCode
  }
}
