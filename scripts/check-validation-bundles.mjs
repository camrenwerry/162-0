import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const maxRawBytes = 64 * 1024 * 1024
const maxGzipBytes = 3 * 1024 * 1024
const artifacts = [
  { name: 'preview private validation Worker', path: '/tmp/pennant-pursuit-validation-worker-build/index.js' },
  { name: 'production private validation Worker', path: '/tmp/pennant-pursuit-validation-production-worker-build/index.js' },
  { name: 'Pages validation proxy', path: '/tmp/pennant-pursuit-pages-c4-build/index.js' },
]

const measurements = artifacts.map((artifact) => {
  const source = readFileSync(artifact.path)
  const rawBytes = statSync(artifact.path).size
  const gzipBytes = gzipSync(source).byteLength
  if (rawBytes > maxRawBytes || gzipBytes > maxGzipBytes) {
    throw new Error(`${artifact.name} exceeds the conservative Worker size guard.`)
  }
  return {
    name: artifact.name,
    rawBytes,
    gzipBytes,
    sha256: createHash('sha256').update(source).digest('hex'),
  }
})

if (measurements[0].sha256 !== measurements[1].sha256) {
  throw new Error('Preview and production private validation Worker artifacts differ.')
}

if (measurements[2].rawBytes >= measurements[0].rawBytes || measurements[2].rawBytes >= measurements[1].rawBytes) {
  throw new Error('Pages validation proxy is not smaller than both private validation Workers.')
}

console.log(JSON.stringify({ maxRawBytes, maxGzipBytes, measurements }, null, 2))
