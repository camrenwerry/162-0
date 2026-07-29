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
  lines.push('PASS safety.no-remote-mutation: Planning performed no remote mutation.')
  return lines.join('\n')
}

export function validationReport(checks) {
  const safeChecks = immutablePlain(checks)
  return immutablePlain({
    schemaVersion: 1,
    kind: 'preview-release-validation',
    status: safeChecks.length === 0 ? 'NOT-RUN' : safeChecks.every(({ status }) => status === 'PASS') ? 'PASS' : 'FAIL',
    checks: safeChecks,
  })
}

export function rollbackGuidance({
  targetState,
  observedState,
  mutationAttempted,
  completedStageIds,
  attemptedStageIds = completedStageIds,
  failedStageId = null,
}) {
  const publicEnableAttempted = attemptedStageIds.includes('pages.deploy') && targetState !== 'disabled'
  const publicDisableCompleted = completedStageIds.includes('pages.disable')
    || (completedStageIds.includes('pages.deploy') && targetState === 'disabled')
  const publicGateEnabled = publicEnableAttempted
    || (observedState !== 'disabled' && !publicDisableCompleted)
  const migrationApplied = attemptedStageIds.includes('migration.apply')
  return immutablePlain({
    schemaVersion: 1,
    kind: 'preview-release-rollback-guidance',
    automaticRollbackPerformed: false,
    urgency: !mutationAttempted ? 'none' : publicGateEnabled ? 'disable-public-gate' : 'inspect-before-retry',
    failedStageId,
    publicGateMayBeEnabled: publicGateEnabled,
    d1MigrationMayHaveAdvanced: migrationApplied,
    d1RollbackAvailable: false,
    nextAction: !mutationAttempted
      ? 'No remote rollback is needed because no mutation was attempted.'
      : publicGateEnabled
        ? 'Generate and independently approve a fresh disabled-state plan; disable the Pages submission gate before any other rollback action.'
        : 'Inspect the final report and live Preview state read-only before generating a fresh plan. Do not resume from the failed local package.',
    warning: 'Never reuse a partial package, infer success from a command exit alone, or apply a D1 down-migration automatically.',
  })
}

export function executionReport({
  releasePackage,
  startedAt,
  completedAt,
  status,
  stageResults,
  finalValidation,
  mutationAttempted,
  error = null,
  sensitiveValues = [],
}) {
  const completedStageIds = stageResults.filter(({ status: stageStatus }) => stageStatus === 'PASS').map(({ id }) => id)
  const attemptedStageIds = stageResults.filter(({ status: stageStatus }) => ['PASS', 'FAIL'].includes(stageStatus)).map(({ id }) => id)
  const failedStageId = stageResults.find(({ status: stageStatus }) => stageStatus === 'FAIL')?.id ?? null
  const safeError = error === null ? null : asWorkflowError(error)
  return immutablePlain({
    schemaVersion: 1,
    kind: 'pennant-pursuit-preview-release-execution',
    status,
    planId: releasePackage.plan.planId,
    artifactHash: releasePackage.artifactHash,
    targetState: releasePackage.plan.targetState,
    gitHead: releasePackage.plan.gitHead,
    startedAt,
    completedAt,
    mutationAttempted,
    productionMutationAttempted: false,
    stages: stageResults,
    validation: finalValidation,
    error: safeError === null ? null : {
      checkId: safeError.checkId,
      classification: safeError.classification,
      message: safeErrorMessage(safeError, sensitiveValues),
    },
    rollback: rollbackGuidance({
      targetState: releasePackage.plan.targetState,
      observedState: releasePackage.plan.observedState,
      mutationAttempted,
      completedStageIds,
      attemptedStageIds,
      failedStageId,
    }),
    summary: status === 'PASS'
      ? 'Approved Preview release execution and required post-deployment validation completed.'
      : status === 'PARTIAL'
        ? 'Preview execution stopped after a partial mutation. Follow rollback guidance; do not resume this package.'
        : 'Preview execution failed closed before completing the approved release.',
  })
}

export function renderHumanExecution(report, color = true) {
  const safeReport = immutablePlain(report)
  const colorCode = color ? (safeReport.status === 'PASS' ? '\u001B[32m' : '\u001B[31m') : ''
  const reset = color ? '\u001B[0m' : ''
  const lines = [
    `${colorCode}${safeReport.status}${reset} Preview release execution ${safeReport.planId}`,
    `Target state: ${safeReport.targetState}`,
    `Git HEAD: ${safeReport.gitHead}`,
  ]
  for (const stage of safeReport.stages) lines.push(`${stage.status} ${stage.id}: ${stage.summary}`)
  if (safeReport.error !== null) lines.push(`Failure: ${safeReport.error.message}`)
  lines.push(`Validation: ${safeReport.validation.status}`)
  lines.push(`Rollback: ${safeReport.rollback.nextAction}`)
  lines.push('Production operations: prohibited and not attempted.')
  return lines.join('\n')
}
