import path from 'node:path'
import {
  commonTargetFromArguments,
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  parseStrictArguments,
  validatePreviewSmokeTarget,
} from './lib/d1c4-preview-guard'

const COMPILED_SCRIPT_BASENAME = 'd1c4-retention-smoke.js'
const COMMON_VALUE_OPTIONS = [
  'preview-base-url',
  'preview-worker',
  'preview-environment',
  'account-id',
  'database-id',
  'ack',
  'poll-seconds',
  'timeout-seconds',
  'request-timeout-seconds',
] as const

function fail(message: string): never {
  throw new Error(message)
}

function boundedInteger(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail(`${name} must be a whole number from ${minimum} through ${maximum}.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

function usage() {
  return [
    'D1C.4 retention smoke compatibility stub',
    '',
    'Milestone 3D-1 exposes dry-run validation and refusal-only execution behavior.',
    `Required acknowledgement: ${D1C4_PREVIEW_ACKNOWLEDGEMENT}`,
    'Any execution flag is refused before credentials, adapters, D1, network, or subprocess access.',
  ].join('\n')
}

export async function retentionSmokeCli(
  argv: readonly string[],
  dependencies: unknown = undefined,
  environment: NodeJS.ProcessEnv = {},
  output: Pick<Console, 'log' | 'error'> = console,
) {
  try {
    if (argv.includes('--execute')) {
      fail('D1C.4 retention execution is unsupported by the Milestone 3D-1 disabled-only boundary.')
    }
    void dependencies
    void environment
    if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
      output.log(usage())
      return 0
    }
    if (argv.includes('--help')) fail('--help cannot be combined with other arguments.')
    const arguments_ = parseStrictArguments(argv, COMMON_VALUE_OPTIONS)
    const target = validatePreviewSmokeTarget(commonTargetFromArguments(arguments_))
    const pollSeconds = boundedInteger(arguments_['poll-seconds'], 15, '--poll-seconds', 5, 300)
    const timeoutSeconds = boundedInteger(arguments_['timeout-seconds'], 8_000, '--timeout-seconds', 3_600, 10_800)
    const requestTimeoutSeconds = boundedInteger(arguments_['request-timeout-seconds'], 10, '--request-timeout-seconds', 1, 30)
    output.log([
      'Dry run only; no endpoint or D1 request was made and no API token was read.',
      `Preview origin: ${target.previewBaseUrl}`,
      `Validated polling bounds: ${pollSeconds}s / ${timeoutSeconds}s / ${requestTimeoutSeconds}s request timeout`,
      'Execution is unavailable from this shipped compatibility module.',
    ].join('\n'))
    return 0
  } catch (error) {
    output.error(error instanceof Error ? error.message : 'D1C.4 retention compatibility stub failed closed.')
    return 1
  }
}

if (path.basename(process.argv[1] ?? '') === COMPILED_SCRIPT_BASENAME) {
  process.exitCode = await retentionSmokeCli(process.argv.slice(2))
}
