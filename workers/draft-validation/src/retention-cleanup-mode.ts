export interface RetentionCleanupModeEnv {
  readonly RETENTION_CLEANUP_MODE?: unknown
}

export function isRetentionCleanupEnabled(env: RetentionCleanupModeEnv) {
  return env.RETENTION_CLEANUP_MODE === 'enabled'
}
