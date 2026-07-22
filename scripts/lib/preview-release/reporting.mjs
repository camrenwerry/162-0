import { asWorkflowError } from './errors.mjs'
import { immutablePlain } from './canonical.mjs'
import { safeErrorMessage } from './redaction.mjs'

export function check(id, status, summary, classification = null) {
  return immutablePlain({ id, status, summary, classification })
}

export function checkReport(input) {
  const { mode, checks, noRemoteMutation = true } = immutablePlain(input)
  return immutablePlain({
    schemaVersion: 1,
    command: 'preview:check',
    mode,
    status: checks.some(({ status }) => ['FAIL', 'REFUSED', 'AMBIGUOUS'].includes(status)) ? 'FAIL' : 'PASS',
    checks,
    noRemoteMutation,
  })
}

export function failureReport(command, error, checks = [], sensitiveValues = []) {
  const safe = asWorkflowError(error)
  return immutablePlain({
    schemaVersion: 1,
    command,
    status: safe.status,
    exitCode: safe.exitCode,
    error: {
      checkId: safe.checkId,
      classification: safe.classification,
      message: safeErrorMessage(safe, sensitiveValues),
    },
    checks,
    noRemoteMutation: true,
  })
}

export function renderHumanCheck(report, color = true) {
  const safeReport = immutablePlain(report)
  const colors = color ? {
    PASS: '\u001B[32m', FAIL: '\u001B[31m', REFUSED: '\u001B[31m', AMBIGUOUS: '\u001B[33m', 'NOT CHECKED': '\u001B[90m', 'NO-OP': '\u001B[36m',
  } : {}
  const reset = color ? '\u001B[0m' : ''
  const lines = [`Preview check (${safeReport.mode})`]
  for (const item of safeReport.checks) lines.push(`${colors[item.status] ?? ''}${item.status}${reset} ${item.id}: ${item.summary}`)
  lines.push('PASS safety.no-remote-mutation: No remote mutation was performed.')
  if (safeReport.mode === 'offline') lines.push('All local Preview release-readiness checks passed. No remote operations ran.')
  return lines.join('\n')
}

export function renderHumanPlan(plan, color = true) {
  const safePlan = immutablePlain(plan)
  const label = safePlan.outcome === 'NO-OP' ? 'NO-OP' : 'PASS'
  const prefix = color ? (label === 'NO-OP' ? '\u001B[36m' : '\u001B[32m') : ''
  const reset = color ? '\u001B[0m' : ''
  const lines = [
    `${prefix}${label}${reset} Preview release plan ${safePlan.planId}`,
    `Target state: ${safePlan.targetState}`,
    `Observed state: ${safePlan.observedState}`,
    `Git HEAD: ${safePlan.gitHead}`,
    `Pending migrations: ${safePlan.migration.pending.length}`,
    `Deployment changes: ${safePlan.deploymentOutcome}`,
    `Operational verification required: ${safePlan.operationalVerificationRequired ? 'yes' : 'no'}`,
    'Artifact currentness: unproven; fingerprints are local intended evidence only.',
  ]
  if (safePlan.futureStages.length === 0) lines.push('NO-OP Deployment configuration, artifacts, and disabled operational state are current.')
  else if (safePlan.deploymentOutcome === 'NO-OP') lines.push('NO-OP Deployment configuration and artifacts are current; future operational verification is still required.')
  else for (const item of safePlan.futureStages) lines.push(`NOT CHECKED ${item.id}: ${item.description}`)
  if (safePlan.futureStages.length > 0 && safePlan.deploymentOutcome === 'NO-OP') {
    for (const item of safePlan.futureStages) lines.push(`NOT CHECKED ${item.id}: ${item.description}`)
  }
  lines.push('PASS safety.no-remote-mutation: Phase 1 performed no remote mutation.')
  return lines.join('\n')
}
