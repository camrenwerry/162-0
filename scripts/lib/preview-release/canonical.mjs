import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs'
import path from 'node:path'
import { TextDecoder, types as utilTypes } from 'node:util'

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const UTF8_BOM = Buffer.from([0xEF, 0xBB, 0xBF])
export const PREVIEW_RELEASE_TOOL_CONTRACT_VERSION = 'preview-release-disabled-only-v2'
export const PREVIEW_RELEASE_PLAN_SCHEMA_VERSION = 4

export const STRICT_JSON_LIMITS = Object.freeze({
  authorityModel: Object.freeze({ maxBytes: 64 * 1024, maxDepth: 16, maxNodes: 512 }),
  readinessModel: Object.freeze({ maxBytes: 64 * 1024, maxDepth: 16, maxNodes: 1_024 }),
  releaseManifest: Object.freeze({ maxBytes: 128 * 1024, maxDepth: 24, maxNodes: 4_096 }),
  releasePackage: Object.freeze({ maxBytes: 2 * 1024 * 1024, maxDepth: 48, maxNodes: 50_000 }),
  packageMetadata: Object.freeze({ maxBytes: 512 * 1024, maxDepth: 16, maxNodes: 20_000 }),
})

function validLimit(value) {
  return Number.isSafeInteger(value) && value > 0
}

function assertValidUnicode(value, fail, location) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0) {
      fail(`NUL in ${location}.`)
    } else if (code === 0xFFFD) {
      fail(`Unicode replacement character in ${location}.`)
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) fail(`unpaired high surrogate in ${location}.`)
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      fail(`unpaired low surrogate in ${location}.`)
    }
  }
}

function strictJsonError(error, message) {
  throw error(message)
}

export function decodeStrictUtf8(bytes, {
  label = 'UTF-8 input',
  error = (message) => new TypeError(message),
  allowBom = false,
} = {}) {
  if (!(bytes instanceof Uint8Array)) strictJsonError(error, `${label} must be bytes.`)
  if (!allowBom && bytes.length >= UTF8_BOM.length
    && UTF8_BOM.every((byte, index) => bytes[index] === byte)) {
    strictJsonError(error, `${label} must not contain a UTF-8 BOM.`)
  }
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    strictJsonError(error, `${label} must contain valid UTF-8.`)
  }
  if (!allowBom && decoded.startsWith('\uFEFF')) strictJsonError(error, `${label} must not contain a UTF-8 BOM.`)
  if (decoded.includes('\0')) strictJsonError(error, `${label} must not contain NUL.`)
  if (decoded.includes('\uFFFD')) strictJsonError(error, `${label} must not contain the Unicode replacement character.`)
  return decoded
}

export function readBoundedUtf8File(filePath, {
  label = 'UTF-8 file',
  maxBytes,
  error = (message) => new TypeError(message),
  allowBom = false,
} = {}) {
  if (!validLimit(maxBytes)) strictJsonError(error, `${label} byte limit is invalid.`)
  const pathStatus = lstatSync(filePath)
  if (!pathStatus.isFile()) strictJsonError(error, `${label} must be a regular, non-symbolic-link file.`)
  const descriptor = openSync(filePath, 'r')
  try {
    const status = fstatSync(descriptor)
    if (!status.isFile()) strictJsonError(error, `${label} must be a regular file.`)
    if (status.dev !== pathStatus.dev || status.ino !== pathStatus.ino) {
      strictJsonError(error, `${label} changed before it was read.`)
    }
    if (status.size > maxBytes) strictJsonError(error, `${label} exceeds the ${maxBytes}-byte limit.`)
    const bytes = Buffer.allocUnsafe(status.size)
    let total = 0
    while (total < bytes.length) {
      const count = readSync(descriptor, bytes, total, bytes.length - total, total)
      if (count === 0) strictJsonError(error, `${label} changed while it was being read.`)
      total += count
    }
    const extra = Buffer.allocUnsafe(1)
    if (readSync(descriptor, extra, 0, 1, total) !== 0) {
      strictJsonError(error, `${label} changed or exceeded its byte limit while it was being read.`)
    }
    return decodeStrictUtf8(bytes, { label, error, allowBom })
  } finally {
    closeSync(descriptor)
  }
}

export function readStrictJsonFile(filePath, {
  label = 'JSON file',
  error = (message) => new TypeError(message),
  limits,
} = {}) {
  if (!limits) strictJsonError(error, `${label} requires explicit parser limits.`)
  const source = readBoundedUtf8File(filePath, {
    label,
    maxBytes: limits.maxBytes,
    error,
  })
  return Object.freeze({
    source,
    value: parseStrictJson(source, { label, error, limits }),
  })
}

export function readStrictPackageMetadataFile(filePath, {
  label = 'package metadata',
  error = (message) => new TypeError(message),
  requireScripts = false,
  requireLockfile = false,
} = {}) {
  const loaded = readStrictJsonFile(filePath, {
    label,
    error,
    limits: STRICT_JSON_LIMITS.packageMetadata,
  })
  const metadata = immutablePlain(loaded.value)
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || typeof metadata.name !== 'string' || metadata.name.length === 0
    || typeof metadata.version !== 'string' || metadata.version.length === 0) {
    strictJsonError(error, `${label} must be a package metadata object with non-empty name and version strings.`)
  }
  if (requireScripts && (!metadata.scripts || typeof metadata.scripts !== 'object'
    || Array.isArray(metadata.scripts)
    || Object.values(metadata.scripts).some((command) => typeof command !== 'string'))) {
    strictJsonError(error, `${label} must contain an exact string-valued scripts object.`)
  }
  if (requireLockfile && (!Number.isSafeInteger(metadata.lockfileVersion)
    || !metadata.packages || typeof metadata.packages !== 'object'
    || Array.isArray(metadata.packages))) {
    strictJsonError(error, `${label} must contain exact lockfileVersion and packages metadata.`)
  }
  return Object.freeze({ source: loaded.source, value: metadata })
}

export function parseStrictJson(source, {
  label = 'JSON input',
  error = (message) => new TypeError(message),
  limits = STRICT_JSON_LIMITS.releaseManifest,
} = {}) {
  if (typeof source !== 'string') throw error(`${label} must be text.`)
  if (!limits || !validLimit(limits.maxBytes) || !validLimit(limits.maxDepth) || !validLimit(limits.maxNodes)) {
    throw error(`${label} parser limits are invalid.`)
  }
  if (source.startsWith('\uFEFF')) throw error(`${label} must not contain a UTF-8 BOM.`)
  if (source.includes('\0')) throw error(`${label} must not contain NUL.`)
  if (source.includes('\uFFFD')) throw error(`${label} must not contain the Unicode replacement character.`)
  assertValidUnicode(source, (message) => { throw error(`${label} ${message}`) }, 'source text')
  const byteLength = Buffer.byteLength(source, 'utf8')
  if (byteLength > limits.maxBytes) throw error(`${label} exceeds the ${limits.maxBytes}-byte limit.`)
  let offset = 0
  let nodes = 0
  const fail = (message) => { throw error(`${label} is not valid JSON under the strict grammar: ${message}`) }
  const whitespace = () => { while (/[\u0009\u000A\u000D\u0020]/.test(source[offset] ?? '')) offset += 1 }

  const string = () => {
    if (source[offset] !== '"') fail(`expected a string at character ${offset}.`)
    const start = offset
    offset += 1
    while (offset < source.length) {
      const character = source[offset]
      if (character === '"') {
        offset += 1
        let parsed
        try {
          parsed = JSON.parse(source.slice(start, offset))
        } catch {
          fail(`malformed string at character ${start}.`)
        }
        assertValidUnicode(parsed, fail, `string beginning at character ${start}`)
        return parsed
      }
      if (character === '\\') {
        offset += 2
        continue
      }
      if (character.charCodeAt(0) < 0x20) fail(`control character in string at character ${offset}.`)
      offset += 1
    }
    fail(`unterminated string at character ${start}.`)
  }

  const value = (depth) => {
    nodes += 1
    if (nodes > limits.maxNodes) fail(`structural node count exceeds ${limits.maxNodes}.`)
    whitespace()
    const character = source[offset]
    if (character === '"') return string()
    if (character === '{') return object(depth)
    if (character === '[') return array(depth)
    for (const [token, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(token, offset)) {
        offset += token.length
        return parsed
      }
    }
    const number = source.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (number) {
      offset += number[0].length
      const parsed = Number(number[0])
      if (!Number.isFinite(parsed)) fail(`non-finite number at character ${offset - number[0].length}.`)
      return parsed
    }
    fail(`unexpected token at character ${offset}.`)
  }

  const array = (depth) => {
    if (depth > limits.maxDepth) fail(`nesting depth exceeds ${limits.maxDepth}.`)
    offset += 1
    const result = []
    whitespace()
    if (source[offset] === ']') {
      offset += 1
      return result
    }
    while (true) {
      result.push(value(depth + 1))
      whitespace()
      if (source[offset] === ']') {
        offset += 1
        return result
      }
      if (source[offset] !== ',') fail(`expected ',' or ']' at character ${offset}.`)
      offset += 1
    }
  }

  const object = (depth) => {
    if (depth > limits.maxDepth) fail(`nesting depth exceeds ${limits.maxDepth}.`)
    offset += 1
    const result = {}
    const keys = new Set()
    whitespace()
    if (source[offset] === '}') {
      offset += 1
      return result
    }
    while (true) {
      whitespace()
      const key = string()
      if (DANGEROUS_KEYS.has(key)) fail(`dangerous object key ${key} is prohibited.`)
      if (keys.has(key)) fail(`duplicate object key ${key} is prohibited.`)
      keys.add(key)
      whitespace()
      if (source[offset] !== ':') fail(`expected ':' after object key at character ${offset}.`)
      offset += 1
      Object.defineProperty(result, key, {
        value: value(depth + 1), enumerable: true, configurable: true, writable: true,
      })
      whitespace()
      if (source[offset] === '}') {
        offset += 1
        return result
      }
      if (source[offset] !== ',') fail(`expected ',' or '}' at character ${offset}.`)
      offset += 1
    }
  }

  const parsed = value(1)
  whitespace()
  if (offset !== source.length) fail(`trailing content at character ${offset}.`)
  return parsed
}

function clonePlain(value, trail = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot encode a non-finite number.')
    return value
  }
  if (Array.isArray(value)) {
    if (utilTypes.isProxy(value)) throw new TypeError(`Canonical JSON prohibits proxies at ${trail}.`)
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`Canonical JSON requires a plain array at ${trail}.`)
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError(`Canonical JSON prohibits symbol keys at ${trail}.`)
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0 || lengthDescriptor.enumerable || lengthDescriptor.configurable) {
      throw new TypeError(`Canonical JSON requires a standard array length at ${trail}.`)
    }
    const length = lengthDescriptor.value
    const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))])
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
      throw new TypeError(`Canonical JSON prohibits sparse arrays or extra array properties at ${trail}.`)
    }
    const frozen = lengthDescriptor.writable === false
    const clone = new Array(length)
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true
        || descriptor.writable === frozen || descriptor.configurable === frozen) {
        throw new TypeError(`Canonical JSON requires standard data elements at ${trail}[${index}].`)
      }
      clone[index] = clonePlain(descriptor.value, `${trail}[${index}]`)
    }
    return clone
  }
  if (typeof value === 'object') {
    if (utilTypes.isProxy(value)) throw new TypeError(`Canonical JSON prohibits proxies at ${trail}.`)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype) throw new TypeError(`Canonical JSON requires an ordinary plain object at ${trail}.`)
    const clone = {}
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key === 'symbol')) throw new TypeError(`Canonical JSON prohibits symbol keys at ${trail}.`)
    for (const key of ownKeys.map(String).sort()) {
      if (DANGEROUS_KEYS.has(key)) throw new TypeError(`Canonical JSON prohibits dangerous key ${key} at ${trail}.`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
        throw new TypeError(`Canonical JSON prohibits accessors and non-enumerable properties at ${trail}.${key}.`)
      }
      if (descriptor.value === undefined) throw new TypeError(`Canonical JSON cannot encode undefined at ${trail}.${key}.`)
      Object.defineProperty(clone, key, {
        value: clonePlain(descriptor.value, `${trail}.${key}`),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return clone
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`)
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

export function immutablePlain(value) {
  return deepFreeze(clonePlain(value))
}

export function canonicalJson(value) {
  return JSON.stringify(clonePlain(value))
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalHash(value) {
  return sha256(canonicalJson(value))
}

export function fileHash(filePath) {
  return sha256(readFileSync(filePath))
}

export function aggregateFileHash(repositoryRoot, relativePaths) {
  const entries = [...new Set(relativePaths)].sort().map((relativePath) => ({
    path: relativePath,
    sha256: fileHash(path.join(repositoryRoot, relativePath)),
  }))
  return canonicalHash(entries)
}
