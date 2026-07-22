import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertLocalReleaseGraph, collectReachableScripts } from './lib/preview-release/command-safety.mjs'
import { createFixedRunner } from './lib/preview-release/local-state.mjs'
import { createPreviewPlan } from './preview-plan.mjs'
import {
  RELEASE_STAGES,
  TEST_STAGES,
  TYPECHECK_STAGES,
  createProcessRunner,
  runRepositoryPreflight,
  runStages,
} from './preview-check.mjs'

const REPOSITORY_ROOT = '/fixture/pennant-pursuit'
const quietOutput = { log() {}, error() {} }
const key = (command, args) => JSON.stringify([command, args])
const result = (stdout = '', status = 0, stderr = '', extra = {}) => ({ status, stdout, stderr, ...extra })

const cleanResults = new Map([
  [key('git', ['rev-parse', '--show-toplevel']), result(`${REPOSITORY_ROOT}\n`)],
  [key('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']), result('develop\n')],
  [key('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']), result('origin/develop\n')],
  [key('git', ['diff', '--quiet', '--exit-code']), result()],
  [key('git', ['diff', '--cached', '--quiet', '--exit-code']), result()],
  [key('git', ['ls-files', '--others', '--exclude-standard', '-z']), result()],
  [key('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('0\t0\n')],
  [key('git', ['diff', '--check']), result()],
])

function fakeRunner(overrides = new Map()) {
  const calls = []
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args], options })
    return overrides.get(key(command, args)) ?? cleanResults.get(key(command, args)) ?? result()
  }
  return { calls, runner }
}

function runPreflight(overrides, {
  output = quietOutput,
  packageName = () => 'pennant-pursuit',
} = {}) {
  const fake = fakeRunner(overrides)
  runRepositoryPreflight({
    cwd: REPOSITORY_ROOT,
    repositoryRoot: REPOSITORY_ROOT,
    runner: fake.runner,
    output,
    packageName,
  })
  return fake
}

function capturedOutput() {
  const lines = []
  return {
    lines,
    output: {
      log: (...values) => lines.push(values.join(' ')),
      error: (...values) => lines.push(values.join(' ')),
    },
  }
}

const SHELL_EVALUATORS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'eval', 'exec'])

function coordinatorScriptReferences(stages) {
  return stages.map(({ label, command, args }) => {
    if (command !== 'npm') throw new Error(`Unsupported coordinator command in ${label}.`)
    if (args.length === 1 && args[0] === 'test') return 'test'
    if (args.length === 2 && args[0] === 'run' && /^[A-Za-z0-9:_-]+$/.test(args[1])) return args[1]
    throw new Error(`Unsupported coordinator npm arguments in ${label}.`)
  })
}

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function createCleanPreviewFixture({ resolvedRemote = false, unsafeOuterLifecycle = false, unsafeReachableLifecycle = false } = {}) {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pennant-preview-check-'))
  const repositoryRoot = path.join(temporaryRoot, 'repository')
  const remoteRoot = path.join(temporaryRoot, 'origin.git')
  try {
    mkdirSync(path.join(repositoryRoot, 'scripts'), { recursive: true })

    const coordinatorSource = readFileSync(new URL('./preview-check.mjs', import.meta.url), 'utf8')
    writeFileSync(path.join(repositoryRoot, 'scripts', 'preview-check.mjs'), coordinatorSource)
    cpSync(new URL('./preview-plan.mjs', import.meta.url), path.join(repositoryRoot, 'scripts/preview-plan.mjs'))
    cpSync(new URL('./lib/preview-release', import.meta.url), path.join(repositoryRoot, 'scripts/lib/preview-release'), { recursive: true })
    cpSync(new URL('./prepare-d1c4-activation.mjs', import.meta.url), path.join(repositoryRoot, 'scripts/prepare-d1c4-activation.mjs'))
    mkdirSync(path.join(repositoryRoot, 'config'), { recursive: true })
    const fixtureManifest = JSON.parse(readFileSync(new URL('../config/preview-release.json', import.meta.url), 'utf8'))
    fixtureManifest.repository.allowedRoots = [realpathSync(repositoryRoot)]
    if (resolvedRemote) {
      fixtureManifest.cloudflare.account = { status: 'resolved', id: 'a'.repeat(32), reason: '' }
      fixtureManifest.cloudflare.preview.worker.routeZoneIds = { status: 'resolved', values: ['b'.repeat(32)], reason: '' }
      fixtureManifest.cloudflare.production.pages.branch = { status: 'resolved', value: 'main', reason: '' }
      fixtureManifest.cloudflare.production.pages.domains = { status: 'resolved', values: ['pennant-pursuit.example'], reason: '' }
    }
    writeFileSync(path.join(repositoryRoot, 'config/preview-release.json'), `${JSON.stringify(fixtureManifest, null, 2)}\n`)
    cpSync(new URL('../wrangler.toml', import.meta.url), path.join(repositoryRoot, 'wrangler.toml'))
    mkdirSync(path.join(repositoryRoot, 'workers/draft-validation'), { recursive: true })
    cpSync(new URL('../workers/draft-validation/wrangler.toml', import.meta.url), path.join(repositoryRoot, 'workers/draft-validation/wrangler.toml'))
    cpSync(new URL('../workers/draft-validation/d1c4-activation-states.json', import.meta.url), path.join(repositoryRoot, 'workers/draft-validation/d1c4-activation-states.json'))
    cpSync(new URL('../migrations', import.meta.url), path.join(repositoryRoot, 'migrations'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'scripts', 'fixture-stage.mjs'), `
const required = {
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_HIDE_BANNER: 'true',
}
for (const [name, expected] of Object.entries(required)) {
  if (process.env[name] !== expected) {
    console.error(\`Expected \${name}=\${expected}.\`)
    process.exit(1)
  }
}
`)

    const stageScripts = coordinatorScriptReferences([...TYPECHECK_STAGES, ...TEST_STAGES, ...RELEASE_STAGES])
    const scripts = {
      test: 'node scripts/preview-check.mjs --tests',
      typecheck: 'node scripts/preview-check.mjs --typecheck',
    }
    for (const scriptName of stageScripts) {
      if (!(scriptName in scripts)) scripts[scriptName] = 'node scripts/prepare-d1c4-activation.mjs --check'
    }
    if (unsafeReachableLifecycle) {
      scripts.prelint = 'node scripts/unsafe-lifecycle.mjs'
      writeFileSync(path.join(repositoryRoot, 'scripts/unsafe-lifecycle.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('unsafe-lifecycle-ran', 'unsafe')\n")
    }
    if (unsafeOuterLifecycle) {
      for (const name of ['prepreview:check', 'postpreview:check', 'prepreview:plan', 'postpreview:plan']) scripts[name] = 'node scripts/unsafe-outer-lifecycle.mjs'
      writeFileSync(path.join(repositoryRoot, 'scripts/unsafe-outer-lifecycle.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('unsafe-outer-lifecycle-ran', 'unsafe')\n")
    }

    writeFileSync(path.join(repositoryRoot, 'package.json'), `${JSON.stringify({
      name: 'pennant-pursuit',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts,
    }, null, 2)}\n`)
    writeFileSync(path.join(repositoryRoot, 'package-lock.json'), `${JSON.stringify({
      name: 'pennant-pursuit',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'pennant-pursuit', version: '1.0.0' } },
    }, null, 2)}\n`)
    mkdirSync(path.join(repositoryRoot, 'docs'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'Run `npm exec --offline -- node scripts/preview-check.mjs` for offline validation.\n')
    writeFileSync(path.join(repositoryRoot, 'docs/BACKEND_OPERATIONS.md'), '# Backend operations\n')
    writeFileSync(path.join(repositoryRoot, 'docs/D1C4_ACTIVATION.md'), '# D1C.4 activation\n')
    writeFileSync(path.join(repositoryRoot, 'docs/PREVIEW_RELEASE_WORKFLOW.md'), '# Preview release workflow\n')
    writeFileSync(path.join(repositoryRoot, '.gitignore'), 'ignored.log\nnode_modules/\n')

    runGit(repositoryRoot, ['init', '--initial-branch=develop'])
    runGit(repositoryRoot, ['config', 'user.name', 'Preview Check Test'])
    runGit(repositoryRoot, ['config', 'user.email', 'preview-check@example.invalid'])
    runGit(repositoryRoot, ['add', '.'])
    runGit(repositoryRoot, ['commit', '-m', 'fixture'])
    runGit(temporaryRoot, ['init', '--bare', '--initial-branch=develop', remoteRoot])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(repositoryRoot, ['push', '--set-upstream', 'origin', 'develop'])
    runGit(repositoryRoot, ['remote', 'set-url', 'origin', 'https://github.com/camrenwerry/162-0.git'])
    mkdirSync(path.join(repositoryRoot, 'node_modules/wrangler'), { recursive: true })
    writeFileSync(path.join(repositoryRoot, 'node_modules/wrangler/package.json'), '{"version":"4.111.0"}\n')
    writeFileSync(path.join(repositoryRoot, 'ignored.log'), 'ignored fixture output\n')

    return { repositoryRoot, temporaryRoot }
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

test('correct absolute repository root and synchronized clean repository pass', () => {
  const { calls } = runPreflight()
  assert.equal(calls.length, cleanResults.size)
  assert.equal(calls.every(({ options }) => options.capture === true), true)
})

test('validated Git values are printed after successful parsing', () => {
  const capture = capturedOutput()
  runPreflight(undefined, { output: capture.output })
  assert.equal(capture.lines.includes(`[preview:check] Repository root: ${REPOSITORY_ROOT}`), true)
  assert.equal(capture.lines.includes('[preview:check] Branch: develop'), true)
  assert.equal(capture.lines.includes('[preview:check] Upstream: origin/develop'), true)
  assert.equal(capture.lines.includes('[preview:check] Divergence: 0 0'), true)
})

for (const [description, stdout, untrustedValue] of [
  ['empty', '', null],
  ['whitespace-only', '  \t\n', null],
  ['relative', 'fixture/pennant-pursuit\n', 'fixture/pennant-pursuit'],
  ['multiple-line', `${REPOSITORY_ROOT}\n/untrusted/additional-root\n`, '/untrusted/additional-root'],
]) {
  test(`${description} repository-root output fails without being printed as trusted`, () => {
    const capture = capturedOutput()
    const overrides = new Map([[key('git', ['rev-parse', '--show-toplevel']), result(stdout)]])
    assert.throws(() => runPreflight(overrides, { output: capture.output }), /unreadable repository root/)
    assert.equal(capture.lines.some((line) => line.startsWith('[preview:check] Repository root:')), false)
    if (untrustedValue) assert.equal(capture.lines.join('\n').includes(untrustedValue), false)
  })
}

test('incorrect absolute repository root fails', () => {
  const overrides = new Map([
    [key('git', ['rev-parse', '--show-toplevel']), result('/fixture/another-repository\n')],
  ])
  assert.throws(() => runPreflight(overrides), /Expected repository root .*found \/fixture\/another-repository/)
})

test('package identity failure is rejected', () => {
  assert.throws(() => runPreflight(undefined, { packageName: () => 'another-package' }), /Expected package pennant-pursuit/)
})

test('wrong branch fails', () => {
  const overrides = new Map([
    [key('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']), result('feature/unsafe\n')],
  ])
  assert.throws(() => runPreflight(overrides), /Expected develop; found feature\/unsafe/)
})

test('detached HEAD fails', () => {
  const overrides = new Map([
    [key('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']), result('', 1, 'fatal: ref HEAD is not a symbolic ref')],
  ])
  assert.throws(() => runPreflight(overrides), /ref HEAD is not a symbolic ref/)
})

test('dirty tracked worktree fails', () => {
  const overrides = new Map([[key('git', ['diff', '--quiet', '--exit-code']), result('', 1)]])
  assert.throws(() => runPreflight(overrides), /Tracked worktree changes are not allowed/)
})

test('staged changes fail', () => {
  const overrides = new Map([[key('git', ['diff', '--cached', '--quiet', '--exit-code']), result('', 1)]])
  assert.throws(() => runPreflight(overrides), /Staged changes are not allowed/)
})

test('untracked files fail while ignored files remain excluded by Git', () => {
  const overrides = new Map([[key('git', ['ls-files', '--others', '--exclude-standard', '-z']), result('notes.txt\0')]])
  assert.throws(() => runPreflight(overrides), /Untracked files are not allowed: notes\.txt/)
})

test('ahead divergence fails', () => {
  const overrides = new Map([[key('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('1\t0\n')]])
  assert.throws(() => runPreflight(overrides), /Expected 0 0; found 1 0/)
})

test('behind divergence fails', () => {
  const overrides = new Map([[key('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('0\t2\n')]])
  assert.throws(() => runPreflight(overrides), /Expected 0 0; found 0 2/)
})

test('both-ahead-and-behind divergence fails', () => {
  const overrides = new Map([[key('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('2\t3\n')]])
  assert.throws(() => runPreflight(overrides), /Expected 0 0; found 2 3/)
})

test('malformed divergence output fails', () => {
  const overrides = new Map([[key('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('ahead behind\n')]])
  assert.throws(() => runPreflight(overrides), /unreadable divergence count/)
})

test('missing upstream fails', () => {
  const overrides = new Map([
    [key('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']), result('', 128, 'fatal: no upstream configured')],
  ])
  assert.throws(() => runPreflight(overrides), /no valid upstream is configured/)
})

test('incorrect upstream fails', () => {
  const overrides = new Map([
    [key('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']), result('origin/main\n')],
  ])
  assert.throws(() => runPreflight(overrides), /Expected origin\/develop; found origin\/main/)
})

test('a failed validation stage prevents later stages from running', () => {
  const stages = [
    { label: 'first', command: 'npm', args: ['run', 'first'] },
    { label: 'failing', command: 'npm', args: ['run', 'failing'] },
    { label: 'never', command: 'npm', args: ['run', 'never'] },
  ]
  const fake = fakeRunner(new Map([[key('npm', ['run', 'failing']), result('', 7)]]))
  assert.throws(() => runStages(stages, { cwd: REPOSITORY_ROOT, runner: fake.runner, output: quietOutput }), /\[failing\].*status 7/)
  assert.deepEqual(fake.calls.map(({ args }) => args[1]), ['first', 'failing'])
})

test('child-process spawn failures are reported', () => {
  const runner = () => result('', null, '', { error: new Error('spawn npm ENOENT') })
  assert.throws(() => runStages([{ label: 'spawn', command: 'npm', args: ['test'] }], {
    cwd: REPOSITORY_ROOT,
    runner,
    output: quietOutput,
  }), /spawn npm ENOENT/)
})

test('child-process signal termination is reported', () => {
  const runner = () => result('', null, '', { signal: 'SIGTERM' })
  assert.throws(() => runStages([{ label: 'signal', command: 'npm', args: ['test'] }], {
    cwd: REPOSITORY_ROOT,
    runner,
    output: quietOutput,
  }), /terminated by signal SIGTERM/)
})

test('Workerd timing-safe-equality is part of the aggregate test path', () => {
  assert.equal(TEST_STAGES.filter(({ args }) => args[1] === 'test:draft-timing-safe-workerd').length, 1)
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts.test, 'node scripts/preview-check.mjs --tests')
  assert.equal(RELEASE_STAGES.some(({ command, args }) => command === 'npm' && args.length === 1 && args[0] === 'test'), true)
})

test('all recursively reachable release scripts use supported local-only commands', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const coordinatorReferences = coordinatorScriptReferences([...TYPECHECK_STAGES, ...TEST_STAGES, ...RELEASE_STAGES])
  const roots = ['test', 'typecheck', ...coordinatorReferences]
  const reachable = assertLocalReleaseGraph(packageJson.scripts, roots)

  assert.equal(reachable.some(({ name }) => name === 'validation-worker:production:build'), true)
  assert.equal(reachable.some(({ name }) => name === 'test:draft-timing-safe-workerd'), true)
  assert.equal(reachable.some(({ name }) => name === 'test:d1c4-smoke-harness'), true)
  assert.equal(reachable.some(({ name }) => name === 'test:production-migration'), true)
  assert.equal(reachable.some(({ name }) => name === 'validate:data'), true)
})

test('recursive safety traversal rejects an unsafe nested command', () => {
  const scripts = {
    root: 'npm run middle',
    middle: 'npm run unsafe',
    unsafe: 'wrangler d1 execute production --remote --command "DELETE FROM releases"',
  }
  assert.throws(() => assertLocalReleaseGraph(scripts, ['root']), /Remote flag is forbidden/)
})

test('runtime safety traversal validates pre and post lifecycle hooks', () => {
  assert.throws(() => assertLocalReleaseGraph({ root: 'node scripts/preview-check.mjs', preroot: 'git push' }, ['root']), /Unsupported executable git/)
  assert.throws(() => assertLocalReleaseGraph({ root: 'node scripts/preview-check.mjs', postroot: 'wrangler deploy' }, ['root']), /Unsupported Wrangler command/)
})

for (const [description, command] of [
  ['sh -c evaluator', 'sh -c "npm run unsafe"'],
  ['bash -lc evaluator', 'bash -lc "wrangler deploy"'],
  ['zsh -c evaluator', 'zsh -c "node scripts/apply-production-migrations.mjs"'],
]) {
  test(`safety validation rejects ${description}`, () => {
    assert.throws(() => assertLocalReleaseGraph({ harmless: command }, ['harmless']), /Shell evaluator/)
  })
}

test('safety validation rejects every unsupported shell evaluator', () => {
  for (const evaluator of SHELL_EVALUATORS) {
    assert.throws(
      () => assertLocalReleaseGraph({ harmless: `${evaluator} "npm run unsafe"` }, ['harmless']),
      /Shell evaluator/,
      evaluator,
    )
  }
})

for (const [description, command] of [
  ['environment-variable executable indirection', 'NPM=npm $NPM run unsafe'],
  ['Wrangler executable indirection', 'CMD=wrangler $CMD deploy'],
  ['braced script-path expansion', 'node ${SCRIPT_PATH}'],
  ['command substitution', 'echo $(npm run unsafe)'],
  ['backtick command substitution', 'echo `npm run unsafe`'],
]) {
  test(`safety validation rejects ${description}`, () => {
    assert.throws(() => assertLocalReleaseGraph({ harmless: command }, ['harmless']), /dynamic shell expansion/)
  })
}

test('safety validation rejects unsupported positional and special parameter expansion', () => {
  for (const expansion of ['$NAME', '$1', '$@', '$*', '$?', '$$']) {
    assert.throws(
      () => assertLocalReleaseGraph({ harmless: `node ${expansion}` }, ['harmless']),
      /dynamic shell expansion/,
      expansion,
    )
  }
})

test('safety validation rejects the production migration wrapper under a harmless script name', () => {
  assert.throws(
    () => assertLocalReleaseGraph({ harmless: 'node scripts/apply-production-migrations.mjs' }, ['harmless']),
    /Known mutation entry point/,
  )
})

test('safety validation rejects current mutation-capable smoke and configuration entry points', () => {
  for (const command of [
    'vite build --ssr scripts/d1c4-submission-smoke.ts --outDir /tmp/pennant-pursuit-smoke --emptyOutDir',
    'vite build --ssr scripts/d1c4-retention-smoke.ts --outDir /tmp/pennant-pursuit-smoke --emptyOutDir',
    'node /tmp/pennant-pursuit-d1c4-submission-smoke/d1c4-submission-smoke.js',
    'node /tmp/pennant-pursuit-d1c4-retention-smoke/d1c4-retention-smoke.js',
    'node scripts/prepare-d1c4-activation.mjs',
  ]) {
    assert.throws(() => assertLocalReleaseGraph({ harmless: command }, ['harmless']))
  }
})

test('recursive safety traversal rejects a nested shell evaluator', () => {
  const scripts = { root: 'npm run nested', nested: 'sh -c "npm run unsafe"' }
  assert.throws(() => assertLocalReleaseGraph(scripts, ['root']), /Shell evaluator/)
})

test('recursive safety traversal rejects nested variable expansion', () => {
  const scripts = { root: 'npm run nested', nested: 'NPM=npm $NPM run unsafe' }
  assert.throws(() => assertLocalReleaseGraph(scripts, ['root']), /dynamic shell expansion/)
})

test('recursive safety traversal accepts literal npm run, run-script, and test references', () => {
  const scripts = {
    root: 'npm run middle',
    middle: 'npm run-script final',
    final: 'npm test',
    test: 'node scripts/preview-check.test.mjs',
  }
  const reachable = assertLocalReleaseGraph(scripts, ['root'])
  assert.deepEqual(new Set(reachable.map(({ name }) => name)), new Set(['root', 'middle', 'final', 'test']))
})

test('recursive safety traversal rejects cycles before execution', () => {
  const scripts = { first: 'npm run second', second: 'npm run first' }
  assert.throws(() => assertLocalReleaseGraph(scripts, ['first']), /cycle/)
})

test('recursive safety traversal follows npm test dependencies', () => {
  const scripts = { root: 'npm test', test: 'node scripts/preview-check.test.mjs' }
  const reachable = assertLocalReleaseGraph(scripts, ['root'])
  assert.deepEqual(new Set(reachable.map(({ name }) => name)), new Set(['root', 'test']))
})

test('recursive safety traversal fails on missing referenced scripts', () => {
  assert.throws(() => collectReachableScripts({ root: 'npm run missing' }, ['root']), /Missing referenced package script missing/)
})

test('safety validation rejects unsupported Wrangler commands', () => {
  assert.throws(() => assertLocalReleaseGraph({ harmless: 'wrangler deploy' }, ['harmless']), /Unsupported Wrangler command/)
})

test('safety validation rejects prohibited command text without executing it', () => {
  let executionAttempts = 0
  const prohibitedCommand = () => { executionAttempts += 1 }
  assert.throws(
    () => assertLocalReleaseGraph({ harmless: 'node scripts/apply-production-migrations.mjs' }, ['harmless']),
    /Known mutation entry point/,
  )
  assert.equal(executionAttempts, 0)
  assert.equal(typeof prohibitedCommand, 'function')
})

test('child processes receive exact arguments and all Wrangler safeguards', () => {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    return result()
  }
  const runner = createProcessRunner(spawn, {
    PATH: '/fixture/bin',
    PENNANT_PREVIEW_API_TOKEN: 'sensitive-fixture-value',
    CLOUDFLARE_API_TOKEN: 'generic-fixture-value',
    WRANGLER_WRITE_LOGS: 'true',
    WRANGLER_SEND_METRICS: 'true',
    WRANGLER_HIDE_BANNER: 'false',
  })
  const unsafeLookingArgument = 'lint; echo should-not-run'
  runner('npm', ['run', unsafeLookingArgument], { cwd: REPOSITORY_ROOT })
  assert.deepEqual(calls[0].args, ['run', unsafeLookingArgument])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.env.PATH, '/fixture/bin')
  assert.equal(calls[0].options.env.PENNANT_PREVIEW_API_TOKEN, undefined)
  assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, undefined)
  assert.equal(calls[0].options.env.WRANGLER_WRITE_LOGS, 'false')
  assert.equal(calls[0].options.env.WRANGLER_SEND_METRICS, 'false')
  assert.equal(calls[0].options.env.WRANGLER_HIDE_BANNER, 'true')
  assert.equal(calls[0].options.env.NPM_CONFIG_IGNORE_SCRIPTS, 'true')
  assert.equal(calls[0].options.stdio, 'inherit')
})

test('a clean temporary repository runs preview:check and ignores ignored files', () => {
  const fixture = createCleanPreviewFixture()
  try {
    const output = execFileSync('npm', ['exec', '--offline', '--', 'node', 'scripts/preview-check.mjs'], {
      cwd: fixture.repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WRANGLER_WRITE_LOGS: 'true',
        WRANGLER_SEND_METRICS: 'true',
        WRANGLER_HIDE_BANNER: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.match(output, /Repository root: .*pennant-preview-check-/)
    assert.match(output, /Branch: develop/)
    assert.match(output, /Upstream: origin\/develop/)
    assert.match(output, /Divergence: 0 0/)
    assert.match(output, /All local Preview release-readiness checks passed/)
    const jsonOutput = execFileSync('npm', ['exec', '--offline', '--', 'node', 'scripts/preview-check.mjs', '--json'], {
      cwd: fixture.repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const report = JSON.parse(jsonOutput)
    assert.equal(report.status, 'PASS')
    assert.equal(report.mode, 'offline')
    assert.equal(report.noRemoteMutation, true)
  } finally {
    rmSync(fixture.temporaryRoot, { recursive: true, force: true })
  }
})

test('the exact public npm commands cannot trigger matching outer lifecycle hooks', () => {
  const fixture = createCleanPreviewFixture({ unsafeOuterLifecycle: true })
  try {
    const check = spawnSync('npm', ['exec', '--offline', '--', 'node', 'scripts/preview-check.mjs'], {
      cwd: realpathSync(fixture.repositoryRoot), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.equal(check.status, 0, check.stderr)
    const plan = spawnSync('npm', ['exec', '--offline', '--', 'node', 'scripts/preview-plan.mjs', '--target-state', 'disabled'], {
      cwd: realpathSync(fixture.repositoryRoot), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.equal(plan.status, 11)
    assert.match(plan.stderr, /PENNANT_PREVIEW_API_TOKEN/)
    assert.equal(existsSync(path.join(fixture.repositoryRoot, 'unsafe-outer-lifecycle-ran')), false)
  } finally {
    rmSync(fixture.temporaryRoot, { recursive: true, force: true })
  }
})

test('the exact public preview check refuses an unsafe reachable lifecycle before any quality child executes', () => {
  const fixture = createCleanPreviewFixture({ unsafeReachableLifecycle: true })
  try {
    const execution = spawnSync('npm', ['exec', '--offline', '--', 'node', 'scripts/preview-check.mjs'], {
      cwd: realpathSync(fixture.repositoryRoot), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.equal(execution.status, 10)
    assert.match(execution.stderr, /Release command graph is unsafe/)
    assert.equal(existsSync(path.join(fixture.repositoryRoot, 'unsafe-lifecycle-ran')), false)
    assert.doesNotMatch(execution.stdout, /D1C\.4 activation-state validation/)
  } finally {
    rmSync(fixture.temporaryRoot, { recursive: true, force: true })
  }
})

test('a clean temporary repository runs the actual preview:plan path with stable read-only fakes', async () => {
  const fixture = createCleanPreviewFixture({ resolvedRemote: true })
  try {
    const repositoryRoot = realpathSync(fixture.repositoryRoot)
    const head = runGit(repositoryRoot, ['rev-parse', 'HEAD']).trim()
    const fixedRunner = createFixedRunner(process.env, spawnSync)
    const runner = (command, args, cwd) => {
      if (command === 'git' && JSON.stringify(args) === JSON.stringify(['ls-remote', '--heads', 'origin', 'refs/heads/develop'])) {
        return result(`${head}\trefs/heads/develop\n`)
      }
      return fixedRunner(command, args, cwd)
    }
    const operations = []
    const client = {
      async request(operation, parameters, validator) {
        const validate = (value) => typeof validator === 'function' ? validator(value, () => {}) : value
        operations.push(operation)
        if (operation === 'account-zones') {
          return validate({
            items: [{ id: 'b'.repeat(32), account: { id: 'a'.repeat(32) } }],
            resultInfo: { page: parameters.page, totalPages: 1, totalCount: 1 },
          })
        }
        if (operation === 'pages-deployments') {
          return validate({
            items: [{
              id: 'preview-deployment', created_on: '2026-07-22T12:00:00.000Z', environment: 'preview',
              url: 'https://fixture.diamond-draft.pages.dev', aliases: ['https://develop.diamond-draft.pages.dev'],
              deployment_trigger: { metadata: { branch: 'develop', commit_hash: head } }, latest_stage: { status: 'success' },
            }],
            resultInfo: { page: parameters.page, totalPages: 1, totalCount: 1 },
          })
        }
        if (operation === 'worker-domains') return validate({ items: [], resultInfo: null })
        if (operation === 'worker-routes') return validate([])
        const values = {
          account: { id: 'a'.repeat(32) },
          'pages-project': {
            name: 'diamond-draft', production_branch: 'main', domains: ['pennant-pursuit.example'],
            deployment_configs: { preview: {
              always_use_latest_compatibility_date: false,
              build_image_major_version: 3,
              compatibility_date: '2026-07-01',
              compatibility_flags: [],
              env_vars: {
                DRAFT_VALIDATION_MODE: { value: 'enabled' }, DRAFT_TICKET_MODE: { value: 'enabled' }, DRAFT_SUBMISSION_MODE: { value: 'disabled' },
              },
              fail_open: true,
              usage_model: 'standard',
              ai_bindings: {},
              analytics_engine_datasets: {},
              browsers: {},
              d1_databases: { DB: { id: 'ba6255b4-9425-4863-b10f-79149180f75a' } },
              durable_object_namespaces: {},
              hyperdrive_bindings: {},
              kv_namespaces: {},
              limits: { cpu_ms: 100 },
              mtls_certificates: {},
              placement: { mode: 'smart' },
              queue_producers: {},
              r2_buckets: {},
              services: { VALIDATION_SERVICE: { service: 'pennant-pursuit-validation-preview' } },
              vectorize_bindings: {},
              wrangler_config_hash: 'fixture-config-hash',
            } },
          },
          'worker-settings': { bindings: [
            { name: 'DB', type: 'd1', id: 'ba6255b4-9425-4863-b10f-79149180f75a' },
            { name: 'RATE_LIMIT_BURST', type: 'ratelimit', namespace_id: '16204011' },
            { name: 'RATE_LIMIT_SUSTAINED', type: 'ratelimit', namespace_id: '16204012' },
            { name: 'DRAFT_VALIDATION_MODE', type: 'plain_text', text: 'enabled' },
            { name: 'DRAFT_TICKET_MODE', type: 'plain_text', text: 'enabled' },
            { name: 'DRAFT_SUBMISSION_MODE', type: 'plain_text', text: 'disabled' },
          ] },
          'worker-deployments': { deployments: [{
            id: '11111111-1111-4111-8111-111111111111',
            created_on: '2026-07-22T12:00:00.000Z',
            versions: [{ version_id: '22222222-2222-4222-8222-222222222222', percentage: 100 }],
          }] },
          'worker-subdomain': { enabled: false, previews_enabled: false },
          'worker-schedules': { schedules: [] },
          'd1-database': { uuid: 'ba6255b4-9425-4863-b10f-79149180f75a', name: 'pennant-pursuit-preview' },
          'migration-tables': [{ success: true, results: [{ name: 'backend_schema' }, { name: 'd1_migrations' }] }],
          'migration-rows': [{ success: true, results: [
            { id: 1, name: '0001_backend_foundation.sql', applied_at: '2026-07-22 12:34:56' },
            { id: 2, name: '0002_draft_submissions.sql', applied_at: '2026-07-22 12:35:56' },
          ] }],
          'backend-version': [{ success: true, results: [{ version: 2 }] }],
        }
        return validate(values[operation])
      },
    }
    const plan = await createPreviewPlan({
      repositoryRoot,
      targetState: 'disabled',
      token: 'sensitive-fixture-value',
      runner,
      client,
      runQualityStages: false,
      captureStages: true,
      output: quietOutput,
    })
    assert.equal(plan.noRemoteMutation, true)
    assert.equal(plan.targetState, 'disabled')
    assert.deepEqual(plan.futureStages.map(({ id }) => id), ['worker.deploy', 'pages.deploy'])
    assert.equal(operations.filter((operation) => operation === 'pages-project').length, 2)
    assert.equal(operations.includes('worker-metadata'), false)
  } finally {
    rmSync(fixture.temporaryRoot, { recursive: true, force: true })
  }
})
