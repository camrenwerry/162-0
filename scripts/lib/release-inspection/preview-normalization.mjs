import { types as utilTypes } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { immutablePlain } from '../preview-release/canonical.mjs'
import {
  loadReleaseManifest,
  productionDenylist,
} from '../preview-release/manifest.mjs'
import { assertNoProductionPoisoning } from './production-poisoning.mjs'
import { REMOTE_OBSERVATION_LIMITS } from './remote-transport.mjs'

const isProxy = utilTypes.isProxy
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PRODUCTION_IDENTIFIERS = productionDenylist(
  loadReleaseManifest(REPOSITORY_ROOT).manifest,
  { includeBranch: true },
)

export class PreviewResourceNormalizationError extends TypeError {
  constructor(operation, state, code) {
    super(`Preview resource normalization refused: ${operation}; ${code}.`)
    this.name = 'PreviewResourceNormalizationError'
    this.operation = operation
    this.state = state
    this.code = code
  }
}

export function normalizationFail(operation, state, code) {
  throw new PreviewResourceNormalizationError(operation, state, code)
}

export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function assertRecordBudget(operation, input, code = 'record-budget-exceeded') {
  if (!Array.isArray(input)) normalizationFail(operation, 'malformed', 'invalid-record-inventory')
  if (input.length > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily) {
    normalizationFail(operation, 'malformed', code)
  }
  return input
}

export function providerPlain(operation, input) {
  try {
    assertNoProductionPoisoning(input, PRODUCTION_IDENTIFIERS, {
      label: `${operation} provider response`,
      error: (reason) => new PreviewResourceNormalizationError(
        operation,
        reason === 'contains a prohibited Production identifier.' ? 'contradictory' : 'malformed',
        reason === 'contains a prohibited Production identifier.'
          ? 'production-poisoning'
          : 'non-plain-provider-data',
      ),
    })
    return immutablePlain(input)
  } catch (error) {
    if (error instanceof PreviewResourceNormalizationError) throw error
    normalizationFail(operation, 'malformed', 'non-plain-provider-data')
  }
}

export function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !isProxy(value)
    && [Object.prototype, null].includes(Reflect.getPrototypeOf(value))
}

export function exactKeys(operation, value, expected, code = 'unsupported-field-inventory') {
  if (!isPlainRecord(value)) normalizationFail(operation, 'malformed', code)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expected.length
    || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) {
    normalizationFail(operation, 'malformed', code)
  }
  return value
}

export function allowedKeys(operation, value, allowed, required = [], code = 'unsupported-field-inventory') {
  if (!isPlainRecord(value)) normalizationFail(operation, 'malformed', code)
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(value, key))) {
    normalizationFail(operation, 'malformed', code)
  }
  return value
}

export function boundedAscii(operation, value, code, pattern, maximum = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || /[^\x20-\x7E]/u.test(value) || !pattern.test(value)) {
    normalizationFail(operation, 'malformed', code)
  }
  return value
}

export function safeIdentity(operation, value, code = 'invalid-safe-identity') {
  return boundedAscii(operation, value, code, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 128)
}

export function normalizedTimestamp(operation, value, code = 'invalid-timestamp') {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    normalizationFail(operation, 'malformed', code)
  }
  const parsed = Date.parse(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || new Date(parsed).toISOString() !== (
    value.length === 20 ? value.replace('Z', '.000Z') : value
  )) normalizationFail(operation, 'malformed', code)
  return parsed
}

export function canonicalCalendarDate(operation, value, code = 'invalid-calendar-date') {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    normalizationFail(operation, 'malformed', code)
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    normalizationFail(operation, 'malformed', code)
  }
  const roundTrip = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (roundTrip !== value) normalizationFail(operation, 'malformed', code)
  return value
}

function validCronField(field, minimum, maximum) {
  if (!/^[0-9*,/-]+$/u.test(field)) return false
  for (const segment of field.split(',')) {
    if (segment.length === 0) return false
    const stepParts = segment.split('/')
    if (stepParts.length > 2 || stepParts.some((part) => part.length === 0)) return false
    const [range, step] = stepParts
    if (step !== undefined) {
      const stepNumber = Number(step)
      if (!/^\d+$/u.test(step) || !Number.isSafeInteger(stepNumber) || stepNumber < 1) return false
    }
    if (range === '*') continue
    const parts = range.split('-')
    if (parts.length > 2 || parts.some((part) => !/^\d+$/u.test(part))) return false
    const numbers = parts.map(Number)
    if (numbers.some((number) => number < minimum || number > maximum)) return false
    if (numbers.length === 2 && numbers[0] > numbers[1]) return false
  }
  return true
}

export function canonicalCronExpression(operation, value, code = 'invalid-cron-expression') {
  if (typeof value !== 'string' || /[^\x20-\x7E]/u.test(value) || value.startsWith('@')) {
    normalizationFail(operation, 'malformed', code)
  }
  const fields = value.split(' ')
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  if (fields.length !== 5 || fields.some((field, index) => !validCronField(
    field,
    ranges[index][0],
    ranges[index][1],
  ))) normalizationFail(operation, 'malformed', code)
  return value
}

export function canonicalHostname(operation, value, code = 'invalid-hostname') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253
    || /[^\x21-\x7E]/u.test(value) || value !== value.toLowerCase()
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) {
    normalizationFail(operation, 'malformed', code)
  }
  return value
}

export function canonicalHttpsOrigin(operation, value, code = 'invalid-preview-origin') {
  let url
  try { url = new URL(value) } catch { normalizationFail(operation, 'malformed', code) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '') || url.port || value !== url.origin) {
    normalizationFail(operation, 'malformed', code)
  }
  canonicalHostname(operation, url.hostname, code)
  return url.origin
}

export function sortedUniqueStrings(operation, input, normalizer, duplicateCode) {
  if (!Array.isArray(input)) normalizationFail(operation, 'malformed', 'invalid-list')
  assertRecordBudget(operation, input)
  const values = input.map((value) => normalizer(value))
  if (new Set(values).size !== values.length) {
    normalizationFail(operation, 'contradictory', duplicateCode)
  }
  return values.sort(compareText)
}

export function paginationInfo(operation, input, expectedPage, recordCount) {
  const info = exactKeys(operation, input, [
    'count', 'page', 'per_page', 'total_count', 'total_pages',
  ], 'invalid-pagination-metadata')
  for (const key of ['count', 'page', 'per_page', 'total_count', 'total_pages']) {
    if (!Number.isSafeInteger(info[key]) || info[key] < 0) {
      normalizationFail(operation, 'malformed', 'invalid-pagination-metadata')
    }
  }
  const emptyFirstPage = expectedPage === 1 && info.count === 0 && info.total_count === 0
    && [0, 1].includes(info.total_pages)
  if (info.page !== expectedPage || info.page < 1 || info.per_page !== 25
    || info.count !== recordCount || info.count > info.per_page
    || info.total_count < info.count || (!emptyFirstPage && info.total_pages < info.page)
    || info.total_pages > REMOTE_OBSERVATION_LIMITS.maximumPaginationPages
    || info.total_count > REMOTE_OBSERVATION_LIMITS.maximumRecordsPerFamily
    || (!emptyFirstPage
      && info.total_pages !== Math.max(1, Math.ceil(info.total_count / info.per_page)))) {
    normalizationFail(operation, 'contradictory', 'contradictory-pagination-metadata')
  }
  return Object.freeze({
    page: info.page,
    perPage: info.per_page,
    totalCount: info.total_count,
    totalPages: emptyFirstPage ? 1 : info.total_pages,
  })
}

export function normalizedValue(kind, fields = {}) {
  return immutablePlain({ kind, schemaVersion: 1, ...fields })
}
