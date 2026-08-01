import { immutablePlain } from './canonical.mjs'

function fail(message) {
  throw new TypeError(`Wrangler topology validation refused: ${message}`)
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields must be exactly ${wanted.join(', ') || '(empty)'}.`)
  }
}

function exactValue(value, expected, label) {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} differs from the exact reviewed local topology.`)
  }
}

function parseValue(source, label) {
  if (source.startsWith('"')) {
    let value
    try {
      value = JSON.parse(source)
    } catch {
      fail(`${label} contains an unsupported string value.`)
    }
    if (typeof value !== 'string') fail(`${label} must be a string.`)
    return value
  }
  if (source === 'true') return true
  if (source === 'false') return false
  if (/^(?:0|[1-9][0-9]*)$/u.test(source)) return Number(source)
  if (source.startsWith('[') && source.endsWith(']')) {
    let value
    try {
      value = JSON.parse(source)
    } catch {
      fail(`${label} contains an unsupported array value.`)
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      fail(`${label} supports only a literal string array.`)
    }
    return value
  }
  fail(`${label} contains an unsupported TOML value or deploy-relevant construct.`)
}

function parseStrictToml(source, label) {
  if (typeof source !== 'string' || source.length === 0 || source.charCodeAt(0) === 0xFEFF) {
    fail(`${label} must be non-empty UTF-8 without a BOM.`)
  }
  const result = {
    top: {},
    tables: {},
    arrays: {},
  }
  let current = result.top
  let currentLabel = 'top level'
  let currentArrayPath = null

  for (const [index, originalLine] of source.split('\n').entries()) {
    const line = originalLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const arrayHeading = line.match(/^\[\[([a-z][a-z0-9_.-]*)\]\]$/u)
    if (arrayHeading) {
      const path = arrayHeading[1]
      result.arrays[path] ??= []
      current = {}
      result.arrays[path].push(current)
      currentLabel = `[[${path}]] entry ${result.arrays[path].length}`
      currentArrayPath = path
      continue
    }
    const tableHeading = line.match(/^\[([a-z][a-z0-9_.-]*)\]$/u)
    if (tableHeading) {
      const path = tableHeading[1]
      if (path.endsWith('.simple')) {
        const arrayPath = path.slice(0, -'.simple'.length)
        const parent = result.arrays[arrayPath]?.at(-1)
        if (!parent || currentArrayPath !== arrayPath || Object.hasOwn(parent, 'simple')) {
          fail(`[${path}] must occur exactly once after each corresponding array entry.`)
        }
        current = {}
        parent.simple = current
      } else {
        if (Object.hasOwn(result.tables, path)) fail(`[${path}] is duplicated.`)
        current = {}
        result.tables[path] = current
      }
      currentLabel = `[${path}]`
      currentArrayPath = null
      continue
    }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/u)
    if (!assignment) {
      fail(`${label} line ${index + 1} is malformed or unsupported.`)
    }
    const [, key, rawValue] = assignment
    if (Object.hasOwn(current, key)) fail(`${currentLabel}.${key} is duplicated.`)
    current[key] = parseValue(rawValue, `${currentLabel}.${key}`)
  }
  return result
}

function exactDocumentShape(document, { top, tables, arrays }, label) {
  exactKeys(document.top, top, `${label} top level`)
  exactKeys(document.tables, tables, `${label} table inventory`)
  exactKeys(document.arrays, arrays, `${label} array-table inventory`)
}

function stringVariables(table, label) {
  const variables = {}
  for (const [name, value] of Object.entries(table)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || typeof value !== 'string') {
      fail(`${label}.${name} must be a plain-text variable.`)
    }
    variables[name] = value
  }
  return variables
}

function exactD1(table, { preview }, label) {
  exactKeys(table, preview
    ? ['binding', 'database_id', 'database_name', 'migrations_dir', 'preview_database_id']
    : ['binding', 'database_id', 'database_name', 'migrations_dir'], label)
  for (const name of Object.keys(table)) {
    if (typeof table[name] !== 'string') fail(`${label}.${name} must be a string.`)
  }
  return table
}

function exactService(table, label) {
  exactKeys(table, ['binding', 'service'], label)
  if (typeof table.binding !== 'string' || typeof table.service !== 'string') {
    fail(`${label} values must be strings.`)
  }
  return table
}

function exactRateLimits(tables, label) {
  if (tables.length !== 2) fail(`${label} must contain exactly two bindings.`)
  return tables.map((table, index) => {
    exactKeys(table, ['name', 'namespace_id', 'simple'], `${label} entry ${index + 1}`)
    exactKeys(table.simple, ['limit', 'period'], `${label} entry ${index + 1}.simple`)
    if (typeof table.name !== 'string' || typeof table.namespace_id !== 'string'
      || !Number.isSafeInteger(table.simple.limit) || !Number.isSafeInteger(table.simple.period)) {
      fail(`${label} entry ${index + 1} is malformed.`)
    }
    return {
      name: table.name,
      namespaceId: table.namespace_id,
      limit: table.simple.limit,
      period: table.simple.period,
    }
  })
}

function assertUniqueBindingNames(bindings, label) {
  const seen = new Set()
  for (const binding of bindings) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(binding)) fail(`${label} binding ${binding} is malformed.`)
    if (seen.has(binding)) fail(`${label} duplicates binding name ${binding} across binding families.`)
    seen.add(binding)
  }
}

function bindingNames(variables, ...families) {
  return [
    ...Object.keys(variables),
    ...families.flat().map((entry) => entry.binding ?? entry.name),
  ]
}

export function inspectPagesWranglerTopology(source) {
  const document = parseStrictToml(source, 'Pages Wrangler configuration')
  exactDocumentShape(document, {
    top: ['compatibility_date', 'name', 'pages_build_output_dir'],
    tables: ['env.production', 'env.production.vars', 'vars'],
    arrays: [
      'd1_databases', 'env.production.d1_databases',
      'env.production.services', 'services',
    ],
  }, 'Pages Wrangler configuration')
  exactKeys(document.tables['env.production'], [], '[env.production]')
  if (document.arrays.d1_databases.length !== 1
    || document.arrays['env.production.d1_databases'].length !== 1
    || document.arrays.services.length !== 1
    || document.arrays['env.production.services'].length !== 1) {
    fail('Pages must contain exactly one D1 and one service binding per environment.')
  }
  const previewVariables = stringVariables(document.tables.vars, '[vars]')
  const productionVariables = stringVariables(document.tables['env.production.vars'], '[env.production.vars]')
  const previewD1 = exactD1(document.arrays.d1_databases[0], { preview: true }, 'Preview Pages D1')
  const productionD1 = exactD1(
    document.arrays['env.production.d1_databases'][0],
    { preview: false },
    'Production Pages D1',
  )
  const previewService = exactService(document.arrays.services[0], 'Preview Pages service')
  const productionService = exactService(
    document.arrays['env.production.services'][0],
    'Production Pages service',
  )
  assertUniqueBindingNames(
    bindingNames(previewVariables, previewD1, previewService),
    'Preview Pages',
  )
  assertUniqueBindingNames(
    bindingNames(productionVariables, productionD1, productionService),
    'Production Pages',
  )
  if (typeof document.top.name !== 'string'
    || typeof document.top.pages_build_output_dir !== 'string'
    || typeof document.top.compatibility_date !== 'string') {
    fail('Pages top-level identity and build settings must be strings.')
  }
  exactValue({
    compatibilityDate: document.top.compatibility_date,
    buildOutputDirectory: document.top.pages_build_output_dir,
    projectName: document.top.name,
    previewD1,
    previewService,
    productionD1,
    productionService,
  }, {
    compatibilityDate: '2026-07-14',
    buildOutputDirectory: 'dist',
    projectName: 'diamond-draft',
    previewD1: {
      binding: 'DB',
      database_name: 'pennant-pursuit-preview',
      database_id: 'ba6255b4-9425-4863-b10f-79149180f75a',
      preview_database_id: 'DB',
      migrations_dir: 'migrations',
    },
    previewService: {
      binding: 'VALIDATION_SERVICE',
      service: 'pennant-pursuit-validation-preview',
    },
    productionD1: {
      binding: 'DB',
      database_name: 'pennant-pursuit-production',
      database_id: '4b821c17-b88b-462d-a2ed-c6a2113cc362',
      migrations_dir: 'migrations',
    },
    productionService: {
      binding: 'VALIDATION_SERVICE',
      service: 'pennant-pursuit-validation-production',
    },
  }, 'Pages identity, build, D1, and service configuration')
  return immutablePlain({
    kind: 'pages',
    projectName: document.top.name,
    compatibilityDate: document.top.compatibility_date,
    buildOutputDirectory: document.top.pages_build_output_dir,
    environments: {
      preview: {
        variables: previewVariables,
        d1: previewD1,
        service: previewService,
      },
      production: {
        variables: productionVariables,
        d1: productionD1,
        service: productionService,
      },
    },
    schedules: [],
  })
}

export function inspectWorkerWranglerTopology(source) {
  const document = parseStrictToml(source, 'Worker Wrangler configuration')
  exactDocumentShape(document, {
    top: ['compatibility_date', 'main', 'name', 'preview_urls', 'workers_dev'],
    tables: [
      'env.production', 'env.production.triggers', 'env.production.vars',
      'triggers', 'vars',
    ],
    arrays: ['d1_databases', 'env.production.ratelimits', 'ratelimits'],
  }, 'Worker Wrangler configuration')
  exactKeys(document.tables.triggers, ['crons'], '[triggers]')
  exactKeys(document.tables['env.production.triggers'], ['crons'], '[env.production.triggers]')
  exactKeys(document.tables['env.production'], ['name', 'preview_urls', 'workers_dev'], '[env.production]')
  if (document.arrays.d1_databases.length !== 1) fail('Preview Worker must contain exactly one D1 binding.')

  const previewVariables = stringVariables(document.tables.vars, '[vars]')
  const productionVariables = stringVariables(document.tables['env.production.vars'], '[env.production.vars]')
  const previewD1 = exactD1(document.arrays.d1_databases[0], { preview: true }, 'Preview Worker D1')
  const previewRates = exactRateLimits(document.arrays.ratelimits, 'Preview Worker rate limits')
  const productionRates = exactRateLimits(
    document.arrays['env.production.ratelimits'],
    'Production Worker rate limits',
  )
  assertUniqueBindingNames(
    bindingNames(previewVariables, previewD1, previewRates),
    'Preview Worker',
  )
  assertUniqueBindingNames(
    bindingNames(productionVariables, productionRates),
    'Production Worker',
  )
  if (typeof document.top.name !== 'string' || typeof document.top.main !== 'string'
    || typeof document.top.compatibility_date !== 'string'
    || typeof document.top.workers_dev !== 'boolean'
    || typeof document.top.preview_urls !== 'boolean'
    || typeof document.tables['env.production'].name !== 'string'
    || typeof document.tables['env.production'].workers_dev !== 'boolean'
    || typeof document.tables['env.production'].preview_urls !== 'boolean') {
    fail('Worker identity, entry point, compatibility date, and public URL settings are malformed.')
  }
  const previewCrons = document.tables.triggers.crons
  const productionCrons = document.tables['env.production.triggers'].crons
  if (!Array.isArray(previewCrons) || !Array.isArray(productionCrons)) {
    fail('Worker Cron settings must be literal string arrays.')
  }
  exactValue({
    compatibilityDate: document.top.compatibility_date,
    main: document.top.main,
    previewD1,
    previewName: document.top.name,
    previewRates,
    productionName: document.tables['env.production'].name,
    productionRates,
  }, {
    compatibilityDate: '2026-07-14',
    main: 'src/index.ts',
    previewD1: {
      binding: 'DB',
      database_name: 'pennant-pursuit-preview',
      database_id: 'ba6255b4-9425-4863-b10f-79149180f75a',
      preview_database_id: 'DB',
      migrations_dir: '../../migrations',
    },
    previewName: 'pennant-pursuit-validation-preview',
    previewRates: [
      { name: 'RATE_LIMIT_BURST', namespaceId: '16204011', limit: 5, period: 10 },
      { name: 'RATE_LIMIT_SUSTAINED', namespaceId: '16204012', limit: 20, period: 60 },
    ],
    productionName: 'pennant-pursuit-validation-production',
    productionRates: [
      { name: 'RATE_LIMIT_BURST', namespaceId: '16204021', limit: 5, period: 10 },
      { name: 'RATE_LIMIT_SUSTAINED', namespaceId: '16204022', limit: 20, period: 60 },
    ],
  }, 'Worker identity, entry point, D1, and rate-limit configuration')
  return immutablePlain({
    kind: 'worker',
    compatibilityDate: document.top.compatibility_date,
    main: document.top.main,
    environments: {
      preview: {
        name: document.top.name,
        workersDev: document.top.workers_dev,
        previewUrls: document.top.preview_urls,
        routes: [],
        customDomains: [],
        variables: previewVariables,
        d1: previewD1,
        rateLimits: previewRates,
        crons: previewCrons,
      },
      production: {
        name: document.tables['env.production'].name,
        workersDev: document.tables['env.production'].workers_dev,
        previewUrls: document.tables['env.production'].preview_urls,
        routes: [],
        customDomains: [],
        variables: productionVariables,
        d1: null,
        rateLimits: productionRates,
        crons: productionCrons,
      },
    },
  })
}
