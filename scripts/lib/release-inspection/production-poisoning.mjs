import { types as utilTypes } from 'node:util'

const isProxy = utilTypes.isProxy
const TRUSTED_OBJECT_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Object.prototype))
const TRUSTED_ARRAY_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Array.prototype))
const MAX_ENCODING_PASSES = 16
const MAX_GRAPH_DEPTH = 16

function normalizedDecodedVariants(value, fail) {
  const variants = []
  let current = value
  for (let index = 0; index < MAX_ENCODING_PASSES; index += 1) {
    variants.push(current.normalize('NFKC').toLowerCase())
    let decoded
    try {
      decoded = decodeURIComponent(current)
    } catch {
      fail('contains malformed percent encoding.')
    }
    if (decoded === current) return variants
    current = decoded
  }
  try {
    if (decodeURIComponent(current) !== current) fail('exceeds the repeated-encoding bound.')
  } catch {
    fail('contains malformed percent encoding.')
  }
  variants.push(current.normalize('NFKC').toLowerCase())
  return variants
}

function descriptorGraphStrings(input, label, fail) {
  const values = []
  const seen = new Set()
  const visitPrototypeDescriptors = (prototype, depth) => {
    const trustedKeys = prototype === Object.prototype
      ? TRUSTED_OBJECT_PROTOTYPE_KEYS
      : TRUSTED_ARRAY_PROTOTYPE_KEYS
    for (const key of Reflect.ownKeys(prototype)) {
      if (typeof key === 'string') values.push(key)
      const descriptor = Reflect.getOwnPropertyDescriptor(prototype, key)
      if (!descriptor) fail('contains an inherited descriptor failure.')
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        if (!trustedKeys.has(key)) fail('contains an inherited accessor.')
        continue
      }
      if (typeof descriptor.value === 'function') {
        if (!trustedKeys.has(key)) fail('contains an inherited callable value.')
        continue
      }
      visit(descriptor.value, depth + 1)
    }
  }
  const visit = (value, depth) => {
    if (value === null || ['boolean', 'undefined'].includes(typeof value)) return
    if (typeof value === 'number') {
      if (Number.isFinite(value)) values.push(String(value))
      return
    }
    if (typeof value === 'string') {
      values.push(value)
      return
    }
    if (!value || typeof value !== 'object' || isProxy(value)
      || depth > MAX_GRAPH_DEPTH || seen.has(value)) {
      fail('must be non-proxy, acyclic, bounded descriptor data.')
    }
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('must not contain symbol keys.')
      values.push(key)
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        fail('must contain only data properties.')
      }
      visit(descriptor.value, depth + 1)
    }
    const prototype = Reflect.getPrototypeOf(value)
    if (prototype === Object.prototype || prototype === Array.prototype) {
      visitPrototypeDescriptors(prototype, depth + 1)
    } else if (prototype) {
      visit(prototype, depth + 1)
    }
    seen.delete(value)
  }
  visit(input, 0)
  return values
}

export function assertNoProductionPoisoning(input, deniedValues, {
  label = 'Preview identity',
  error = (reason) => new TypeError(`${label} ${reason}`),
} = {}) {
  const fail = (reason) => { throw error(reason) }
  if (!Array.isArray(deniedValues)
    || deniedValues.some((value) => typeof value !== 'string' || value.length === 0)) {
    fail('has an invalid Production deny inventory.')
  }
  const denied = deniedValues.flatMap((value) => normalizedDecodedVariants(value, fail))
  for (const raw of descriptorGraphStrings(input, label, fail)) {
    for (const candidate of normalizedDecodedVariants(raw, fail)) {
      if (denied.some((productionValue) => candidate.includes(productionValue))) {
        fail('contains a prohibited Production identifier.')
      }
    }
  }
  return input
}
