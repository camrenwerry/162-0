/**
 * Deterministic gameplay RNG contract for `seeded-v1`.
 *
 * Seeds have the exact form `seeded-v1:<32 lowercase hex characters>`. The
 * payload is 16 bytes in written order. Each consecutive group of four bytes
 * is interpreted as one unsigned 32-bit big-endian word, so the first eight
 * hex characters initialize state word zero, the next eight word one, and so
 * on. The all-zero state is rejected because it is absorbing for xoshiro128**.
 *
 * xoshiro128** advances four 32-bit words with the reference xor/shift/rotate
 * transition. Each call emits `rotl(s1 * 5, 7) * 9` with 32-bit overflow, then
 * converts that unsigned result to a JavaScript number by dividing by 2^32.
 * Consequently, every call returns a value in [0, 1) and consumes exactly one
 * xoshiro output word.
 *
 * xoshiro128** is suitable for reproducible gameplay, not cryptographic
 * security. Web Crypto is used only to create fresh local seeds and draft IDs;
 * deterministic gameplay after initialization never calls Web Crypto or an
 * ambient nondeterministic random source.
 */

export const SEEDED_RNG_VERSION = 'seeded-v1' as const
export const SEEDED_RNG_ALGORITHM = 'xoshiro128**' as const
export const GAMEPLAY_SEED_PREFIX = 'seeded-v1:' as const
export const GAMEPLAY_SEED_BYTES = 16
export const GAMEPLAY_SEED_HEX_LENGTH = GAMEPLAY_SEED_BYTES * 2

export type SeededRngVersion = typeof SEEDED_RNG_VERSION
export type GameplaySeed = `${typeof GAMEPLAY_SEED_PREFIX}${string}`
export type SeededRandomSource = () => number

const UINT32_RANGE = 0x1_0000_0000
const SEED_PATTERN = /^seeded-v1:([0-9a-f]{32})$/
const ZERO_SEED_PAYLOAD = '0'.repeat(GAMEPLAY_SEED_HEX_LENGTH)

/** Validate an untrusted value and return its canonical gameplay-seed type. */
export function parseGameplaySeed(value: unknown): GameplaySeed {
  if (typeof value !== 'string' || !SEED_PATTERN.test(value)) {
    throw new TypeError('Gameplay seed must match seeded-v1:<32 lowercase hex characters>.')
  }
  if (value.slice(GAMEPLAY_SEED_PREFIX.length) === ZERO_SEED_PAYLOAD) {
    throw new RangeError('Gameplay seed state must not be all zero.')
  }
  return value as GameplaySeed
}

function seedWords(seed: GameplaySeed): [number, number, number, number] {
  const payload = seed.slice(GAMEPLAY_SEED_PREFIX.length)
  return [
    Number.parseInt(payload.slice(0, 8), 16) >>> 0,
    Number.parseInt(payload.slice(8, 16), 16) >>> 0,
    Number.parseInt(payload.slice(16, 24), 16) >>> 0,
    Number.parseInt(payload.slice(24, 32), 16) >>> 0,
  ]
}

function rotateLeft(value: number, distance: number) {
  return ((value << distance) | (value >>> (32 - distance))) >>> 0
}

/** Create a deterministic [0, 1) random source from a strict seeded-v1 seed. */
export function createSeededRandom(seed: string): SeededRandomSource {
  let [state0, state1, state2, state3] = seedWords(parseGameplaySeed(seed))

  return () => {
    const result = Math.imul(rotateLeft(Math.imul(state1, 5) >>> 0, 7), 9) >>> 0
    const shifted = (state1 << 9) >>> 0

    state2 = (state2 ^ state0) >>> 0
    state3 = (state3 ^ state1) >>> 0
    state1 = (state1 ^ state2) >>> 0
    state0 = (state0 ^ state3) >>> 0
    state2 = (state2 ^ shifted) >>> 0
    state3 = rotateLeft(state3, 11)

    return result / UINT32_RANGE
  }
}

function webCrypto() {
  const source = globalThis.crypto
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues is required to create local draft randomness.')
  }
  return source
}

function randomBytes(length: number) {
  return webCrypto().getRandomValues(new Uint8Array(length))
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Create a fresh nonzero 128-bit local gameplay seed with Web Crypto. */
export function createLocalGameplaySeed(): GameplaySeed {
  let bytes: Uint8Array
  do bytes = randomBytes(GAMEPLAY_SEED_BYTES)
  while (bytes.every((byte) => byte === 0))
  return `${GAMEPLAY_SEED_PREFIX}${bytesToHex(bytes)}`
}

/** Create a local RFC 9562 UUIDv4 draft/session ID with Web Crypto. */
export function createLocalDraftId() {
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
