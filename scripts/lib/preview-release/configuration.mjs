import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  materializeActivationState,
  validateAllActivationStates,
} from '../../prepare-d1c4-activation.mjs'
import { canonicalHash, sha256 } from './canonical.mjs'
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

function section(source, heading) {
  const marker = `[${heading}]\n`
  const start = source.indexOf(marker)
  assert(start >= 0 && source.indexOf(marker, start + marker.length) < 0, `Expected exactly one [${heading}] section.`)
  const bodyStart = start + marker.length
  const next = source.indexOf('\n[', bodyStart)
  return source.slice(bodyStart, next < 0 ? source.length : next + 1)
}

function exactString(source, pattern, expected, description) {
  const matches = [...source.matchAll(pattern)]
  assert(matches.length === 1 && matches[0][1] === expected, `${description} must be exactly ${expected}.`)
}

function assertManifestMatchesSources(manifest, pagesSource, workerSource, activationSource) {
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

  let activation
  try {
    activation = JSON.parse(activationSource)
  } catch {
    throw localError('Activation-state source is malformed JSON.', 'configuration.activation')
  }
  assert(activation.cleanupCron === manifest.activation.cleanupCron, 'Activation Cron differs from the reviewed release manifest.')
  assert(JSON.stringify(Object.keys(activation.states)) === JSON.stringify(manifest.activation.allowedStates), 'Activation states differ from the reviewed release manifest.')
}

function assertStateModes(stateName, pagesConfig, workerConfig, approvedCron) {
  const expectedMode = stateName === 'disabled' ? 'disabled' : 'enabled'
  for (const [label, config] of [['Pages', pagesConfig], ['Worker', workerConfig]]) {
    const vars = section(config, 'vars')
    exactString(vars, /^DRAFT_SUBMISSION_MODE = "([^"]+)"$/gm, expectedMode, `${label} submission gate`)
    exactString(vars, /^DRAFT_VALIDATION_MODE = "([^"]+)"$/gm, 'enabled', `${label} validation gate`)
    exactString(vars, /^DRAFT_TICKET_MODE = "([^"]+)"$/gm, 'enabled', `${label} ticket gate`)
  }
  assert(!/^\[triggers\]$/m.test(pagesConfig), 'Pages Preview material must not contain Cron configuration.')
  const triggers = section(workerConfig, 'triggers')
  const expectedCrons = stateName === 'cron-enabled' ? `[${JSON.stringify(approvedCron)}]` : '[]'
  exactString(triggers, /^crons = (\[.*\])$/gm, expectedCrons, 'Worker Cron list')
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

export function compilePreviewState(repositoryRoot, manifest, stateName, {
  sources,
  activationInputs,
} = {}) {
  if (!manifest.activation.allowedStates.includes(stateName)) {
    throw localError(`Unknown Preview activation state: ${stateName ?? '<missing>'}.`, 'configuration.activation-state')
  }
  const pagesSource = sources?.pages ?? readFileSync(path.join(repositoryRoot, manifest.configuration.pages), 'utf8')
  const workerSource = sources?.worker ?? readFileSync(path.join(repositoryRoot, manifest.configuration.worker), 'utf8')
  const activationSource = sources?.activation ?? readFileSync(path.join(repositoryRoot, manifest.configuration.activationStates), 'utf8')
  assertManifestMatchesSources(manifest, pagesSource, workerSource, activationSource)

  const inputs = activationInputs ?? {
    pagesConfig: pagesSource,
    workerConfig: workerSource,
    manifest: JSON.parse(activationSource),
  }
  validateAllActivationStates(inputs)
  const generated = materializeActivationState(stateName, inputs)
  const pagesConfig = beforeProductionSection(generated.pagesConfig, 'Pages configuration')
  const workerConfig = beforeProductionSection(generated.workerConfig, 'Worker configuration')
  assertStateModes(stateName, pagesConfig, workerConfig, manifest.activation.cleanupCron)
  assertNoProductionTargets(manifest, pagesConfig, workerConfig)

  return Object.freeze({
    schemaVersion: 1,
    state: stateName,
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
  const compiled = Object.fromEntries(manifest.activation.allowedStates.map((state) => [
    state,
    compilePreviewState(repositoryRoot, manifest, state, options),
  ]))
  const disabled = compiled.disabled
  const submission = compiled['submission-enabled']
  const cron = compiled['cron-enabled']
  assert(submission.pagesConfig === cron.pagesConfig, 'Cron-enabled must not alter the Pages artifact.')
  const withoutCron = cron.workerConfig.replace(`crons = [${JSON.stringify(manifest.activation.cleanupCron)}]`, 'crons = []')
  assert(withoutCron === submission.workerConfig, 'Submission-enabled and cron-enabled Worker artifacts may differ only by the approved Cron.')
  assert(disabled.workerConfig.includes('main = "src/index.ts"') && submission.workerConfig.includes('main = "src/index.ts"'), 'Every state must use the same reviewed Worker source entry point.')
  return Object.freeze(compiled)
}
