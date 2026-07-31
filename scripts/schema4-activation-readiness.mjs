import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSchema4RepositoryReadiness } from './lib/schema4-activation-readiness.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')

export function runSchema4ReadinessCli(argv, output = console) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    throw new Error('Usage: node scripts/schema4-activation-readiness.mjs --check')
  }
  assertSchema4RepositoryReadiness(REPOSITORY_ROOT)
  output.log('Schema-4 repository readiness passed. Checked-in gates remain disabled; enabled activation remains independently guarded.')
  return 0
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    process.exitCode = runSchema4ReadinessCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Schema-4 readiness failed.')
    process.exitCode = 1
  }
}
