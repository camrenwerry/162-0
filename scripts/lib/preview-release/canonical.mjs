import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function clonePlain(value, trail = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot encode a non-finite number.')
    return value
  }
  if (Array.isArray(value)) {
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
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Canonical JSON requires a plain object at ${trail}.`)
    const clone = {}
    for (const key of Object.keys(value).sort()) {
      if (DANGEROUS_KEYS.has(key)) throw new TypeError(`Canonical JSON prohibits dangerous key ${key} at ${trail}.`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.get || descriptor.set) throw new TypeError(`Canonical JSON prohibits accessors at ${trail}.${key}.`)
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
