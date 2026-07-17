import fs from 'node:fs'
import path from 'node:path'
import {
  calculateCanonicalDataDigest,
  createWorkerCatalog,
  findGeneratedConflictCopyFiles,
  readSharedVersionMetadata,
  serializeWorkerCatalog,
  validateGeneratedData,
} from './lib/lahman-pipeline.mjs'

const EXPECTED_COMBINATIONS = 261
const EXPECTED_CARDS = 9_335
const root = process.cwd()
const generated = path.join(root, 'src/data/generated')
const report = validateGeneratedData(root, { validateWorkerCatalog: false })
if (report.errors.length) throw new Error(`Canonical generated-data validation failed:\n${report.errors.join('\n')}`)
if (findGeneratedConflictCopyFiles(root).length) throw new Error('Generated conflict-copy files are not permitted')

const combinations = JSON.parse(fs.readFileSync(path.join(generated, 'combinations.json'), 'utf8'))
const runtimePools = Object.fromEntries(combinations.map(({ id }) => [
  id,
  JSON.parse(fs.readFileSync(path.join(generated, 'runtime-pools', `${id}.json`), 'utf8')),
]))
const readiness = JSON.parse(fs.readFileSync(path.join(generated, 'readiness.json'), 'utf8'))
const metadata = readSharedVersionMetadata(root)
const dataDigest = calculateCanonicalDataDigest(combinations, runtimePools)
const cardIds = combinations.flatMap(({ id }) => runtimePools[id].map((card) => card.id))

if (combinations.length !== EXPECTED_COMBINATIONS) throw new Error(`Expected ${EXPECTED_COMBINATIONS} combinations; received ${combinations.length}`)
if (cardIds.length !== EXPECTED_CARDS) throw new Error(`Expected ${EXPECTED_CARDS} cards; received ${cardIds.length}`)
if (new Set(cardIds).size !== cardIds.length) throw new Error('Canonical card IDs must be globally unique')
if (dataDigest !== readiness.dataDigest) throw new Error('Recomputed canonical digest does not match readiness metadata')
for (const field of ['appVersion', 'gameRulesVersion', 'scoringVersion', 'dataVersion', 'rngVersion', 'submissionSchemaVersion', 'leaderboardVersion']) {
  if (readiness[field] !== metadata[field]) throw new Error(`Readiness ${field} does not match shared version metadata`)
}

const catalog = createWorkerCatalog(combinations, runtimePools, metadata, dataDigest)
fs.writeFileSync(path.join(generated, 'worker-catalog.json'), serializeWorkerCatalog(catalog))
console.log(`Generated Worker catalog with ${combinations.length} combinations, ${cardIds.length.toLocaleString()} cards, and digest ${dataDigest}.`)
