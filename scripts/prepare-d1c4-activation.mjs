import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  parseSchema4CapabilityModel,
  SCHEMA4_CAPABILITIES,
} from './lib/schema4-activation-authority.mjs'
import {
  readBoundedUtf8File,
  STRICT_JSON_LIMITS,
} from './lib/preview-release/canonical.mjs'
import {
  assertSchema4RepositoryReadiness,
  loadSchema4ReadinessModel,
} from './lib/schema4-activation-readiness.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const currentWorkingDirectory = path.resolve(process.cwd())
const sourceRelativeRoot = path.resolve(path.dirname(SCRIPT_PATH), '..')
const REPOSITORY_ROOT = existsSync(path.join(currentWorkingDirectory, 'workers/draft-validation/wrangler.toml'))
  ? currentWorkingDirectory
  : sourceRelativeRoot
const PAGES_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'wrangler.toml')
const WORKER_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'workers/draft-validation/wrangler.toml')
const CAPABILITY_MODEL_PATH = path.join(REPOSITORY_ROOT, 'workers/draft-validation/d1c4-activation-states.json')

function fail(message) {
  throw new Error(message)
}

function sectionBounds(source, section) {
  const heading = `[${section}]`
  const start = source.indexOf(`${heading}\n`)
  if (start < 0 || source.indexOf(`${heading}\n`, start + heading.length) >= 0) {
    fail(`Expected exactly one ${heading} section.`)
  }
  const bodyStart = start + heading.length + 1
  const nextSection = source.indexOf('\n[', bodyStart)
  return { start, bodyStart, end: nextSection < 0 ? source.length : nextSection + 1 }
}

function sectionBody(source, section) {
  const { bodyStart, end } = sectionBounds(source, section)
  return source.slice(bodyStart, end)
}

function parsePlainStringVariables(source, section) {
  const entries = new Map()
  for (const line of sectionBody(source, section).split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*) = "([a-z-]+)"$/)
    if (!match) fail(`[${section}] contains a malformed plain-text variable.`)
    if (entries.has(match[1])) fail(`[${section}] contains duplicate variable ${match[1]}.`)
    entries.set(match[1], match[2])
  }
  return entries
}

function expectedVariables(readiness, surface, environment) {
  const variables = new Map([
    ['DRAFT_VALIDATION_MODE', 'enabled'],
    ['DRAFT_TICKET_MODE', environment === 'preview' ? 'enabled' : 'disabled'],
  ])
  for (const capability of SCHEMA4_CAPABILITIES) {
    const variable = readiness.capabilityVariables[capability][surface]
    if (variable !== null) variables.set(variable, 'disabled')
  }
  const ceiling = readiness.identityCompatibilityCeilingVariables[surface]
  if (ceiling !== null) variables.set(ceiling, 'disabled')
  if (surface === 'pagesFunctions') {
    variables.set(readiness.environmentMarkers.pages, environment)
  }
  return variables
}

function assertExactVariables(actual, expected, label) {
  const actualKeys = [...actual.keys()].sort()
  const expectedKeys = [...expected.keys()].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(`${label} variables must match the exact protected capability inventory.`)
  }
  for (const [name, value] of expected) {
    if (actual.get(name) !== value) fail(`${label} ${name} must be exactly ${value}.`)
  }
}

function assertCheckedInConfiguration(pagesConfig, workerConfig, readiness) {
  assertExactVariables(
    parsePlainStringVariables(pagesConfig, 'vars'),
    expectedVariables(readiness, 'pagesFunctions', 'preview'),
    'Pages Preview',
  )
  assertExactVariables(
    parsePlainStringVariables(pagesConfig, 'env.production.vars'),
    expectedVariables(readiness, 'pagesFunctions', 'production'),
    'Pages Production',
  )
  assertExactVariables(
    parsePlainStringVariables(workerConfig, 'vars'),
    expectedVariables(readiness, 'privateWorker', 'preview'),
    'Worker Preview',
  )
  assertExactVariables(
    parsePlainStringVariables(workerConfig, 'env.production.vars'),
    expectedVariables(readiness, 'privateWorker', 'production'),
    'Worker Production',
  )
  const previewTriggerLines = sectionBody(workerConfig, 'triggers').split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
  if (JSON.stringify(previewTriggerLines) !== JSON.stringify(['crons = []'])) {
    fail('Checked-in private Worker Preview Cron list must be empty.')
  }
  const productionTriggerLines = sectionBody(workerConfig, 'env.production.triggers').split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
  if (JSON.stringify(productionTriggerLines) !== JSON.stringify(['crons = []'])) {
    fail('Checked-in private Worker Production Cron list must be empty.')
  }
  if (/^\[triggers\]$|^crons\s*=/m.test(pagesConfig)) {
    fail('Pages configuration must not define Cron triggers.')
  }
  const productionWorker = workerConfig.slice(sectionBounds(workerConfig, 'env.production').start)
  if (/^\[\[env\.production\.d1_databases\]\]$/m.test(productionWorker)) {
    fail('Production Worker must not have a D1 binding.')
  }
}

export function loadProtectedCapabilityInputs(repositoryRoot = REPOSITORY_ROOT) {
  return Object.freeze({
    capabilityModelSource: readBoundedUtf8File(
      path.join(repositoryRoot, path.relative(REPOSITORY_ROOT, CAPABILITY_MODEL_PATH)),
      {
        label: 'Schema-4 capability model',
        maxBytes: STRICT_JSON_LIMITS.authorityModel.maxBytes,
      },
    ),
    pagesConfig: readBoundedUtf8File(
      path.join(repositoryRoot, path.relative(REPOSITORY_ROOT, PAGES_CONFIG_PATH)),
      { label: 'Pages configuration', maxBytes: STRICT_JSON_LIMITS.releaseManifest.maxBytes },
    ),
    workerConfig: readBoundedUtf8File(
      path.join(repositoryRoot, path.relative(REPOSITORY_ROOT, WORKER_CONFIG_PATH)),
      { label: 'Worker configuration', maxBytes: STRICT_JSON_LIMITS.releaseManifest.maxBytes },
    ),
  })
}

export function validateProtectedCapabilityFoundation(inputs = loadProtectedCapabilityInputs(), {
  repositoryRoot = REPOSITORY_ROOT,
  nowMs = Date.now(),
  readiness = loadSchema4ReadinessModel(repositoryRoot),
} = {}) {
  const capabilityModel = parseSchema4CapabilityModel(inputs.capabilityModelSource, nowMs)
  if (
    capabilityModel.modelVersion !== readiness.authorityContract.modelVersion
    || capabilityModel.authoritySchemaVersion !== readiness.authorityContract.schemaVersion
    || capabilityModel.maximumReviewWindowMs !== readiness.authorityContract.maximumReviewWindowMs
  ) fail('Protected capability model differs from the readiness contract.')
  assertCheckedInConfiguration(inputs.pagesConfig, inputs.workerConfig, readiness)
  return Object.freeze({ capabilityModel, pagesConfig: inputs.pagesConfig, workerConfig: inputs.workerConfig })
}

export function validateCheckedInProtectedCapabilityFoundation(repositoryRoot = REPOSITORY_ROOT) {
  assertSchema4RepositoryReadiness(repositoryRoot)
  return validateProtectedCapabilityFoundation(loadProtectedCapabilityInputs(repositoryRoot), { repositoryRoot })
}

function usage() {
  return [
    'Schema-4 protected capability-model validation',
    '',
    '  node scripts/prepare-d1c4-activation.mjs --check',
    '',
    'This disabled-only command never writes files, invokes Wrangler, or contacts a remote service.',
  ].join('\n')
}

export function runActivationCli(argv, output = console) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    output.log(usage())
    return 0
  }
  if (argv.length !== 1 || argv[0] !== '--check') fail('Only --check is supported by the disabled-only capability foundation.')
  validateCheckedInProtectedCapabilityFoundation()
  output.log('Validated exact all-disabled Preview and Production capability authorities, variables, Cron lists, and Production Worker isolation. No files or remote state changed.')
  return 0
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    process.exitCode = runActivationCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Schema-4 protected capability validation failed.')
    process.exitCode = 1
  }
}
