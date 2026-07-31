import path from 'node:path'
import {
  commonTargetFromArguments,
  D1C4_PREVIEW_ACKNOWLEDGEMENT,
  parseStrictArguments,
  validatePreviewSmokeTarget,
} from './lib/d1c4-preview-guard'

const COMPILED_SCRIPT_BASENAME = 'd1c4-submission-smoke.js'
const COMMON_VALUE_OPTIONS = [
  'preview-base-url',
  'preview-worker',
  'preview-environment',
  'account-id',
  'database-id',
  'ack',
] as const

function fail(message: string): never {
  throw new Error(message)
}

function usage() {
  return [
    'D1C.4 submission smoke compatibility stub',
    '',
    'Milestone 3D-1 exposes dry-run validation and refusal-only execution behavior.',
    `Required acknowledgement: ${D1C4_PREVIEW_ACKNOWLEDGEMENT}`,
    'Any execution flag is refused before credentials, adapters, D1, network, or subprocess access.',
  ].join('\n')
}

export async function submissionSmokeCli(
  argv: readonly string[],
  dependencies: unknown = undefined,
  environment: NodeJS.ProcessEnv = {},
  output: Pick<Console, 'log' | 'error'> = console,
) {
  try {
    if (argv.includes('--execute')) {
      fail('D1C.4 submission execution is unsupported by the Milestone 3D-1 disabled-only boundary.')
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
    output.log([
      'Dry run only; no endpoint or D1 request was made and no API token was read.',
      `Preview origin: ${target.previewBaseUrl}`,
      'Execution is unavailable from this shipped compatibility module.',
    ].join('\n'))
    return 0
  } catch (error) {
    output.error(error instanceof Error ? error.message : 'D1C.4 submission compatibility stub failed closed.')
    return 1
  }
}

if (path.basename(process.argv[1] ?? '') === COMPILED_SCRIPT_BASENAME) {
  process.exitCode = await submissionSmokeCli(process.argv.slice(2))
}
