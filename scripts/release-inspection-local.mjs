import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createLocalReleaseInspectionProjection,
  renderLocalReleaseInspectionProjection,
} from './lib/release-inspection/local-projection.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')

function usage() {
  return [
    'Pennant Pursuit local release inspection',
    '',
    '  node scripts/release-inspection-local.mjs',
    '',
    'Emits one canonical all-disabled local projection to stdout.',
    'It performs no network access, writes no file, and grants no deployment authorization.',
  ].join('\n')
}

export function parseReleaseInspectionLocalArguments(argv) {
  if (argv.length === 0) return Object.freeze({ help: false })
  if (argv.length === 1 && argv[0] === '--help') return Object.freeze({ help: true })
  throw new TypeError('release-inspection:local accepts no target, output, network, or execution options.')
}

export function runReleaseInspectionLocalCli(argv, {
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  output = process.stdout,
  project = createLocalReleaseInspectionProjection,
} = {}) {
  const parsed = parseReleaseInspectionLocalArguments(argv)
  if (parsed.help) {
    output.write(`${usage()}\n`)
    return null
  }
  const projection = project({ repositoryRoot })
  output.write(renderLocalReleaseInspectionProjection(projection))
  return projection
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    runReleaseInspectionLocalCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Local release inspection failed.'}\n`)
    process.exitCode = 1
  }
}
