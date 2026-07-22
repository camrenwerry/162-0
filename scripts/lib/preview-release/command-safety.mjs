import { readFileSync } from 'node:fs'
import path from 'node:path'
import { localError } from './errors.mjs'

const SHELL_EVALUATORS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'eval', 'exec'])
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
  ['scripts/preview-plan.mjs'],
  ['--test', 'scripts/preview-workflow.test.mjs'],
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
      if (character === '"') quote = null
      else if (character === '\\') {
        index += 1
        if (index >= command.length) throw new Error('Malformed trailing escape in package script.')
        word += command[index]
      } else word += character
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
    } else segments.at(-1).push(token.value)
  }
  return segments.filter((segment) => segment.length > 0)
}

function npmScriptReferences(scriptName, command) {
  const references = []
  for (const words of commandSegments(command)) {
    for (let index = 0; index < words.length; index += 1) {
      if (words[index] !== 'npm') continue
      const subcommand = words[index + 1]
      if (subcommand === 'test') references.push('test')
      else if (subcommand === 'run' || subcommand === 'run-script') {
        const reference = words[index + 2]
        if (!reference || !/^[A-Za-z0-9:_-]+$/.test(reference)) throw new Error(`Unsupported dynamic npm-script reference in ${scriptName}.`)
        references.push(reference)
      } else throw new Error(`Unsupported npm command in reachable script ${scriptName}.`)
    }
  }
  return references
}

export function collectReachableScripts(scripts, roots, validateCommand = () => {}) {
  const visiting = new Set()
  const visited = new Set()
  const reachable = []
  const visit = (scriptName) => {
    if (visited.has(scriptName)) return
    if (visiting.has(scriptName)) throw new Error(`Recursive package-script cycle reaches ${scriptName}.`)
    const command = scripts[scriptName]
    if (typeof command !== 'string') throw new Error(`Missing referenced package script ${scriptName}.`)
    validateCommand(scriptName, command)
    visiting.add(scriptName)
    for (const lifecycle of [`pre${scriptName}`, `post${scriptName}`]) {
      if (lifecycle in scripts) visit(lifecycle)
    }
    for (const reference of npmScriptReferences(scriptName, command)) visit(reference)
    visiting.delete(scriptName)
    visited.add(scriptName)
    reachable.push({ name: scriptName, command })
  }
  for (const root of roots) visit(root)
  return reachable
}

function commandWordBasename(word) {
  return word.replaceAll('\\', '/').split('/').at(-1).toLowerCase()
}

function assertSupportedViteCommand(scriptName, words) {
  if (words.length === 2 && words[1] === 'build') return
  const safe = words.length === 7 && words[1] === 'build' && words[2] === '--ssr'
    && SAFE_VITE_SSR_ENTRY_POINTS.has(words[3]) && words[4] === '--outDir'
    && words[5].startsWith('/tmp/pennant-pursuit-') && words[6] === '--emptyOutDir'
  if (!safe) throw new Error(`Unsupported Vite command in ${scriptName}.`)
}

export function assertLocalReleaseCommand(scriptName, command) {
  if (/^(?:db:|smoke:|dev(?::|$)|d1c4:activation$)/.test(scriptName)) throw new Error(`Unsafe release script ${scriptName}.`)
  if (command.includes('$') || command.includes('`')) throw new Error(`Unsupported dynamic shell expansion in ${scriptName}.`)
  const tokens = tokenizeShellCommand(command)
  const unsupported = tokens.find(({ type, value }) => type === 'operator' && value !== '&&')
  if (unsupported) throw new Error(`Unsupported shell operator ${unsupported.value} in ${scriptName}.`)
  npmScriptReferences(scriptName, command)
  const segments = commandSegments(command)
  if (segments.length === 0) throw new Error(`Empty command in ${scriptName}.`)
  for (const words of segments) {
    if (words.includes('--remote')) throw new Error(`Remote flag is forbidden in ${scriptName}.`)
    if (words.some((word) => SHELL_EVALUATORS.has(commandWordBasename(word)))) throw new Error(`Shell evaluator is forbidden in ${scriptName}.`)
    if (words.some((word) => KNOWN_MUTATION_ENTRY_POINTS.some((entry) => word.replaceAll('\\', '/').includes(entry)))) {
      throw new Error(`Known mutation entry point is forbidden in ${scriptName}.`)
    }
    if (words.some((word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word))) throw new Error(`Environment mutation is forbidden in ${scriptName}.`)
    const [executable, ...argumentsList] = words
    if (executable === 'npm') {
      const safe = (words.length === 2 && words[1] === 'test')
        || (words.length === 3 && ['run', 'run-script'].includes(words[1]) && /^[A-Za-z0-9:_-]+$/.test(words[2]))
      if (!safe) throw new Error(`Unsupported npm command in ${scriptName}.`)
    } else if (executable === 'node') {
      if (!SAFE_NODE_ARGUMENTS.has(JSON.stringify(argumentsList))) throw new Error(`Unsupported Node command in ${scriptName}.`)
    } else if (executable === 'vite') assertSupportedViteCommand(scriptName, words)
    else if (executable === 'tsc') {
      if (!SAFE_TSC_ARGUMENTS.has(JSON.stringify(argumentsList))) throw new Error(`Unsupported TypeScript command in ${scriptName}.`)
    } else if (executable === 'eslint') {
      if (words.length !== 2 || words[1] !== '.') throw new Error(`Unsupported ESLint command in ${scriptName}.`)
    } else if (executable === 'wrangler') {
      if (!SAFE_WRANGLER_ARGUMENTS.has(JSON.stringify(argumentsList))) throw new Error(`Unsupported Wrangler command in ${scriptName}.`)
    } else throw new Error(`Unsupported executable ${executable} in ${scriptName}.`)
  }
}

export function assertLocalReleaseGraph(scripts, roots) {
  return collectReachableScripts(scripts, roots, assertLocalReleaseCommand)
}

function coordinatorScriptReferences(stages) {
  return stages.map(({ label, command, args }) => {
    if (command !== 'npm') throw new Error(`Unsupported coordinator command in ${label}.`)
    if (args.length === 1 && args[0] === 'test') return 'test'
    if (args.length === 2 && args[0] === 'run' && /^[A-Za-z0-9:_-]+$/.test(args[1])) return args[1]
    throw new Error(`Unsupported coordinator npm arguments in ${label}.`)
  })
}

export function validateRuntimeCommandGraph(repositoryRoot, stages) {
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
    const roots = ['test', 'typecheck', ...coordinatorScriptReferences(stages)]
    return assertLocalReleaseGraph(packageJson.scripts, roots)
  } catch (error) {
    throw localError(`Release command graph is unsafe: ${error instanceof Error ? error.message : 'unknown validation failure'}`, 'commands.safety')
  }
}
