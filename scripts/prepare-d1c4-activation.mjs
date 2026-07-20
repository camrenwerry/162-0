import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const currentWorkingDirectory = path.resolve(process.cwd())
const sourceRelativeRoot = path.resolve(path.dirname(SCRIPT_PATH), '..')
const REPOSITORY_ROOT = existsSync(path.join(currentWorkingDirectory, 'workers/draft-validation/wrangler.toml'))
  ? currentWorkingDirectory
  : sourceRelativeRoot
const PAGES_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'wrangler.toml')
const WORKER_CONFIG_PATH = path.join(REPOSITORY_ROOT, 'workers/draft-validation/wrangler.toml')
const STATE_MANIFEST_PATH = path.join(REPOSITORY_ROOT, 'workers/draft-validation/d1c4-activation-states.json')

export const ACTIVATION_STATE_NAMES = Object.freeze([
  'disabled',
  'submission-enabled',
  'cron-enabled',
])

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

function replaceSectionLine(source, section, pattern, replacement, description) {
  const bounds = sectionBounds(source, section)
  const body = source.slice(bounds.bodyStart, bounds.end)
  const matches = body.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) ?? []
  if (matches.length !== 1) fail(`Expected exactly one ${description} in [${section}].`)
  const updatedBody = body.replace(pattern, replacement)
  return `${source.slice(0, bounds.bodyStart)}${updatedBody}${source.slice(bounds.end)}`
}

function readManifest(source = readFileSync(STATE_MANIFEST_PATH, 'utf8')) {
  let manifest
  try {
    manifest = JSON.parse(source)
  } catch {
    fail('D1C.4 activation-state manifest is not valid JSON.')
  }
  if (manifest?.schemaVersion !== 1 || manifest.previewOnly !== true) {
    fail('D1C.4 activation-state manifest must be schema version 1 and preview-only.')
  }
  if (typeof manifest.cleanupCron !== 'string' || manifest.cleanupCron.length === 0) {
    fail('D1C.4 activation-state manifest must define one cleanup Cron.')
  }
  if (!manifest.states || Object.keys(manifest.states).sort().join(',') !== [...ACTIVATION_STATE_NAMES].sort().join(',')) {
    fail('D1C.4 activation-state manifest must define exactly the three approved states.')
  }
  for (const stateName of ACTIVATION_STATE_NAMES) {
    const state = manifest.states[stateName]
    if (!state || !['enabled', 'disabled'].includes(state.submissionMode) || !Array.isArray(state.cleanupCrons)) {
      fail(`D1C.4 activation state ${stateName} is malformed.`)
    }
    if (state.cleanupCrons.some((cron) => cron !== manifest.cleanupCron)) {
      fail(`D1C.4 activation state ${stateName} contains an unapproved Cron.`)
    }
  }
  const disabled = manifest.states.disabled
  const submission = manifest.states['submission-enabled']
  const cron = manifest.states['cron-enabled']
  if (
    disabled.submissionMode !== 'disabled' || disabled.cleanupCrons.length !== 0
    || submission.submissionMode !== 'enabled' || submission.cleanupCrons.length !== 0
    || cron.submissionMode !== 'enabled'
    || cron.cleanupCrons.length !== 1 || cron.cleanupCrons[0] !== manifest.cleanupCron
  ) fail('D1C.4 activation-state transitions do not match the approved three-state contract.')
  return manifest
}

function assertCanonicalDisabled(pagesConfig, workerConfig) {
  const pagesVars = sectionBody(pagesConfig, 'vars')
  const workerVars = sectionBody(workerConfig, 'vars')
  const workerTriggers = sectionBody(workerConfig, 'triggers')
  if (!/^DRAFT_SUBMISSION_MODE = "disabled"$/m.test(pagesVars)) fail('Checked-in Pages preview submission must be disabled.')
  if (!/^DRAFT_SUBMISSION_MODE = "disabled"$/m.test(workerVars)) fail('Checked-in private Worker preview submission must be disabled.')
  if (!/^crons = \[\]$/m.test(workerTriggers)) fail('Checked-in private Worker preview Cron must be explicitly absent.')
  if (/^\[triggers\]$|^crons\s*=/m.test(pagesConfig)) fail('Pages configuration must not define Cron triggers.')
  const pagesProduction = sectionBody(pagesConfig, 'env.production.vars')
  const workerProductionVars = sectionBody(workerConfig, 'env.production.vars')
  const workerProductionTriggers = sectionBody(workerConfig, 'env.production.triggers')
  if (!/^DRAFT_SUBMISSION_MODE = "disabled"$/m.test(pagesProduction)) fail('Production Pages submission must remain disabled.')
  if (!/^DRAFT_SUBMISSION_MODE = "disabled"$/m.test(workerProductionVars)) fail('Production Worker submission must remain disabled.')
  if (!/^crons = \[\]$/m.test(workerProductionTriggers)) fail('Production Worker Cron must remain explicitly absent.')
}

function replacePreviewSubmissionMode(source, mode) {
  return replaceSectionLine(
    source,
    'vars',
    /^DRAFT_SUBMISSION_MODE = "(?:enabled|disabled)"$/m,
    `DRAFT_SUBMISSION_MODE = "${mode}"`,
    'preview submission mode',
  )
}

function replacePreviewCrons(source, crons) {
  const serialized = `[${crons.map((cron) => JSON.stringify(cron)).join(', ')}]`
  return replaceSectionLine(source, 'triggers', /^crons = \[.*\]$/m, `crons = ${serialized}`, 'preview Cron list')
}

export function loadActivationInputs() {
  return {
    manifest: readManifest(),
    pagesConfig: readFileSync(PAGES_CONFIG_PATH, 'utf8'),
    workerConfig: readFileSync(WORKER_CONFIG_PATH, 'utf8'),
  }
}

export function materializeActivationState(stateName, inputs = loadActivationInputs()) {
  if (!ACTIVATION_STATE_NAMES.includes(stateName)) fail(`Unknown D1C.4 activation state: ${stateName ?? '<missing>'}.`)
  const manifest = readManifest(JSON.stringify(inputs.manifest))
  assertCanonicalDisabled(inputs.pagesConfig, inputs.workerConfig)
  const state = manifest.states[stateName]
  const pagesProduction = inputs.pagesConfig.slice(sectionBounds(inputs.pagesConfig, 'env.production').start)
  const workerProduction = inputs.workerConfig.slice(sectionBounds(inputs.workerConfig, 'env.production').start)
  const pagesConfig = replacePreviewSubmissionMode(inputs.pagesConfig, state.submissionMode)
  const workerConfig = replacePreviewCrons(
    replacePreviewSubmissionMode(inputs.workerConfig, state.submissionMode),
    state.cleanupCrons,
  )
  if (pagesConfig.slice(sectionBounds(pagesConfig, 'env.production').start) !== pagesProduction) {
    fail(`State ${stateName} changed production Pages configuration.`)
  }
  if (workerConfig.slice(sectionBounds(workerConfig, 'env.production').start) !== workerProduction) {
    fail(`State ${stateName} changed production Worker configuration.`)
  }
  return Object.freeze({ stateName, pagesConfig, workerConfig })
}

export function generatedConfigPaths(stateName) {
  if (!ACTIVATION_STATE_NAMES.includes(stateName)) fail(`Unknown D1C.4 activation state: ${stateName ?? '<missing>'}.`)
  return Object.freeze({
    pages: path.join(REPOSITORY_ROOT, `wrangler.d1c4-${stateName}.generated.toml`),
    worker: path.join(REPOSITORY_ROOT, `workers/draft-validation/wrangler.d1c4-${stateName}.generated.toml`),
  })
}

function changedLines(before, after) {
  const original = before.split('\n')
  const generated = after.split('\n')
  if (original.length !== generated.length) fail('Activation materialization unexpectedly changed configuration line count.')
  return original.flatMap((line, index) => line === generated[index] ? [] : [{ line: index + 1, before: line, after: generated[index] }])
}

export function activationDiff(stateName, inputs = loadActivationInputs()) {
  const generated = materializeActivationState(stateName, inputs)
  return Object.freeze({
    pages: changedLines(inputs.pagesConfig, generated.pagesConfig),
    worker: changedLines(inputs.workerConfig, generated.workerConfig),
  })
}

export function validateAllActivationStates(inputs = loadActivationInputs()) {
  const generated = Object.fromEntries(ACTIVATION_STATE_NAMES.map((state) => [state, materializeActivationState(state, inputs)]))
  const disabled = generated.disabled
  const submission = generated['submission-enabled']
  const cron = generated['cron-enabled']
  if (disabled.pagesConfig !== inputs.pagesConfig || disabled.workerConfig !== inputs.workerConfig) {
    fail('Disabled state must exactly equal the checked-in safe defaults.')
  }
  const submissionToCronPages = changedLines(submission.pagesConfig, cron.pagesConfig)
  const submissionToCronWorker = changedLines(submission.workerConfig, cron.workerConfig)
  if (submissionToCronPages.length !== 0) fail('Cron activation must not change Pages configuration.')
  if (
    submissionToCronWorker.length !== 1
    || submissionToCronWorker[0].before !== 'crons = []'
    || submissionToCronWorker[0].after !== `crons = [${JSON.stringify(inputs.manifest.cleanupCron)}]`
  ) fail('Cron-enabled must differ from submission-enabled only by the approved preview Cron line.')
  return Object.freeze(generated)
}

function usage() {
  return [
    'D1C.4 repository-only activation configuration preparation',
    '',
    '  node scripts/prepare-d1c4-activation.mjs --check',
    '  node scripts/prepare-d1c4-activation.mjs --state <state> --review',
    '  node scripts/prepare-d1c4-activation.mjs --state <state> --write',
    '',
    `States: ${ACTIVATION_STATE_NAMES.join(', ')}`,
    'This script never invokes Wrangler or changes remote state.',
  ].join('\n')
}

function parseArguments(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) return { help: true }
  if (argv.includes('--help')) fail('--help cannot be combined with other arguments.')
  let state
  let action
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--state') {
      if (state !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) fail('Expected one value after --state.')
      state = argv[index + 1]
      index += 1
    } else if (argument === '--check' || argument === '--review' || argument === '--write') {
      if (action !== undefined) fail('Choose exactly one of --check, --review, or --write.')
      action = argument.slice(2)
    } else fail(`Unknown argument: ${argument}.`)
  }
  if (!action) fail('Choose exactly one of --check, --review, or --write.')
  if (action === 'check' && state !== undefined) fail('--check validates all states and does not accept --state.')
  if (action !== 'check' && !state) fail(`--${action} requires --state.`)
  if (state && !ACTIVATION_STATE_NAMES.includes(state)) fail(`Unknown D1C.4 activation state: ${state}.`)
  return { action, state }
}

function formatDiff(label, changes) {
  const lines = [`${label}:`]
  if (changes.length === 0) lines.push('  no changes')
  for (const change of changes) lines.push(`  line ${change.line}:`, `  - ${change.before}`, `  + ${change.after}`)
  return lines.join('\n')
}

export function runActivationCli(argv, output = console) {
  const arguments_ = parseArguments(argv)
  if (arguments_.help) {
    output.log(usage())
    return 0
  }
  const inputs = loadActivationInputs()
  validateAllActivationStates(inputs)
  if (arguments_.action === 'check') {
    output.log('Validated disabled, submission-enabled, and cron-enabled preview configurations. No files or remote state changed.')
    return 0
  }
  const stateName = arguments_.state
  if (arguments_.action === 'review') {
    const diff = activationDiff(stateName, inputs)
    output.log([`D1C.4 state: ${stateName}`, formatDiff('Pages', diff.pages), formatDiff('Private Worker', diff.worker), 'No files or remote state changed.'].join('\n'))
    return 0
  }
  const generated = materializeActivationState(stateName, inputs)
  const paths = generatedConfigPaths(stateName)
  writeFileSync(paths.pages, generated.pagesConfig, { encoding: 'utf8', flag: 'w' })
  writeFileSync(paths.worker, generated.workerConfig, { encoding: 'utf8', flag: 'w' })
  output.log([
    `Prepared local ignored configuration files for D1C.4 state: ${stateName}`,
    path.relative(REPOSITORY_ROOT, paths.pages),
    path.relative(REPOSITORY_ROOT, paths.worker),
    'No Wrangler command ran and no remote state changed.',
  ].join('\n'))
  return 0
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    process.exitCode = runActivationCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'D1C.4 activation preparation failed.')
    process.exitCode = 1
  }
}
