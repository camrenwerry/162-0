import { localError } from './errors.mjs'

export const PROTECTED_CONFIGURATION_PATHS = Object.freeze([
  'config/preview-release.json',
  'config/release-inspection-manifest.json',
  'config/preview-schema4-readiness.json',
  'scripts/lib/preview-release/wrangler-topology.mjs',
  'shared/schema4-capabilities.mjs',
  'shared/schema4-runtime-consumers.mjs',
  'src/config/protectedCapabilities.mjs',
  'src/features/leaderboard/runtimeConfig.registrations.json',
  'functions/lib/leaderboard-mode.registrations.json',
  'functions/lib/leaderboard-identity-mode.registrations.json',
  'functions/lib/draft-submission-mode.registrations.json',
  'workers/draft-validation/src/retention-cleanup-mode.registrations.json',
  'wrangler.toml',
  'workers/draft-validation/wrangler.toml',
  'workers/draft-validation/d1c4-activation-states.json',
])

export function assertExactProtectedConfigurationPaths(paths) {
  if (!Array.isArray(paths)
    || new Set(paths).size !== paths.length
    || JSON.stringify([...paths].sort()) !== JSON.stringify([...PROTECTED_CONFIGURATION_PATHS].sort())) {
    throw localError('Protected configuration path inventory is missing, duplicated, or unexpected.', 'local.protected-inventory')
  }
  return Object.freeze([...paths])
}
