import assert from 'node:assert/strict'
import { RNG_VERSION } from '../src/config/versions'
import {
  createLocalDraftId,
  createLocalGameplaySeed,
  createSeededRandom,
  GAMEPLAY_SEED_BYTES,
  GAMEPLAY_SEED_HEX_LENGTH,
  GAMEPLAY_SEED_PREFIX,
  parseGameplaySeed,
  SEEDED_RNG_ALGORITHM,
  SEEDED_RNG_VERSION,
} from '../src/game/SeededRandom'

const UINT32_RANGE = 0x1_0000_0000
const VECTOR_SEED = 'seeded-v1:00000001000000020000000300000004'
const XOSHIRO_UINT32_VECTOR = [
  11520,
  0,
  5927040,
  70819200,
  2031721883,
  1637235492,
  1287239034,
  3734860849,
  3729100597,
  4258142804,
  337829053,
  2142557243,
  3576906021,
  2006103318,
  3870238204,
  1001584594,
] as const

assert.equal(SEEDED_RNG_VERSION, 'seeded-v1')
assert.equal(SEEDED_RNG_VERSION, RNG_VERSION, 'shared metadata and the seeded implementation must stay version-aligned')
assert.equal(SEEDED_RNG_ALGORITHM, 'xoshiro128**')
assert.equal(GAMEPLAY_SEED_PREFIX, 'seeded-v1:')
assert.equal(GAMEPLAY_SEED_BYTES, 16)
assert.equal(GAMEPLAY_SEED_HEX_LENGTH, 32)
assert.equal(parseGameplaySeed(VECTOR_SEED), VECTOR_SEED)

const random = createSeededRandom(VECTOR_SEED)
assert.deepEqual(
  XOSHIRO_UINT32_VECTOR.map(() => random() * UINT32_RANGE),
  XOSHIRO_UINT32_VECTOR,
  'seeded-v1 must retain its exact xoshiro128** uint32 output contract',
)

const replayRandom = createSeededRandom(VECTOR_SEED)
assert.deepEqual(
  XOSHIRO_UINT32_VECTOR.map(() => replayRandom() * UINT32_RANGE),
  XOSHIRO_UINT32_VECTOR,
  'the same seed must replay the same output sequence',
)
const alternateRandom = createSeededRandom('seeded-v1:00000005000000060000000700000008')
const alternateVector = [34560, 23040, 17769600, 177010560]
assert.deepEqual(alternateVector.map(() => alternateRandom() * UINT32_RANGE), alternateVector)
assert.notDeepEqual(alternateVector, XOSHIRO_UINT32_VECTOR.slice(0, alternateVector.length), 'different fixed seeds must produce different sequences')

for (const invalidSeed of [
  null,
  undefined,
  162,
  '',
  'seeded-v2:00000001000000020000000300000004',
  'seeded-v1:0000000100000002000000030000000',
  'seeded-v1:000000010000000200000003000000040',
  'seeded-v1:0000000100000002000000030000000g',
  'seeded-v1:0000000100000002000000030000000A',
  'seeded-v1:00000001000000020000000300000004 ',
]) {
  assert.throws(
    () => parseGameplaySeed(invalidSeed),
    /must match seeded-v1:<32 lowercase hex characters>/,
  )
}
const zeroSeed = 'seeded-v1:00000000000000000000000000000000'
assert.throws(() => parseGameplaySeed(zeroSeed), /must not be all zero/)
assert.throws(() => createSeededRandom(zeroSeed), /must not be all zero/)

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
const originalMathRandom = Math.random
let cryptoCalls = 0
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {
    getRandomValues: (bytes: Uint8Array) => {
      cryptoCalls += 1
      bytes.fill(0)
      if (cryptoCalls > 1) bytes.forEach((_, index) => { bytes[index] = index + 1 })
      return bytes
    },
  },
})
Math.random = () => { throw new Error('local identifiers must not use Math.random') }
try {
  assert.equal(createLocalGameplaySeed(), 'seeded-v1:0102030405060708090a0b0c0d0e0f10')
  const draftId = createLocalDraftId()
  assert.equal(draftId, '01020304-0506-4708-890a-0b0c0d0e0f10')
  assert.match(draftId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(cryptoCalls, 3, 'an all-zero gameplay seed must be retried before UUID generation')
} finally {
  Math.random = originalMathRandom
  if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
  else delete (globalThis as { crypto?: Crypto }).crypto
}

console.log('Seeded RNG tests passed: version contract, xoshiro vector, strict seeds, Web Crypto seed generation, and UUIDv4 formatting.')
