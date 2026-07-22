import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
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

const SHELL_EVALUATORS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'pwsh',
  'eval',
  'exec',
])

const KNOWN_MUTATION_ENTRY_POINTS = [
  'scripts/apply-production-migrations.mjs',
  'scripts/d1c4-submission-smoke.ts',
  'scripts/d1c4-retention-smoke.ts',
  'd1c4-submission-smoke.js',
  'd1c4-retention-smoke.js',
]

const SAFE_NODE_ARGUMENTS = new Set([
  ['scripts/check-validation-bundles.mjs'],
  ['scripts/d1c1-foundation.test.mjs'],
  ['scripts/draft-timing-safe-workerd.test.mjs'],
  ['scripts/lahman-pipeline.test.mjs'],
  ['scripts/navigation-smoke.test.mjs'],
  ['scripts/player-pipeline.test.mjs'],
  ['scripts/prepare-d1c4-activation.mjs', '--check'],
  ['scripts/preview-check.mjs'],
  ['scripts/preview-check.mjs', '--tests'],
  ['scripts/preview-check.mjs', '--typecheck'],
  ['scripts/preview-check.test.mjs'],
  ['scripts/production-migration-guard.test.mjs'],
  ['scripts/pwa-deployment.test.mjs'],
  ['scripts/responsive-contract.test.mjs'],
  ['scripts/smoke-game.mjs'],
  ['scripts/v010-presentation.test.mjs'],
  ['scripts/validate-lahman-data.mjs'],
  ['/tmp/pennant-pursuit-engine-smoke/engine-smoke.js'],
  ['/tmp/pennant-pursuit-scoring-tests/scoring.test.js'],
  ['/tmp/pennant-pursuit-seeded-rng-tests/seeded-random.test.js'],
  ['/tmp/pennant-pursuit-transcript-replay-tests/transcript-replay.test.js'],
  ['/tmp/pennant-pursuit-server-validation-tests/server-validation.test.js'],
  ['/tmp/pennant-pursuit-draft-validation-tests/draft-validation-route.test.js'],
  ['/tmp/pennant-pursuit-draft-validation-hardening-tests/draft-validation-hardening.test.js'],
  ['/tmp/pennant-pursuit-draft-ticket-tests/draft-ticket.test.js'],
  ['/tmp/pennant-pursuit-draft-validation-traffic-control-tests/draft-validation-traffic-control.test.js'],
  ['/tmp/pennant-pursuit-draft-submission-tests/draft-submission.test.js'],
  ['/tmp/pennant-pursuit-d1c3-retention-cleanup-tests/d1c3-retention-cleanup.test.js'],
  ['/tmp/pennant-pursuit-d1c4-activation-tests/d1c4-activation.test.js'],
  ['/tmp/pennant-pursuit-d1c4-network-d1-client-tests/d1c4-network-d1-client.test.js'],
  ['/tmp/pennant-pursuit-d1c4-submission-cleanup-tests/d1c4-submission-cleanup.test.js'],
  ['/tmp/pennant-pursuit-d1c4-smoke-harness-tests/d1c4-smoke-harness.test.js'],
  ['/tmp/pennant-pursuit-randomizer-tests/randomizer.test.js'],
  ['/tmp/pennant-pursuit-randomizer-distribution/randomizer-distribution.js'],
  ['/tmp/pennant-pursuit-backend-tests/backend-foundation.test.js'],
  ['/tmp/pennant-pursuit-release-tests/release-readiness.test.js'],
].map((argumentsList) => JSON.stringify(argumentsList)))

const SAFE_VITE_SSR_ENTRY_POINTS = new Set([
  'scripts/backend-foundation.test.ts',
  'scripts/d1c3-retention-cleanup.test.ts',
  'scripts/d1c4-activation.test.ts',
  'scripts/d1c4-network-d1-client.test.ts',
  'scripts/d1c4-smoke-harness.test.ts',
  'scripts/d1c4-submission-cleanup.test.ts',
  'scripts/draft-submission.test.ts',
  'scripts/draft-ticket.test.ts',
  'scripts/draft-timing-safe-workerd.worker.ts',
  'scripts/draft-validation-hardening.test.ts',
  'scripts/draft-validation-route.test.ts',
  'scripts/draft-validation-traffic-control.test.ts',
  'scripts/engine-smoke.ts',
  'scripts/randomizer-distribution.ts',
  'scripts/randomizer.test.ts',
  'scripts/release-readiness.test.ts',
  'scripts/scoring.test.ts',
  'scripts/seeded-random.test.ts',
  'scripts/server-validation.test.ts',
  'scripts/transcript-replay.test.ts',
])

const SAFE_TSC_ARGUMENTS = new Set([
  ['-b'],
  ['--project', 'functions/tsconfig.json', '--noEmit'],
  ['--project', 'scripts/tsconfig.d1c4.json', '--noEmit'],
  ['--project', 'workers/draft-validation/tsconfig.json', '--noEmit'],
].map((argumentsList) => JSON.stringify(argumentsList)))

const SAFE_WRANGLER_ARGUMENTS = new Set([
  ['types', './functions/types.d.ts', '--check'],
  ['--cwd', 'workers/draft-validation', 'types', './worker-configuration.d.ts', '--check'],
  ['--cwd', 'workers/draft-validation', 'deploy', '--env=', '--dry-run', '--minify', '--outdir', '/tmp/pennant-pursuit-validation-worker-build'],
  ['--cwd', 'workers/draft-validation', 'deploy', '--env', 'production', '--dry-run', '--minify', '--outdir', '/tmp/pennant-pursuit-validation-production-worker-build'],
  ['pages', 'functions', 'build', 'functions', '--project-directory', '.', '--outdir', '/tmp/pennant-pursuit-pages-c4-build', '--minify', '--metafile'],
].map((argumentsList) => JSON.stringify(argumentsList)))

function tokenizeShellCommand(command) {
  const tokens = []
  let word = ''
  let wordStarted = false
  let quote = null

  const pushWord = () => {
    if (wordStarted) tokens.push({ type: 'word', value: word })
    word = ''
    wordStarted = false
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote === "'") {
      if (character === "'") quote = null
      else word += character
      continue
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null
      } else if (character === '\\') {
        index += 1
        if (index >= command.length) throw new Error('Malformed trailing escape in package script.')
        word += command[index]
      } else {
        word += character
      }
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      wordStarted = true
    } else if (character === '\\') {
      index += 1
      if (index >= command.length) throw new Error('Malformed trailing escape in package script.')
      word += command[index]
      wordStarted = true
    } else if (/\s/.test(character)) {
      pushWord()
      if (character === '\n') tokens.push({ type: 'operator', value: '\n' })
    } else if (';&|()<>'.includes(character)) {
      pushWord()
      const doubled = (character === '&' || character === '|') && command[index + 1] === character
      tokens.push({ type: 'operator', value: doubled ? character.repeat(2) : character })
      if (doubled) index += 1
    } else {
      word += character
      wordStarted = true
    }
  }

  if (quote !== null) throw new Error('Malformed unterminated quote in package script.')
  pushWord()
  return tokens
}

function commandSegments(command) {
  const segments = [[]]
  for (const token of tokenizeShellCommand(command)) {
    if (token.type === 'operator') {
      if (segments.at(-1).length > 0) segments.push([])
    } else {
      segments.at(-1).push(token.value)
    }
  }
  return segments.filter((segment) => segment.length > 0)
}

function npmScriptReferences(scriptName, command) {
  const references = []

  for (const words of commandSegments(command)) {
    for (let index = 0; index < words.length; index += 1) {
      if (words[index] !== 'npm') continue
      const subcommand = words[index + 1]
      if (subcommand === 'test') {
        references.push('test')
        continue
      }
      if (subcommand === 'run' || subcommand === 'run-script') {
        const reference = words[index + 2]
        if (!reference || !/^[A-Za-z0-9:_-]+$/.test(reference)) {
          throw new Error(`Unsupported dynamic npm-script reference in ${scriptName}.`)
        }
        references.push(reference)
        continue
      }
      throw new Error(`Unsupported npm command in reachable script ${scriptName}.`)
    }
  }

  return references
}

function collectReachableScripts(scripts, roots, validateCommand = () => {}) {
  const visiting = new Set()
  const visited = new Set()
  const reachable = []

  const visit = (scriptName) => {
    if (visited.has(scriptName) || visiting.has(scriptName)) return
    const command = scripts[scriptName]
    if (typeof command !== 'string') throw new Error(`Missing referenced package script ${scriptName}.`)

    validateCommand(scriptName, command)
    visiting.add(scriptName)
    for (const reference of npmScriptReferences(scriptName, command)) visit(reference)
    visiting.delete(scriptName)
    visited.add(scriptName)
    reachable.push({ name: scriptName, command })
  }

  for (const root of roots) visit(root)
  return reachable
}

function coordinatorScriptReferences(stages) {
  return stages.map(({ label, command, args }) => {
    if (command !== 'npm') throw new Error(`Unsupported coordinator command in ${label}.`)
    if (args.length === 1 && args[0] === 'test') return 'test'
    if (args.length === 2 && args[0] === 'run' && /^[A-Za-z0-9:_-]+$/.test(args[1])) return args[1]
    throw new Error(`Unsupported coordinator npm arguments in ${label}.`)
  })
}

function commandWordBasename(word) {
  return word.replaceAll('\\', '/').split('/').at(-1).toLowerCase()
}

function isKnownMutationEntryPoint(word) {
  const normalized = word.replaceAll('\\', '/')
  return KNOWN_MUTATION_ENTRY_POINTS.some((entryPoint) => normalized.includes(entryPoint))
}

function assertSupportedNpmCommand(scriptName, words) {
  const isTest = words.length === 2 && words[1] === 'test'
  const isRun = words.length === 3
    && (words[1] === 'run' || words[1] === 'run-script')
    && /^[A-Za-z0-9:_-]+$/.test(words[2])
  if (!isTest && !isRun) throw new Error(`Unsupported npm command in reachable script ${scriptName}.`)
}

function assertSupportedViteCommand(scriptName, words) {
  if (words.length === 2 && words[1] === 'build') return
  const isSafeSsrBuild = words.length === 7
    && words[1] === 'build'
    && words[2] === '--ssr'
    && SAFE_VITE_SSR_ENTRY_POINTS.has(words[3])
    && words[4] === '--outDir'
    && words[5].startsWith('/tmp/pennant-pursuit-')
    && words[6] === '--emptyOutDir'
  if (!isSafeSsrBuild) throw new Error(`Unsupported Vite command in ${scriptName}.`)
}

function assertLocalReleaseCommand(scriptName, command) {
  if (/^(?:db:|smoke:|dev(?::|$)|d1c4:activation$)/.test(scriptName)) {
    throw new Error(`Unsafe release script ${scriptName}.`)
  }
  if (command.includes('$') || command.includes('`')) {
    throw new Error(`Unsupported dynamic shell expansion in ${scriptName}.`)
  }

  const tokens = tokenizeShellCommand(command)
  const unsupportedOperator = tokens.find(({ type, value }) => type === 'operator' && value !== '&&')
  if (unsupportedOperator) throw new Error(`Unsupported shell operator in ${scriptName}.`)

  npmScriptReferences(scriptName, command)
  const segments = commandSegments(command)
  if (segments.length === 0) throw new Error(`Empty command in ${scriptName}.`)

  for (const words of segments) {
    if (words.includes('--remote')) throw new Error(`Remote flag is forbidden in ${scriptName}.`)
    const shellEvaluator = words.find((word) => SHELL_EVALUATORS.has(commandWordBasename(word)))
    if (shellEvaluator) throw new Error(`Shell evaluator ${shellEvaluator} is forbidden in ${scriptName}.`)
    const mutationEntryPoint = words.find(isKnownMutationEntryPoint)
    if (mutationEntryPoint) {
      throw new Error(`Known mutation entry point ${mutationEntryPoint} is forbidden in ${scriptName}.`)
    }

    const [executable, ...argumentsList] = words
    if (executable === 'npm') {
      assertSupportedNpmCommand(scriptName, words)
      continue
    }
    if (executable === 'node') {
      if (!SAFE_NODE_ARGUMENTS.has(JSON.stringify(argumentsList))) {
        throw new Error(`Unsupported Node command in ${scriptName}.`)
      }
      continue
    }
    if (executable === 'vite') {
      assertSupportedViteCommand(scriptName, words)
      continue
    }
    if (executable === 'tsc') {
      if (!SAFE_TSC_ARGUMENTS.has(JSON.stringify(argumentsList))) {
        throw new Error(`Unsupported TypeScript command in ${scriptName}.`)
      }
      continue
    }
    if (executable === 'eslint') {
      if (words.length !== 2 || words[1] !== '.') throw new Error(`Unsupported ESLint command in ${scriptName}.`)
      continue
    }
    if (executable === 'wrangler') {
      if (!SAFE_WRANGLER_ARGUMENTS.has(JSON.stringify(argumentsList))) {
        throw new Error(`Unsupported Wrangler command in ${scriptName}.`)
      }
      continue
    }
    throw new Error(`Unsupported executable ${executable} in ${scriptName}.`)
  }
}

function assertLocalReleaseGraph(scripts, roots) {
  return collectReachableScripts(scripts, roots, assertLocalReleaseCommand)
}

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function createCleanPreviewFixture() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pennant-preview-check-'))
  const repositoryRoot = path.join(temporaryRoot, 'repository')
  const remoteRoot = path.join(temporaryRoot, 'origin.git')
  try {
    mkdirSync(path.join(repositoryRoot, 'scripts'), { recursive: true })

    const coordinatorSource = readFileSync(new URL('./preview-check.mjs', import.meta.url), 'utf8')
    writeFileSync(path.join(repositoryRoot, 'scripts', 'preview-check.mjs'), coordinatorSource)
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
      'preview:check': 'node scripts/preview-check.mjs',
      test: 'node scripts/preview-check.mjs --tests',
      typecheck: 'node scripts/preview-check.mjs --typecheck',
    }
    for (const scriptName of stageScripts) {
      if (!(scriptName in scripts)) scripts[scriptName] = 'node scripts/fixture-stage.mjs'
    }

    writeFileSync(path.join(repositoryRoot, 'package.json'), `${JSON.stringify({
      name: 'pennant-pursuit',
      private: true,
      type: 'module',
      scripts,
    }, null, 2)}\n`)
    writeFileSync(path.join(repositoryRoot, '.gitignore'), 'ignored.log\n')

    runGit(repositoryRoot, ['init', '--initial-branch=develop'])
    runGit(repositoryRoot, ['config', 'user.name', 'Preview Check Test'])
    runGit(repositoryRoot, ['config', 'user.email', 'preview-check@example.invalid'])
    runGit(repositoryRoot, ['add', '.'])
    runGit(repositoryRoot, ['commit', '-m', 'fixture'])
    runGit(temporaryRoot, ['init', '--bare', '--initial-branch=develop', remoteRoot])
    runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot])
    runGit(repositoryRoot, ['push', '--set-upstream', 'origin', 'develop'])
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
  const overrides = new Map([[key('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/develop']), result('zero zero\n')]])
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
  const roots = ['preview:check', 'test', 'typecheck', ...coordinatorReferences]
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

test('recursive safety traversal handles safe cycles without looping', () => {
  const scripts = { first: 'npm run second', second: 'npm run first' }
  const reachable = assertLocalReleaseGraph(scripts, ['first'])
  assert.deepEqual(new Set(reachable.map(({ name }) => name)), new Set(['first', 'second']))
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
    WRANGLER_WRITE_LOGS: 'true',
    WRANGLER_SEND_METRICS: 'true',
    WRANGLER_HIDE_BANNER: 'false',
  })
  const unsafeLookingArgument = 'lint; echo should-not-run'
  runner('npm', ['run', unsafeLookingArgument], { cwd: REPOSITORY_ROOT })
  assert.deepEqual(calls[0].args, ['run', unsafeLookingArgument])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.env.PATH, '/fixture/bin')
  assert.equal(calls[0].options.env.WRANGLER_WRITE_LOGS, 'false')
  assert.equal(calls[0].options.env.WRANGLER_SEND_METRICS, 'false')
  assert.equal(calls[0].options.env.WRANGLER_HIDE_BANNER, 'true')
  assert.equal(calls[0].options.stdio, 'inherit')
})

test('a clean temporary repository runs preview:check and ignores ignored files', () => {
  const fixture = createCleanPreviewFixture()
  try {
    const output = execFileSync('npm', ['run', 'preview:check'], {
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
  } finally {
    rmSync(fixture.temporaryRoot, { recursive: true, force: true })
  }
})
