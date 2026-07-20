import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'

export const D1C4_PREVIEW_ACKNOWLEDGEMENT = 'D1C4_PREVIEW_ONLY'

declare const validatedPreviewTargetBrand: unique symbol

export interface PreviewSmokeTarget {
  readonly previewBaseUrl: string
  readonly previewWorker: string
  readonly previewEnvironment: string
  readonly accountId: string
  readonly databaseId: string
  readonly acknowledgement: string
}

export interface ValidatedPreviewSmokeTarget extends PreviewSmokeTarget {
  readonly [validatedPreviewTargetBrand]: true
}

const validatedPreviewTargets = new WeakSet<object>()

export interface ConfiguredPreviewIdentities {
  readonly pagesProject: string
  readonly previewWorker: string
  readonly productionWorker: string
  readonly previewDatabaseId: string
  readonly productionDatabaseId: string
}

function fail(message: string): never {
  throw new Error(message)
}

function oneMatch(source: string, pattern: RegExp, description: string) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1 || typeof matches[0][1] !== 'string') fail(`Expected exactly one configured ${description}.`)
  return matches[0][1]
}

function beforeProduction(source: string) {
  const marker = '\n[env.production]'
  const index = source.indexOf(marker)
  if (index < 0) fail('Expected an explicit production configuration boundary.')
  return source.slice(0, index)
}

function productionSection(source: string) {
  const marker = '\n[env.production]'
  const index = source.indexOf(marker)
  if (index < 0) fail('Expected an explicit production configuration boundary.')
  return source.slice(index)
}

function topLevelHeader(source: string) {
  const firstSection = source.indexOf('\n[')
  if (firstSection < 0) fail('Expected top-level Wrangler configuration fields.')
  return source.slice(0, firstSection)
}

export function readConfiguredPreviewIdentities(
  repositoryRoot = process.cwd(),
  sources?: Readonly<{ pages: string, worker: string }>,
): ConfiguredPreviewIdentities {
  const pages = sources?.pages ?? readFileSync(path.join(repositoryRoot, 'wrangler.toml'), 'utf8')
  const worker = sources?.worker ?? readFileSync(path.join(repositoryRoot, 'workers/draft-validation/wrangler.toml'), 'utf8')
  const pagesPreview = beforeProduction(pages)
  const pagesProduction = productionSection(pages)
  const workerPreview = beforeProduction(worker)
  const workerProduction = productionSection(worker)
  const identities = {
    pagesProject: oneMatch(topLevelHeader(pagesPreview), /^name = "([^"]+)"$/gm, 'Pages project'),
    previewWorker: oneMatch(topLevelHeader(workerPreview), /^name = "([^"]+)"$/gm, 'preview Worker'),
    productionWorker: oneMatch(workerProduction, /^\[env\.production\]\nname = "([^"]+)"$/gm, 'production Worker'),
    previewDatabaseId: oneMatch(pagesPreview, /^database_id = "([0-9a-f-]+)"$/gm, 'preview D1 database ID'),
    productionDatabaseId: oneMatch(pagesProduction, /^database_id = "([0-9a-f-]+)"$/gm, 'production D1 database ID'),
  }
  if (identities.previewWorker === identities.productionWorker) fail('Preview and production Workers must differ.')
  if (identities.previewDatabaseId === identities.productionDatabaseId) fail('Preview and production D1 database IDs must differ.')
  return Object.freeze(identities)
}

function validatePreviewUrl(value: string, pagesProject: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    fail('Preview base URL must be an absolute HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    fail('Preview base URL must be a credential-free HTTPS origin.')
  }
  if (url.pathname !== '/' && url.pathname !== '') fail('Preview base URL must not include a path.')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(hostname) !== 0) {
    fail('Localhost and IP targets are not allowed by the remote smoke harnesses.')
  }
  const productionPagesHostname = `${pagesProject}.pages.dev`.toLowerCase()
  const previewSuffix = `.${productionPagesHostname}`
  if (hostname === productionPagesHostname) fail('The production Pages domain is forbidden.')
  if (!hostname.endsWith(previewSuffix)) {
    fail('Preview base URL must be an unambiguous branch deployment on the configured Pages project.')
  }
  const branchLabel = hostname.slice(0, -previewSuffix.length)
  if (!branchLabel || /(?:^|[.-])(?:main|master|prod|production|live)(?:[.-]|$)/i.test(branchLabel)) {
    fail('Production-like Pages deployment labels are forbidden.')
  }
  return url.origin
}

export function validatePreviewSmokeTarget(
  target: PreviewSmokeTarget,
  identities = readConfiguredPreviewIdentities(),
): ValidatedPreviewSmokeTarget {
  for (const [name, value] of Object.entries(target)) {
    if (typeof value !== 'string' || value.length === 0) fail(`Missing required preview target input: ${name}.`)
  }
  const origin = validatePreviewUrl(target.previewBaseUrl, identities.pagesProject)
  if (target.previewWorker === identities.productionWorker || /(?:^|-)prod(?:uction)?(?:-|$)/i.test(target.previewWorker)) {
    fail('Production Worker targets are forbidden.')
  }
  if (target.previewWorker !== identities.previewWorker) fail('Preview Worker does not match the checked-in preview target.')
  if (target.previewEnvironment !== 'preview' || /^(?:prod|production|live)$/i.test(target.previewEnvironment)) {
    fail('Preview environment must be exactly preview.')
  }
  if (!/^[0-9a-f]{32}$/i.test(target.accountId)) fail('Cloudflare account ID must be exactly 32 hexadecimal characters.')
  if (target.databaseId === identities.productionDatabaseId) fail('Production D1 database targets are forbidden.')
  if (target.databaseId !== identities.previewDatabaseId) fail('D1 database ID does not match the checked-in preview binding.')
  if (target.acknowledgement !== D1C4_PREVIEW_ACKNOWLEDGEMENT) {
    fail(`Acknowledgement must be exactly ${D1C4_PREVIEW_ACKNOWLEDGEMENT}.`)
  }
  const validated = Object.freeze({ ...target, previewBaseUrl: origin }) as ValidatedPreviewSmokeTarget
  validatedPreviewTargets.add(validated)
  return validated
}

export function assertValidatedPreviewSmokeTarget(
  target: ValidatedPreviewSmokeTarget,
): asserts target is ValidatedPreviewSmokeTarget {
  if (!validatedPreviewTargets.has(target)) fail('D1C.4 target was not created by the preview target guard.')
}

export function parseStrictArguments(
  argv: readonly string[],
  valueOptions: readonly string[],
  booleanOptions: readonly string[] = ['execute', 'help'],
) {
  const values: Record<string, string | boolean> = {}
  const allowedValues = new Set(valueOptions.map((option) => `--${option}`))
  const allowedBooleans = new Set(booleanOptions.map((option) => `--${option}`))
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (allowedBooleans.has(argument)) {
      const key = argument.slice(2)
      if (key in values) fail(`Duplicate argument: ${argument}.`)
      values[key] = true
      continue
    }
    if (!allowedValues.has(argument)) fail(`Unknown argument: ${argument}.`)
    const key = argument.slice(2)
    const next = argv[index + 1]
    if (key in values || !next || next.startsWith('--')) fail(`Expected one value after ${argument}.`)
    values[key] = next
    index += 1
  }
  return Object.freeze(values)
}

export function commonTargetFromArguments(arguments_: Readonly<Record<string, string | boolean>>): PreviewSmokeTarget {
  return {
    previewBaseUrl: typeof arguments_['preview-base-url'] === 'string' ? arguments_['preview-base-url'] : '',
    previewWorker: typeof arguments_['preview-worker'] === 'string' ? arguments_['preview-worker'] : '',
    previewEnvironment: typeof arguments_['preview-environment'] === 'string' ? arguments_['preview-environment'] : '',
    accountId: typeof arguments_['account-id'] === 'string' ? arguments_['account-id'] : '',
    databaseId: typeof arguments_['database-id'] === 'string' ? arguments_['database-id'] : '',
    acknowledgement: typeof arguments_.ack === 'string' ? arguments_.ack : '',
  }
}

export function requirePreviewApiToken(environment: NodeJS.ProcessEnv = process.env) {
  const token = environment.CLOUDFLARE_API_TOKEN
  if (typeof token !== 'string' || token.length === 0) fail('Set CLOUDFLARE_API_TOKEN only in the environment before --execute.')
  return token
}
