import { lstatSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  loadReleasePackage,
  serializeReleaseArtifact,
} from './lib/preview-release/artifacts.mjs'
import { asWorkflowError, EXIT_CODES, usageError } from './lib/preview-release/errors.mjs'
import { executeReleasePackage } from './lib/preview-release/release-execution.mjs'
import { failureReport, renderHumanExecution } from './lib/preview-release/reporting.mjs'
import { loadReleaseManifest } from './lib/preview-release/manifest.mjs'
import { assertSchema4ActivationPlan } from './lib/schema4-activation-readiness.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')

export function parsePreviewReleaseArguments(argv) {
  let planPath
  let json = false
  let color = true
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--plan') {
      if (planPath !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw usageError('--plan requires exactly one file path.')
      }
      planPath = argv[index + 1]
      index += 1
    } else if (argument === '--json') {
      if (json) throw usageError('--json may be specified only once.')
      json = true
    } else if (argument === '--no-color') {
      if (!color) throw usageError('--no-color may be specified only once.')
      color = false
    } else throw usageError(`Unknown argument: ${argument}.`)
  }
  if (!planPath) throw usageError('preview:release requires --plan <canonical-release-package.json>.')
  return Object.freeze({ planPath, json, color })
}

function approvedPlanPath(repositoryRoot, planPath) {
  const expectedDirectory = path.join(realpathSync(repositoryRoot), '.preview-release')
  const requestedPath = path.resolve(repositoryRoot, planPath)
  const requestedStatus = lstatSync(requestedPath)
  if (!requestedStatus.isFile() || requestedStatus.isSymbolicLink()) {
    throw usageError('Release package must be a direct regular file in the repository .preview-release directory.')
  }
  const actualPath = realpathSync(requestedPath)
  if (path.dirname(actualPath) !== expectedDirectory) {
    throw usageError('Release package must be a direct regular file in the repository .preview-release directory.')
  }
  return actualPath
}

async function interactiveApproval(challenge, output = process.stderr) {
  output.write([
    '\nPREVIEW MUTATION APPROVAL REQUIRED\n',
    'This command can deploy only the exact Preview plan and will stop on the first failure.\n',
    'Production targets remain prohibited. D1 migrations are forward-only.\n',
    `Type this exact challenge with no default:\n${challenge}\n> `,
  ].join(''))
  const prompt = createInterface({ input: process.stdin, output })
  try {
    return await prompt.question('')
  } finally {
    prompt.close()
  }
}

function writeExecutionReport(planPath, report) {
  const suffix = report.completedAt.replaceAll(':', '').replaceAll('-', '').replace('.000Z', 'Z')
  const reportPath = `${planPath.slice(0, -'.json'.length)}.execution-${suffix}.json`
  writeFileSync(reportPath, serializeReleaseArtifact(report), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return reportPath
}

export async function runPreviewReleaseCli(argv, options = {}) {
  const parsed = parsePreviewReleaseArguments(argv)
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT
  const planPath = approvedPlanPath(repositoryRoot, parsed.planPath)
  const releasePackage = loadReleasePackage(planPath, {
    nowMs: options.now?.() ?? Date.now(),
    requireUnexpired: true,
  })
  const { manifest } = loadReleaseManifest(repositoryRoot)
  assertSchema4ActivationPlan({
    repositoryRoot,
    targetState: releasePackage.plan.targetState,
    migration: releasePackage.plan.migration,
    manifest,
  })
  const execution = await executeReleasePackage(releasePackage, {
    ...options,
    repositoryRoot,
    approve: options.approve ?? ((challenge) => interactiveApproval(challenge, options.promptOutput ?? process.stderr)),
  })
  const reportPath = writeExecutionReport(planPath, execution.report)
  const output = options.output ?? console
  if (parsed.json) output.log(JSON.stringify(execution.report))
  else {
    output.log(renderHumanExecution(execution.report, parsed.color))
    output.log(`Final report: ${reportPath}`)
  }
  return Object.freeze({ ...execution, reportPath })
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  try {
    const result = await runPreviewReleaseCli(process.argv.slice(2))
    process.exitCode = result.exitCode
  } catch (error) {
    const safe = asWorkflowError(error)
    const sensitive = [
      process.env.PENNANT_PREVIEW_API_TOKEN,
      process.env.PENNANT_PREVIEW_DEPLOY_API_TOKEN,
    ]
    if (process.argv.includes('--json')) console.log(JSON.stringify(failureReport('preview:release', safe, [], sensitive)))
    else console.error(`\n[preview:release] ${safe.status}: ${safe.message}`)
    process.exitCode = safe.exitCode
  }
}
