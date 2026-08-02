import {
  createOfflineRemoteObservation,
  renderRemoteObservationJson,
  validateRemoteObservationArtifact,
} from './lib/release-inspection/remote-contracts.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './lib/release-inspection/intrinsic-integrity.mjs'

const HELP = `Pennant Pursuit read-only remote observation (Milestone 3D-2B.1)

Usage:
  node scripts/release-inspection-observe.mjs [--offline] [--json] [--no-color]
  node scripts/release-inspection-observe.mjs --help

Options:
  --help             Show this help text.
  --offline          Emit the deterministic no-contact placeholder (default).
  --online-preview   Unimplemented in 3D-2B.1; always refuses before credentials or transport.
  --json             Emit canonical JSON instead of the human summary.
  --no-color         Disable color (offline output is already color-free).
`

function usageError() {
  return new TypeError('release-inspection-observe accepts only --help, --offline, --online-preview, --json, and --no-color; it accepts no token, target, config, output, or execution options.')
}

function validateCliDependencies(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Reflect.getPrototypeOf(input))) {
    throw new TypeError('release-inspection-observe internal dependencies must be a plain object.')
  }
  const keys = Reflect.ownKeys(input)
  if (keys.some((key) => typeof key !== 'string' || !['createArtifact', 'output'].includes(key))) {
    throw usageError()
  }
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw new TypeError('release-inspection-observe internal dependencies must use data properties only.')
    }
  }
  if (Object.hasOwn(input, 'createArtifact') && typeof input.createArtifact !== 'function') {
    throw new TypeError('release-inspection-observe createArtifact dependency must be a function.')
  }
  if (Object.hasOwn(input, 'output')
    && (!input.output || typeof input.output.write !== 'function')) {
    throw new TypeError('release-inspection-observe output dependency must expose write().')
  }
  return input
}

export function parseReleaseInspectionObserveArguments(args) {
  assertReleaseInspectionIntrinsicIntegrity()
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) throw usageError()
  const allowed = new Set(['--help', '--offline', '--online-preview', '--json', '--no-color'])
  if (args.some((argument) => !allowed.has(argument)) || new Set(args).size !== args.length) {
    throw usageError()
  }
  const help = args.includes('--help')
  const offline = args.includes('--offline')
  const onlinePreview = args.includes('--online-preview')
  if ((help && args.length !== 1) || (offline && onlinePreview)) throw usageError()
  return Object.freeze({
    help,
    mode: onlinePreview ? 'online-preview' : 'offline',
    json: args.includes('--json'),
    noColor: args.includes('--no-color'),
  })
}

export function renderOfflineRemoteObservationSummary(artifact) {
  const validated = validateRemoteObservationArtifact(artifact)
  return [
    'Pennant Pursuit remote observation (offline)',
    `Preview: ${validated.environments.preview.contactStatus}; comparison ${validated.environments.preview.comparison}`,
    `Production: ${validated.environments.production.contactStatus}; comparison ${validated.environments.production.comparison} (excluded)`,
    `Release currentness: ${validated.releaseCurrentness}`,
    `Execution authorization: ${validated.executionAuthorization}`,
    '',
  ].join('\n')
}

export function runReleaseInspectionObserveCli(args, options = {}) {
  assertReleaseInspectionIntrinsicIntegrity()
  const parsed = parseReleaseInspectionObserveArguments(args)
  if (parsed.mode === 'online-preview') {
    throw new TypeError('Authenticated Preview observation is unimplemented in Milestone 3D-2B.1; refusal occurred before credentials, transport, clocks, filesystem, network, or subprocess initialization.')
  }
  const dependencies = validateCliDependencies(options)
  const output = dependencies.output ?? process.stdout
  if (parsed.help) {
    output.write(HELP)
    return null
  }
  const createArtifact = dependencies.createArtifact ?? createOfflineRemoteObservation
  let created
  try {
    created = createArtifact()
  } catch {
    throw new TypeError('release-inspection-observe artifact creation failed before rendering.')
  }
  let artifact
  try {
    artifact = validateRemoteObservationArtifact(created)
  } catch {
    throw new TypeError('release-inspection-observe artifact validation failed before rendering.')
  }
  output.write(parsed.json
    ? renderRemoteObservationJson(artifact)
    : renderOfflineRemoteObservationSummary(artifact))
  return artifact
}

function main() {
  try {
    runReleaseInspectionObserveCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Remote observation failed.'}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
