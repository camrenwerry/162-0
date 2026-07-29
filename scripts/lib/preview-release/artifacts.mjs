import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { canonicalHash, canonicalJson, immutablePlain } from './canonical.mjs'
import { localError, refusalError } from './errors.mjs'
import { assertExecutionContract } from './execution-contract.mjs'
import { derivePlanId } from './plan.mjs'

export const RELEASE_PACKAGE_SCHEMA_VERSION = 1
export const RELEASE_PACKAGE_KIND = 'pennant-pursuit-preview-release-package'
export const RELEASE_PACKAGE_TTL_MS = 2 * 60 * 60 * 1_000
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024

function canonicalTimestamp(milliseconds, label) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw localError(`${label} is not a safe timestamp.`, 'artifact.timestamp')
  }
  return new Date(milliseconds).toISOString()
}

function planIdentityIsValid(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return false
  const { planId, ...withoutId } = plan
  return typeof planId === 'string' && derivePlanId(withoutId) === planId
}

export function createReleasePackage(planInput, {
  nowMs = Date.now(),
  ttlMs = RELEASE_PACKAGE_TTL_MS,
} = {}) {
  const plan = immutablePlain(planInput)
  if (!planIdentityIsValid(plan)) throw localError('Release plan ID is invalid.', 'artifact.plan-id')
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 15 * 60 * 1_000 || ttlMs > RELEASE_PACKAGE_TTL_MS) {
    throw localError('Release package expiration must be between 15 minutes and two hours.', 'artifact.expiration')
  }
  const createdAt = canonicalTimestamp(nowMs, 'Release package creation time')
  const expiresAt = canonicalTimestamp(nowMs + ttlMs, 'Release package expiration time')
  const planHash = canonicalHash(plan)
  const binding = immutablePlain({
    planId: plan.planId,
    planHash,
    gitHead: plan.gitHead,
    targetState: plan.targetState,
    executionContractHash: canonicalHash(plan.executionContract),
    createdAt,
    expiresAt,
  })
  const bindingHash = canonicalHash(binding)
  const approvalChallenge = `APPROVE ${plan.planId} ${bindingHash.slice(0, 24)} ${plan.targetState}`
  const withoutArtifactHash = immutablePlain({
    schemaVersion: RELEASE_PACKAGE_SCHEMA_VERSION,
    kind: RELEASE_PACKAGE_KIND,
    createdAt,
    expiresAt,
    expirationPolicy: {
      maximumAgeSeconds: ttlMs / 1_000,
      executionMustBeginBeforeExpiration: true,
      regenerationDoesNotConferApproval: true,
    },
    plan,
    planHash,
    bindingHash,
    approval: {
      method: 'interactive-tty-exact-challenge',
      challenge: approvalChallenge,
      inferredFromFile: false,
      inferredFromEnvironment: false,
      inferredFromPriorRun: false,
      inferredFromAutomation: false,
    },
    evidence: {
      schemaVersion: 1,
      protectedConfiguration: plan.hashes.protectedConfiguration,
      dependencyLockHash: plan.hashes.lockfile,
      repositoryTreeHash: plan.hashes.repositoryTree,
      intendedPagesArtifact: plan.hashes.intendedPagesArtifact,
      intendedWorkerArtifact: plan.hashes.intendedWorkerArtifact,
      exactExecutionContractHash: canonicalHash(plan.executionContract),
      noRemoteMutation: true,
      statement: 'Readiness and planning performed no remote mutation.',
    },
  })
  return immutablePlain({
    ...withoutArtifactHash,
    artifactHash: canonicalHash(withoutArtifactHash),
  })
}

export function validateReleasePackage(packageInput, {
  nowMs,
  expectedExecutionContract,
  requireUnexpired = false,
} = {}) {
  const releasePackage = immutablePlain(packageInput)
  if (releasePackage.schemaVersion !== RELEASE_PACKAGE_SCHEMA_VERSION || releasePackage.kind !== RELEASE_PACKAGE_KIND) {
    throw localError('Release package schema or kind is unsupported.', 'artifact.schema')
  }
  if (!planIdentityIsValid(releasePackage.plan)) throw refusalError('Release package contains a tampered plan ID.', 'artifact.plan-id')
  if (releasePackage.planHash !== canonicalHash(releasePackage.plan)) {
    throw refusalError('Release package plan hash does not match its plan.', 'artifact.plan-hash')
  }
  if (releasePackage.bindingHash !== canonicalHash({
    planId: releasePackage.plan.planId,
    planHash: releasePackage.planHash,
    gitHead: releasePackage.plan.gitHead,
    targetState: releasePackage.plan.targetState,
    executionContractHash: canonicalHash(releasePackage.plan.executionContract),
    createdAt: releasePackage.createdAt,
    expiresAt: releasePackage.expiresAt,
  })) throw refusalError('Release package binding hash is invalid.', 'artifact.binding')
  const { artifactHash, ...withoutArtifactHash } = releasePackage
  if (artifactHash !== canonicalHash(withoutArtifactHash)) {
    throw refusalError('Release package was edited after generation.', 'artifact.hash')
  }
  const createdAtMs = Date.parse(releasePackage.createdAt)
  const expiresAtMs = Date.parse(releasePackage.expiresAt)
  const maximumAgeMs = releasePackage.expirationPolicy?.maximumAgeSeconds * 1_000
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)
    || !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 15 * 60 * 1_000
    || maximumAgeMs > RELEASE_PACKAGE_TTL_MS || expiresAtMs - createdAtMs !== maximumAgeMs) {
    throw refusalError('Release package expiration metadata is malformed.', 'artifact.expiration')
  }
  const regenerated = createReleasePackage(releasePackage.plan, {
    nowMs: createdAtMs,
    ttlMs: maximumAgeMs,
  })
  if (canonicalJson(regenerated) !== canonicalJson(releasePackage)) {
    throw refusalError('Release package differs from the exact canonical generator output.', 'artifact.generator')
  }
  const expectedChallenge = `APPROVE ${releasePackage.plan.planId} ${releasePackage.bindingHash.slice(0, 24)} ${releasePackage.plan.targetState}`
  if (releasePackage.approval?.method !== 'interactive-tty-exact-challenge'
    || releasePackage.approval.challenge !== expectedChallenge
    || releasePackage.approval.inferredFromFile !== false
    || releasePackage.approval.inferredFromEnvironment !== false
    || releasePackage.approval.inferredFromPriorRun !== false
    || releasePackage.approval.inferredFromAutomation !== false) {
    throw refusalError('Release package approval contract is malformed.', 'artifact.approval')
  }
  if (expectedExecutionContract) assertExecutionContract(releasePackage.plan.executionContract, expectedExecutionContract)
  if (requireUnexpired) {
    const effectiveNow = nowMs ?? Date.now()
    if (!Number.isSafeInteger(effectiveNow) || effectiveNow < createdAtMs || effectiveNow >= expiresAtMs) {
      throw refusalError('Release package is stale or expired; generate a new plan and obtain new approval.', 'artifact.expiration')
    }
  }
  return releasePackage
}

export function serializeReleaseArtifact(value) {
  return `${canonicalJson(value)}\n`
}

function assertSafeDirectory(directory) {
  try {
    const status = lstatSync(directory)
    if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o022) !== 0) {
      throw refusalError('Release artifact directory must be a private real directory.', 'artifact.path')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  return realpathSync(directory)
}

export function writeReleasePackage(repositoryRoot, releasePackage, {
  outputDirectory = path.join(repositoryRoot, '.preview-release'),
} = {}) {
  const validated = validateReleasePackage(releasePackage)
  const actualRoot = realpathSync(repositoryRoot)
  const actualDirectory = assertSafeDirectory(outputDirectory)
  const expectedDirectory = path.join(actualRoot, '.preview-release')
  if (actualDirectory !== expectedDirectory) {
    throw refusalError('Release packages may be written only to the repository .preview-release directory.', 'artifact.path')
  }
  const timestamp = validated.createdAt.replaceAll(':', '').replaceAll('-', '').replace('.000Z', 'Z')
  const filePath = path.join(actualDirectory, `${timestamp}-${validated.plan.planId}.json`)
  writeFileSync(filePath, serializeReleaseArtifact(validated), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return filePath
}

export function loadReleasePackage(filePath, options = {}) {
  const status = lstatSync(filePath)
  if (!status.isFile() || status.isSymbolicLink() || (status.mode & 0o022) !== 0 || status.size > MAX_PACKAGE_BYTES) {
    throw refusalError('Release package must be a bounded, non-writable regular file.', 'artifact.path')
  }
  const source = readFileSync(filePath, 'utf8')
  if (source.startsWith('\uFEFF') || Buffer.byteLength(source) > MAX_PACKAGE_BYTES) {
    throw refusalError('Release package encoding or size is invalid.', 'artifact.encoding')
  }
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch {
    throw localError('Release package is not valid JSON.', 'artifact.json')
  }
  const canonicalSource = serializeReleaseArtifact(parsed)
  if (source !== canonicalSource) {
    throw refusalError('Release package is not exact canonical JSON; edited packages are rejected.', 'artifact.canonical')
  }
  return validateReleasePackage(parsed, options)
}
