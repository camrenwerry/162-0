import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(repositoryRoot, 'scripts/preview-diagnostics-summary.mjs')
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'pennant-preview-diagnostics-'))
const output = '.preview-diagnostics/session.json'
const privateMaterial = 'Player Cedar ppd1_SECRET PP1-SECRET ppc1_SECRET raw-ticket-value 192.0.2.1 https://private.example/path PennantTester/1.0'
const input = [
  JSON.stringify({
    event: 'preview.operation',
    operation: 'ticket',
    outcome: 'success',
    latency: 'lt-100ms',
  }),
  JSON.stringify({
    logs: [{
      message: [JSON.stringify({
        event: 'preview.operation',
        operation: 'rename',
        outcome: 'conflict',
        latency: 'lt-500ms',
      })],
    }],
    unsafeRequestMetadata: privateMaterial,
  }),
  JSON.stringify({
    event: 'preview.operation',
    operation: 'recovery',
    outcome: 'invalid',
    latency: 'lt-2000ms',
    displayName: privateMaterial,
  }),
  privateMaterial,
].join('\n')

const successful = spawnSync(process.execPath, [
  script,
  '--source', 'pages',
  '--output', output,
], {
  cwd: fixtureRoot,
  input,
  encoding: 'utf8',
})
assert.equal(successful.status, 0, successful.stderr)

const outputPath = path.join(fixtureRoot, output)
const serialized = readFileSync(outputPath, 'utf8')
const summary = JSON.parse(serialized)
assert.equal(summary.schemaVersion, 'pennant-preview-diagnostic-summary-v1')
assert.equal(summary.source, 'pages')
assert.equal(summary.acceptedEvents, 2)
assert.equal(summary.discardedLines, 2)
assert.equal(summary.counts.length, 2)
assert.equal(summary.privacy.rawInputRetained, false)
assert.equal(statSync(outputPath).mode & 0o777, 0o600)
assert.equal(statSync(path.dirname(outputPath)).mode & 0o777, 0o700)
for (const forbidden of [
  'Player Cedar',
  'ppd1_',
  'PP1-',
  'ppc1_',
  'raw-ticket-value',
  '192.0.2.1',
  'private.example',
  'PennantTester',
]) assert.doesNotMatch(serialized, new RegExp(forbidden))

const overwrite = spawnSync(process.execPath, [
  script,
  '--source', 'pages',
  '--output', output,
], {
  cwd: fixtureRoot,
  input,
  encoding: 'utf8',
})
assert.notEqual(overwrite.status, 0)

const outside = spawnSync(process.execPath, [
  script,
  '--source', 'worker',
  '--output', '../unsafe.json',
], {
  cwd: fixtureRoot,
  input,
  encoding: 'utf8',
})
assert.notEqual(outside.status, 0)

const longLineOutput = '.preview-diagnostics/long-line.json'
const longLine = JSON.stringify({ unsafe: privateMaterial.repeat(5_000) })
const longLineResult = spawnSync(process.execPath, [
  script,
  '--source', 'worker',
  '--output', longLineOutput,
], {
  cwd: fixtureRoot,
  input: longLine,
  encoding: 'utf8',
})
assert.equal(longLineResult.status, 0, longLineResult.stderr)
const longLineSummary = JSON.parse(readFileSync(path.join(fixtureRoot, longLineOutput), 'utf8'))
assert.equal(longLineSummary.acceptedEvents, 0)
assert.equal(longLineSummary.discardedLines, 1)
assert.doesNotMatch(JSON.stringify(longLineSummary), /Player Cedar|private\.example|PennantTester/)

const totalLimitOutput = '.preview-diagnostics/total-limit.json'
const totalLimitResult = spawnSync(process.execPath, [
  script,
  '--source', 'pages',
  '--output', totalLimitOutput,
], {
  cwd: fixtureRoot,
  input: Buffer.alloc((16 * 1024 * 1024) + 1, 0x20),
  encoding: 'utf8',
})
assert.notEqual(totalLimitResult.status, 0)
assert.match(totalLimitResult.stderr, /16777216-byte session limit/)
assert.equal(existsSync(path.join(fixtureRoot, totalLimitOutput)), false)

const symlinkFixture = mkdtempSync(path.join(os.tmpdir(), 'pennant-preview-diagnostics-symlink-'))
const symlinkTarget = path.join(symlinkFixture, 'elsewhere')
mkdirSync(symlinkTarget)
symlinkSync(symlinkTarget, path.join(symlinkFixture, '.preview-diagnostics'))
const symlinkResult = spawnSync(process.execPath, [
  script,
  '--source', 'worker',
  '--output', output,
], {
  cwd: symlinkFixture,
  input,
  encoding: 'utf8',
})
assert.notEqual(symlinkResult.status, 0)
assert.equal(existsSync(path.join(symlinkTarget, 'session.json')), false)

console.log('Preview diagnostic summary tests passed: exact low-cardinality events survive, raw and oversized input is bounded, output is private and non-overwriting, and real-directory paths are confined.')
