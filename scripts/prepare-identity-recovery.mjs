import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDENTITY_RECOVERY_AUTHORITY_MAX_FILE_BYTES,
  IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES,
  IdentityRecoveryPreparationError,
  prepareIdentityRecoveryPreview,
} from './lib/identity-recovery-preparation.mjs'

const MAX_INPUT_PATH_CHARACTERS = 4_096
const MAX_JSON_KEY_CHARACTERS = 64
const MAX_JSON_STRING_CHARACTERS = 128
const MAX_JSON_DEPTH = 16
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const BLOCKED_EXECUTION_ARGUMENTS = new Set(['--execute', '--confirm', '--plan-file'])

function fail(code, message) {
  throw new IdentityRecoveryPreparationError(code, message)
}

function parseArguments(argv) {
  if (argv.some((argument) => (
    BLOCKED_EXECUTION_ARGUMENTS.has(argument)
    || [...BLOCKED_EXECUTION_ARGUMENTS].some((blocked) => argument.startsWith(`${blocked}=`))
  ))) {
    fail(
      'remote_execution_blocked',
      'Identity recovery preparation is structurally read-only; execution and plan consumption are unavailable.',
    )
  }
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--authority-file', '--snapshot-file', '--player-id'].includes(argument)) {
      fail('invalid_arguments', 'Identity recovery preparation arguments are invalid.')
    }
    const key = argument.slice(2).replaceAll('-', '_')
    if (key in parsed) fail('invalid_arguments', 'Identity recovery preparation arguments are duplicated.')
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      fail('invalid_arguments', 'Identity recovery preparation is missing an argument value.')
    }
    parsed[key] = value
    index += 1
  }
  for (const required of ['authority_file', 'snapshot_file', 'player_id']) {
    if (!(required in parsed)) {
      fail('invalid_arguments', 'Identity recovery preparation is missing a required argument.')
    }
  }
  if (!/^[1-9]\d{0,15}$/.test(parsed.player_id)) {
    fail('malformed_target', 'Target player ID is invalid.')
  }
  const targetPlayerId = Number(parsed.player_id)
  if (!Number.isSafeInteger(targetPlayerId)) {
    fail('malformed_target', 'Target player ID is invalid.')
  }
  return Object.freeze({ ...parsed, targetPlayerId })
}

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
}

function readRegularFile(filePath, label, maximumBytes) {
  if (
    typeof filePath !== 'string'
    || filePath.length === 0
    || filePath.length > MAX_INPUT_PATH_CHARACTERS
    || filePath.includes('\0')
  ) fail('unsafe_input_file', `${label} is not a safe regular file.`)
  const resolved = path.resolve(filePath)
  let initial
  try {
    initial = lstatSync(resolved)
  } catch {
    fail('unsafe_input_file', `${label} is missing or is not a safe regular file.`)
  }
  if (initial.isSymbolicLink() || !initial.isFile()) {
    fail('unsafe_input_file', `${label} must be a regular file and must not be a symbolic link.`)
  }
  if (initial.size > maximumBytes) fail('input_too_large', `${label} exceeds its byte limit.`)

  let descriptor
  try {
    descriptor = openSync(
      resolved,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    )
  } catch {
    fail('unsafe_input_file', `${label} could not be opened as a safe regular file.`)
  }
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || !sameFile(initial, before)) {
      fail('input_file_changed', `${label} changed during validation.`)
    }
    if (before.size > maximumBytes) fail('input_too_large', `${label} exceeds its byte limit.`)
    const bytes = Buffer.allocUnsafe(maximumBytes + 1)
    let received = 0
    while (received <= maximumBytes) {
      const count = readSync(
        descriptor,
        bytes,
        received,
        maximumBytes + 1 - received,
        null,
      )
      if (count === 0) break
      received += count
    }
    if (received > maximumBytes) fail('input_too_large', `${label} exceeds its byte limit.`)
    const after = fstatSync(descriptor)
    if (!sameFile(before, after) || received !== before.size) {
      fail('input_file_changed', `${label} changed during validation.`)
    }
    return bytes.subarray(0, received)
  } finally {
    closeSync(descriptor)
  }
}

function hasWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false
    }
  }
  return true
}

function parseStrictJson(bytes, label) {
  if (bytes.length === 0) fail('malformed_json', `${label} is empty or malformed JSON.`)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    fail('malformed_unicode', `${label} uses an unsupported Unicode byte-order mark.`)
  }
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    fail('malformed_unicode', `${label} is not valid UTF-8.`)
  }
  let offset = 0
  const malformed = () => fail('malformed_json', `${label} is malformed JSON.`)
  const whitespace = () => {
    while (/[\u0009\u000A\u000D\u0020]/.test(source[offset] ?? '')) offset += 1
  }

  const string = (maximumLength = MAX_JSON_STRING_CHARACTERS) => {
    if (source[offset] !== '"') malformed()
    const start = offset
    offset += 1
    while (offset < source.length) {
      const character = source[offset]
      if (character === '"') {
        offset += 1
        let value
        try {
          value = JSON.parse(source.slice(start, offset))
        } catch {
          malformed()
        }
        if (
          typeof value !== 'string'
          || value.length > maximumLength
          || !hasWellFormedUnicode(value)
          || value.normalize('NFC') !== value
        ) fail('malformed_unicode', `${label} contains an unsupported or overlong string.`)
        return value
      }
      if (character === '\\') {
        offset += 2
        continue
      }
      if (character.charCodeAt(0) < 0x20) malformed()
      offset += 1
    }
    malformed()
  }

  const value = (depth) => {
    if (depth > MAX_JSON_DEPTH) malformed()
    whitespace()
    const character = source[offset]
    if (character === '"') return string()
    if (character === '{') return object(depth + 1)
    if (character === '[') return array(depth + 1)
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
      if (!Number.isFinite(parsed)) malformed()
      return parsed
    }
    malformed()
  }

  const array = (depth) => {
    offset += 1
    const result = []
    whitespace()
    if (source[offset] === ']') {
      offset += 1
      return result
    }
    while (true) {
      result.push(value(depth))
      whitespace()
      if (source[offset] === ']') {
        offset += 1
        return result
      }
      if (source[offset] !== ',') malformed()
      offset += 1
    }
  }

  const object = (depth) => {
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
      const key = string(MAX_JSON_KEY_CHARACTERS)
      if (DANGEROUS_KEYS.has(key)) fail('malformed_json', `${label} contains a prohibited object key.`)
      if (keys.has(key)) fail('duplicate_json_key', `${label} contains a duplicate object key.`)
      keys.add(key)
      whitespace()
      if (source[offset] !== ':') malformed()
      offset += 1
      Object.defineProperty(result, key, {
        value: value(depth),
        enumerable: true,
        configurable: true,
        writable: true,
      })
      whitespace()
      if (source[offset] === '}') {
        offset += 1
        return result
      }
      if (source[offset] !== ',') malformed()
      offset += 1
    }
  }

  const parsed = value(0)
  whitespace()
  if (offset !== source.length) malformed()
  return parsed
}

function readJson(filePath, label, maximumBytes) {
  return parseStrictJson(readRegularFile(filePath, label, maximumBytes), label)
}

async function identityRecoveryPreparationCli(argv) {
  const parsed = parseArguments(argv)
  const authority = readJson(
    parsed.authority_file,
    'Authority file',
    IDENTITY_RECOVERY_AUTHORITY_MAX_FILE_BYTES,
  )
  const snapshot = readJson(
    parsed.snapshot_file,
    'Snapshot file',
    IDENTITY_RECOVERY_SNAPSHOT_MAX_FILE_BYTES,
  )
  const preview = prepareIdentityRecoveryPreview({
    authority,
    snapshot,
    targetPlayerId: parsed.targetPlayerId,
    nowMs: Date.now(),
  })
  console.log(JSON.stringify(preview, null, 2))
  return 0
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await identityRecoveryPreparationCli(process.argv.slice(2))
  } catch (error) {
    const safe = error instanceof IdentityRecoveryPreparationError
      ? error
      : new IdentityRecoveryPreparationError(
        'preparation_failed',
        'Identity recovery preparation failed.',
      )
    console.error(JSON.stringify({ ok: false, error: { code: safe.code, message: safe.message } }))
    process.exitCode = 1
  }
}
