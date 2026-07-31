import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleasePackage, writeReleasePackage } from './lib/preview-release/artifacts.mjs'
import { asWorkflowError, EXIT_CODES, usageError } from './lib/preview-release/errors.mjs'
import { failureReport, renderHumanPlan } from './lib/preview-release/reporting.mjs'
import { createPreviewPlan } from './preview-plan.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')

export function parsePreviewReadinessArguments(argv) {
  let targetState
  let json = false
  let color = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--target-state') {
      if (targetState !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw usageError('--target-state requires exactly one value.')
      }
      targetState = argv[index + 1]
      index += 1
    } else if (argument === '--json') {
      if (json) throw usageError('--json may be specified only once.')
      json = true
    } else if (argument === '--no-color') {
      if (!color) throw usageError('--no-color may be specified only once.')
      color = false
    } else throw usageError(`Unknown argument: ${argument}.`)
  }
  if (targetState !== 'disabled') {
    throw usageError('preview:readiness requires --target-state disabled until Milestone 3D-2.')
  }
  return Object.freeze({ targetState, json, color })
}

export async function runPreviewReadinessCli(argv, options = {}) {
  const parsed = parsePreviewReadinessArguments(argv)
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT
  const plan = await createPreviewPlan({
    ...options,
    repositoryRoot,
    ...parsed,
    captureStages: parsed.json,
  })
  const releasePackage = createReleasePackage(plan, { nowMs: options.nowMs ?? Date.now() })
  const filePath = writeReleasePackage(repositoryRoot, releasePackage)
  const output = options.output ?? console
  if (parsed.json) output.log(JSON.stringify(releasePackage))
  else {
    output.log(renderHumanPlan(plan, parsed.color))
    output.log([
      '',
      `Evidence package: ${filePath}`,
      `Expires: ${releasePackage.expiresAt}`,
      'Inspection and planning completed. No remote mutation occurred.',
      'A separate interactive release command and exact typed approval are required.',
    ].join('\n'))
  }
  return Object.freeze({ exitCode: EXIT_CODES.SUCCESS, filePath, releasePackage })
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    const result = await runPreviewReadinessCli(process.argv.slice(2))
    process.exitCode = result.exitCode
  } catch (error) {
    const safe = asWorkflowError(error)
    const sensitive = process.env.PENNANT_PREVIEW_API_TOKEN
    if (process.argv.includes('--json')) console.log(JSON.stringify(failureReport('preview:readiness', safe, [], [sensitive])))
    else console.error(`\n[preview:readiness] ${safe.status}: ${safe.message}`)
    process.exitCode = safe.exitCode
  }
}
