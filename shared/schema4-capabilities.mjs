export const SCHEMA4_CAPABILITIES = Object.freeze([
  'leaderboardRead',
  'identityClaim',
  'identityStatus',
  'identityRename',
  'draftSubmission',
  'identityRecovery',
  'cleanupCron',
])

function gate(feature, variable, compatibilityCeiling = null) {
  return Object.freeze({ feature, variable, compatibilityCeiling })
}

export const SCHEMA4_RUNTIME_GATE_REGISTRY = Object.freeze({
  frontendBuildTime: Object.freeze({
    protectedSource: 'src/config/protectedCapabilities.mjs',
    effectiveState: 'all-disabled',
    integrationStatus: 'protected-local-source',
  }),
  capabilities: Object.freeze({
    leaderboardRead: Object.freeze({
      frontendBuild: gate('leaderboardRead', null),
      pagesFunctions: gate('leaderboardRead', 'LEADERBOARD_READ_MODE'),
      privateWorker: null,
    }),
    identityClaim: Object.freeze({
      frontendBuild: gate('identityClaim', null),
      pagesFunctions: gate('identityClaim', 'LEADERBOARD_IDENTITY_CLAIM_MODE', 'LEADERBOARD_IDENTITY_MODE'),
      privateWorker: gate('identityClaim', 'LEADERBOARD_IDENTITY_CLAIM_MODE', 'LEADERBOARD_IDENTITY_MODE'),
    }),
    identityStatus: Object.freeze({
      frontendBuild: gate('identityStatus', null),
      pagesFunctions: gate('identityStatus', 'LEADERBOARD_IDENTITY_STATUS_MODE', 'LEADERBOARD_IDENTITY_MODE'),
      privateWorker: gate('identityStatus', 'LEADERBOARD_IDENTITY_STATUS_MODE', 'LEADERBOARD_IDENTITY_MODE'),
    }),
    identityRename: Object.freeze({
      frontendBuild: gate('identityRename', null),
      pagesFunctions: gate('identityRename', 'LEADERBOARD_IDENTITY_RENAME_MODE', 'LEADERBOARD_IDENTITY_MODE'),
      privateWorker: gate('identityRename', 'LEADERBOARD_IDENTITY_RENAME_MODE', 'LEADERBOARD_IDENTITY_MODE'),
    }),
    draftSubmission: Object.freeze({
      frontendBuild: gate('submission', null),
      pagesFunctions: gate('submission', 'DRAFT_SUBMISSION_MODE'),
      privateWorker: gate('submission', 'DRAFT_SUBMISSION_MODE'),
    }),
    identityRecovery: Object.freeze({
      frontendBuild: gate('recovery', null),
      pagesFunctions: gate('recovery', 'LEADERBOARD_RECOVERY_MODE', 'LEADERBOARD_IDENTITY_MODE'),
      privateWorker: gate('recovery', 'LEADERBOARD_RECOVERY_MODE', 'LEADERBOARD_IDENTITY_MODE'),
    }),
    cleanupCron: Object.freeze({
      frontendBuild: null,
      pagesFunctions: null,
      privateWorker: gate('cleanupCron', 'RETENTION_CLEANUP_MODE'),
    }),
  }),
})

export function runtimeGateFeatureState(environment, descriptor) {
  if (!descriptor || descriptor.variable === null) return 'disabled'
  if (!environment || typeof environment !== 'object') return 'disabled'
  if (environment[descriptor.variable] !== 'enabled') return 'disabled'
  if (descriptor.compatibilityCeiling !== null
    && environment[descriptor.compatibilityCeiling] !== 'enabled') return 'disabled'
  return 'enabled'
}
