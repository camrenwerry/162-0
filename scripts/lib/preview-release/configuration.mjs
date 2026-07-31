import path from 'node:path'
import { validateProtectedCapabilityFoundation } from '../../prepare-d1c4-activation.mjs'
import {
  canonicalHash,
  readBoundedUtf8File,
  sha256,
  STRICT_JSON_LIMITS,
} from './canonical.mjs'
import { localError, refusalError } from './errors.mjs'
import { productionDenylist } from './manifest.mjs'

function assert(condition, message, checkId = 'configuration.invariants') {
  if (!condition) throw localError(message, checkId)
}

function beforeProductionSection(source, label) {
  const marker = '\n[env.production]\n'
  const first = source.indexOf(marker)
  assert(first >= 0 && source.indexOf(marker, first + marker.length) < 0, `${label} must contain exactly one [env.production] section.`)
  const previewOnly = `${source.slice(0, first).trimEnd()}\n`
  assert(!/\[env\.production(?:\.|\])/.test(previewOnly), `${label} Preview material contains a Production target section.`)
  return previewOnly
}

function exactString(source, pattern, expected, description) {
  const matches = [...source.matchAll(pattern)]
  assert(matches.length === 1 && matches[0][1] === expected, `${description} must be exactly ${expected}.`)
}

function assertManifestMatchesSources(manifest, pagesSource, workerSource) {
  const preview = manifest.cloudflare.preview
  const production = manifest.cloudflare.production
  exactString(pagesSource, /^name = "([^"]+)"$/gm, preview.pages.project, 'Pages project')

  for (const value of [preview.d1.name, preview.d1.id, preview.worker.serviceBinding.service]) {
    assert(pagesSource.includes(`"${value}"`), `Pages configuration is missing reviewed Preview identity ${value}.`)
  }
  for (const value of [production.d1.name, production.d1.id, production.worker.serviceBinding.service]) {
    assert(pagesSource.includes(`"${value}"`), `Pages configuration is missing reviewed Production identity ${value}.`)
  }

  assert(workerSource.startsWith(`name = "${preview.worker.name}"\n`), 'Preview Worker name does not match the reviewed manifest.')
  assert(workerSource.includes(`[env.production]\nname = "${production.worker.name}"`), 'Production Worker name does not match the reviewed manifest.')
  for (const value of [preview.d1.name, preview.d1.id, ...preview.worker.rateLimitNamespaces, ...production.worker.rateLimitNamespaces]) {
    assert(workerSource.includes(`"${value}"`), `Worker configuration is missing reviewed identity ${value}.`)
  }
  const productionWorker = workerSource.slice(workerSource.indexOf('\n[env.production]\n'))
  assert(!productionWorker.includes('[[env.production.d1_databases]]'), 'Production Worker must not have a D1 binding.')
  assert(!productionWorker.includes(preview.d1.id) && !productionWorker.includes(preview.d1.name), 'Production Worker contains a Preview D1 identity.')
  assert(/^workers_dev = false$/m.test(workerSource) && /^preview_urls = false$/m.test(workerSource), 'Preview Worker public URLs must be disabled.')
  assert(/^workers_dev = false$/m.test(productionWorker) && /^preview_urls = false$/m.test(productionWorker), 'Production Worker public URLs must be disabled.')
}

function assertNoProductionTargets(manifest, pagesConfig, workerConfig) {
  const combined = `${pagesConfig}\n${workerConfig}`
  for (const identifier of productionDenylist(manifest)) {
    if (combined.includes(identifier)) {
      throw refusalError(`Preview-generated deployment material contains prohibited Production identity ${identifier}.`, 'configuration.production-collision')
    }
  }
  assert(!combined.includes('[env.production]'), 'Preview-generated deployment material contains a Production target section.')
}

export function compilePreviewState(repositoryRoot, manifest, stateName, { sources } = {}) {
  if (manifest.activation.releaseTooling !== 'disabled-only' || stateName !== 'disabled') {
    throw localError('Preview release configuration is disabled-only until Milestone 3D-2.', 'configuration.activation-state')
  }
  const pagesSource = sources?.pages ?? readBoundedUtf8File(
    path.join(repositoryRoot, manifest.configuration.pages),
    { label: 'Pages configuration', maxBytes: STRICT_JSON_LIMITS.releaseManifest.maxBytes },
  )
  const workerSource = sources?.worker ?? readBoundedUtf8File(
    path.join(repositoryRoot, manifest.configuration.worker),
    { label: 'Worker configuration', maxBytes: STRICT_JSON_LIMITS.releaseManifest.maxBytes },
  )
  const capabilityModelSource = sources?.capabilityModel
    ?? sources?.activation
    ?? readBoundedUtf8File(path.join(repositoryRoot, manifest.configuration.capabilityModel), {
      label: 'Schema-4 capability model',
      maxBytes: STRICT_JSON_LIMITS.authorityModel.maxBytes,
    })
  assertManifestMatchesSources(manifest, pagesSource, workerSource)
  validateProtectedCapabilityFoundation({ capabilityModelSource, pagesConfig: pagesSource, workerConfig: workerSource }, {
    repositoryRoot,
  })
  const pagesConfig = beforeProductionSection(pagesSource, 'Pages configuration')
  const workerConfig = beforeProductionSection(workerSource, 'Worker configuration')
  assertNoProductionTargets(manifest, pagesConfig, workerConfig)

  return Object.freeze({
    schemaVersion: 2,
    state: 'disabled',
    previewOnly: true,
    pagesConfig,
    workerConfig,
    hashes: Object.freeze({
      pages: sha256(pagesConfig),
      worker: sha256(workerConfig),
      combined: canonicalHash({ pagesConfig, workerConfig }),
    }),
  })
}

export function validateConfigurationModel(repositoryRoot, manifest, options = {}) {
  return Object.freeze({
    disabled: compilePreviewState(repositoryRoot, manifest, 'disabled', options),
  })
}
