import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

export function createProcessRunner(spawn = spawnSync, environment = process.env) {
  return (command, args, { capture = false, cwd = DEFAULT_REPOSITORY_ROOT } = {}) => spawn(command, args, {
    cwd,
    shell: false,
    env: {
      ...environment,
      WRANGLER_WRITE_LOGS: 'false',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_HIDE_BANNER: 'true',
    },
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

function assertCompleted(stageName, result) {
  if (result.error) throw new StageFailure(stageName, result.error.message)
  if (result.signal) throw new StageFailure(stageName, `Command terminated by signal ${result.signal}.`)
  if (result.status !== 0) {
    const details = resultOutput(result)
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
} = {}) {
  for (const stageDefinition of stages) {
    announce(output, stageDefinition)
    const result = runner(stageDefinition.command, stageDefinition.args, { capture: false, cwd })
    assertCompleted(stageDefinition.label, result)
  }
}

export function runPreviewCheck(options = {}) {
  runRepositoryPreflight(options)
  runStages(RELEASE_STAGES, options)
  ;(options.output ?? console).log('\n[preview:check] All local Preview release-readiness checks passed. No remote operations ran.')
}

export function runCli(argv, options = {}) {
  if (argv.length === 0) {
    runPreviewCheck(options)
    return
  }
  if (argv.length === 1 && argv[0] === '--tests') {
    runStages(TEST_STAGES, options)
    ;(options.output ?? console).log('\n[test] All release-relevant automated tests passed.')
    return
  }
  if (argv.length === 1 && argv[0] === '--typecheck') {
    runStages(TYPECHECK_STAGES, options)
    ;(options.output ?? console).log('\n[typecheck] All repository type checks passed.')
    return
  }
  throw new Error(`Unknown arguments: ${argv.join(' ')}`)
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    console.error(`\n[preview:check] FAILED: ${error instanceof Error ? error.message : 'Unknown failure.'}`)
    process.exitCode = 1
  }
}
