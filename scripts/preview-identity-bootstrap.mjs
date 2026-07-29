import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asWorkflowError, EXIT_CODES, usageError } from './lib/preview-release/errors.mjs'
import {
  collectIdentityBootstrapEvidence,
  projectIdentityBootstrapReport,
  renderIdentityBootstrapReport,
} from './lib/preview-release/identity-bootstrap.mjs'
import { failureReport } from './lib/preview-release/reporting.mjs'
import { safeErrorMessage } from './lib/preview-release/redaction.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')

export function parseIdentityBootstrapArguments(argv) {
  const allowed = new Set(['--json', '--no-color'])
  for (const argument of argv) {
    if (!allowed.has(argument)) throw usageError(`Unknown argument: ${argument}.`)
  }
  if (new Set(argv).size !== argv.length) {
    throw usageError('Identity-bootstrap flags may be specified only once.')
  }
  return Object.freeze({
    json: argv.includes('--json'),
    color: !argv.includes('--no-color'),
  })
}

export async function runIdentityBootstrapCli(argv, options = {}) {
  const parsed = parseIdentityBootstrapArguments(argv)
  const environment = options.environment ?? process.env
  const token = options.token ?? environment.PENNANT_PREVIEW_API_TOKEN
  const report = await collectIdentityBootstrapEvidence({
    ...options,
    repositoryRoot: options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
    environment,
    token,
  })
  ;(options.output ?? console).log(
    parsed.json
      ? JSON.stringify(projectIdentityBootstrapReport(report))
      : renderIdentityBootstrapReport(report, parsed.color),
  )
  return EXIT_CODES.SUCCESS
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    process.exitCode = await runIdentityBootstrapCli(process.argv.slice(2))
  } catch (error) {
    const safe = asWorkflowError(error)
    const token = process.env.PENNANT_PREVIEW_API_TOKEN
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(failureReport('preview:identity-bootstrap', safe, [], [token])))
    } else {
      console.error(`\n[preview:identity-bootstrap] ${safe.status}: ${safeErrorMessage(safe, [token])}`)
    }
    process.exitCode = safe.exitCode
  }
}
