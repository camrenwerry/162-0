import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const maxRawBytes = 64 * 1024 * 1024
const maxGzipBytes = 3 * 1024 * 1024
const artifacts = [
  { name: 'private validation Worker', path: '/tmp/pennant-pursuit-validation-worker-build/index.js' },
  { name: 'Pages validation proxy', path: '/tmp/pennant-pursuit-pages-c4-build/index.js' },
]

const measurements = artifacts.map((artifact) => {
  const source = readFileSync(artifact.path)
  const rawBytes = statSync(artifact.path).size
  const gzipBytes = gzipSync(source).byteLength
  if (rawBytes > maxRawBytes || gzipBytes > maxGzipBytes) {
    throw new Error(`${artifact.name} exceeds the conservative Worker size guard.`)
  }
  return { name: artifact.name, rawBytes, gzipBytes }
})

if (measurements[1].rawBytes >= measurements[0].rawBytes) {
  throw new Error('Pages validation proxy is not smaller than the private validation Worker.')
}

console.log(JSON.stringify({ maxRawBytes, maxGzipBytes, measurements }, null, 2))
