import { Buffer as NodeBuffer } from "node:buffer";

const reflectOwnKeys = Reflect.ownKeys;
const reflectApply = Reflect.apply;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const TrustedTypeError = TypeError;
const trustedGlobalThis = globalThis;

const INTEGRITY_FAILURE =
  "Release-inspection intrinsic integrity refused: protected intrinsic descriptors or global bindings differ from trusted startup state.";
const MAX_TRUSTED_TARGETS = 4_096;
const MAX_TRUSTED_OWN_KEYS = 65_536;

// These are the mutable global bindings read by the release-observation graph.
// Imported Node constructors are rooted separately below so the graph also
// protects their prototypes when a runtime exposes a different global alias.
const PROTECTED_GLOBAL_KEYS = [
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "TextDecoder",
  "TypeError",
  "Uint8Array",
  "URL",
  "URLSearchParams",
  "WeakSet",
  "decodeURIComponent",
  "encodeURIComponent",
];

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function captureTrustedGlobalSlots() {
  const slots = new Array(PROTECTED_GLOBAL_KEYS.length);
  for (let index = 0; index < PROTECTED_GLOBAL_KEYS.length; index += 1) {
    const key = PROTECTED_GLOBAL_KEYS[index];
    const descriptor = reflectGetOwnPropertyDescriptor(trustedGlobalThis, key);
    if (!descriptor || !objectHasOwn(descriptor, "value") || !isObjectLike(descriptor.value)) {
      throw new TrustedTypeError(INTEGRITY_FAILURE);
    }
    slots[index] = { key, descriptor };
  }
  return slots;
}

function captureTrustedGraph(globalSlots) {
  const iteratorPrototypes = [
    reflectGetPrototypeOf(reflectApply(Array.prototype[Symbol.iterator], [], [])),
    reflectGetPrototypeOf(reflectApply(String.prototype[Symbol.iterator], "", [])),
    reflectGetPrototypeOf(reflectApply(Set.prototype[Symbol.iterator], new Set(), [])),
    reflectGetPrototypeOf(reflectApply(Map.prototype[Symbol.iterator], new Map(), [])),
  ];
  const queue = [
    ...iteratorPrototypes,
    NodeBuffer,
    reflectApply,
    reflectOwnKeys,
    reflectGetOwnPropertyDescriptor,
    reflectGetPrototypeOf,
    objectHasOwn,
    objectIs,
  ];
  for (let index = 0; index < globalSlots.length; index += 1) {
    queue.push(globalSlots[index].descriptor.value);
  }
  const seen = new WeakSet();
  const records = [];
  let ownKeyCount = 0;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (records.length >= MAX_TRUSTED_TARGETS) {
      throw new TrustedTypeError(INTEGRITY_FAILURE);
    }
    const target = queue[cursor];
    if (seen.has(target)) {
      continue;
    }
    seen.add(target);

    const keys = reflectOwnKeys(target);
    ownKeyCount += keys.length;
    if (ownKeyCount > MAX_TRUSTED_OWN_KEYS) {
      throw new TrustedTypeError(INTEGRITY_FAILURE);
    }
    const descriptors = new Array(keys.length);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = reflectGetOwnPropertyDescriptor(target, keys[index]);
      descriptors[index] = descriptor;
      if (objectHasOwn(descriptor, "value") && isObjectLike(descriptor.value)) {
        queue.push(descriptor.value);
      }
      if (isObjectLike(descriptor.get)) {
        queue.push(descriptor.get);
      }
      if (isObjectLike(descriptor.set)) {
        queue.push(descriptor.set);
      }
    }

    const prototype = reflectGetPrototypeOf(target);
    if (isObjectLike(prototype)) {
      queue.push(prototype);
    }

    records.push({
      target,
      prototype,
      keys,
      descriptors,
    });
  }

  return records;
}

const TRUSTED_GLOBAL_SLOTS = captureTrustedGlobalSlots();
const TRUSTED_GRAPH = captureTrustedGraph(TRUSTED_GLOBAL_SLOTS);

function descriptorsMatch(expected, actual) {
  if (
    expected === undefined ||
    actual === undefined ||
    expected.configurable !== actual.configurable ||
    expected.enumerable !== actual.enumerable
  ) {
    return false;
  }

  const expectedIsData = objectHasOwn(expected, "value");
  const actualIsData = objectHasOwn(actual, "value");
  if (expectedIsData !== actualIsData) {
    return false;
  }

  if (expectedIsData) {
    return expected.writable === actual.writable && objectIs(expected.value, actual.value);
  }

  return objectIs(expected.get, actual.get) && objectIs(expected.set, actual.set);
}

export function assertReleaseInspectionIntrinsicIntegrity() {
  try {
    for (let slotIndex = 0; slotIndex < TRUSTED_GLOBAL_SLOTS.length; slotIndex += 1) {
      const trusted = TRUSTED_GLOBAL_SLOTS[slotIndex];
      const current = reflectGetOwnPropertyDescriptor(trustedGlobalThis, trusted.key);
      if (!descriptorsMatch(trusted.descriptor, current)) {
        throw new TrustedTypeError(INTEGRITY_FAILURE);
      }
    }

    if (TRUSTED_GRAPH.length > MAX_TRUSTED_TARGETS) {
      throw new TrustedTypeError(INTEGRITY_FAILURE);
    }
    for (let recordIndex = 0; recordIndex < TRUSTED_GRAPH.length; recordIndex += 1) {
      const trusted = TRUSTED_GRAPH[recordIndex];
      if (!objectIs(reflectGetPrototypeOf(trusted.target), trusted.prototype)) {
        throw new TrustedTypeError(INTEGRITY_FAILURE);
      }

      const currentKeys = reflectOwnKeys(trusted.target);
      if (currentKeys.length !== trusted.keys.length) {
        throw new TrustedTypeError(INTEGRITY_FAILURE);
      }

      for (let keyIndex = 0; keyIndex < trusted.keys.length; keyIndex += 1) {
        let keyFound = false;
        for (let currentIndex = 0; currentIndex < currentKeys.length; currentIndex += 1) {
          if (objectIs(currentKeys[currentIndex], trusted.keys[keyIndex])) {
            keyFound = true;
            break;
          }
        }
        if (!keyFound) {
          throw new TrustedTypeError(INTEGRITY_FAILURE);
        }
        const currentDescriptor = reflectGetOwnPropertyDescriptor(
          trusted.target,
          trusted.keys[keyIndex],
        );
        if (!descriptorsMatch(trusted.descriptors[keyIndex], currentDescriptor)) {
          throw new TrustedTypeError(INTEGRITY_FAILURE);
        }
      }
    }
  } catch {
    throw new TrustedTypeError(INTEGRITY_FAILURE);
  }
}
