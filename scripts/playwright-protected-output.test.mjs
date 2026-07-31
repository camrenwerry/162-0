import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const playwrightTestUrl = pathToFileURL(
  path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'index.mjs'),
).href
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const probeRoot = mkdtempSync(path.join(tmpdir(), 'pennant-pursuit-protected-output-'))

function representativeProtectedValues() {
  return Object.freeze({
    draftTicket: 'T'.repeat(32),
    ticketSignature: 'S'.repeat(64),
    canonicalTranscript: JSON.stringify({
      schema: ['pennant', 'draft', 'transcript', 'v1'].join('-'),
      picks: Array.from({ length: 14 }, (_, index) => ({ round: index + 1, player: `player-${index + 1}` })),
    }),
    fullRoster: JSON.stringify(
      Array.from({ length: 14 }, (_, index) => ({ player: `protected-player-${index + 1}`, position: `P${index + 1}` })),
    ),
    claimCapability: `ppc1_${'C'.repeat(43)}`,
    deviceCredential: `ppd1_${'D'.repeat(43)}`,
    recoveryCode: ['PP1', '2468', 'ACEG', 'JKLM', 'NPQR', 'STVW', 'XYZA', 'BDFH'].join('-'),
    recoveryOperationId: ['13572468', '2468', '4242', '8246', '135724681357'].join('-'),
  })
}

function visitFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) visitFiles(target, files)
    else files.push(target)
  }
  return files
}

const protectedValues = representativeProtectedValues()
const protectedDigests = Object.fromEntries(
  Object.entries(protectedValues).map(([category, value]) => [
    category,
    createHash('sha256').update(value).digest('hex'),
  ]),
)

const configPath = path.join(probeRoot, 'playwright.config.mjs')
const specPath = path.join(probeRoot, 'protected-output.spec.mjs')

try {
  writeFileSync(configPath, `
export default {
  testDir: ${JSON.stringify(probeRoot)},
  testMatch: 'protected-output.spec.mjs',
  workers: 1,
  reporter: [
    ['line'],
    ['json', { outputFile: 'reports/results.json' }],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
  ],
  use: { screenshot: 'off', trace: 'off', video: 'off' },
  outputDir: 'test-results',
}
`, 'utf8')

  writeFileSync(specPath, `
import { expect, test } from ${JSON.stringify(playwrightTestUrl)}

test('privacy-safe protected-value failure probe', async () => {
  const protectedValues = {
    draftTicket: 'T'.repeat(32),
    ticketSignature: 'S'.repeat(64),
    canonicalTranscript: JSON.stringify({
      schema: ['pennant', 'draft', 'transcript', 'v1'].join('-'),
      picks: Array.from({ length: 14 }, (_, index) => ({ round: index + 1, player: \`player-\${index + 1}\` })),
    }),
    fullRoster: JSON.stringify(
      Array.from({ length: 14 }, (_, index) => ({ player: \`protected-player-\${index + 1}\`, position: \`P\${index + 1}\` })),
    ),
    claimCapability: \`ppc1_\${'C'.repeat(43)}\`,
    deviceCredential: \`ppd1_\${'D'.repeat(43)}\`,
    recoveryCode: ['PP1', '2468', 'ACEG', 'JKLM', 'NPQR', 'STVW', 'XYZA', 'BDFH'].join('-'),
    recoveryOperationId: ['13572468', '2468', '4242', '8246', '135724681357'].join('-'),
  }
  const observation = Object.fromEntries(
    Object.keys(protectedValues).map((category) => [category, { seeded: true, redacted: true }]),
  )
  observation.recoveryOperationId.redacted = false
  expect(observation).toEqual(
    Object.fromEntries(
      Object.keys(protectedValues).map((category) => [category, { seeded: true, redacted: true }]),
    ),
  )
})
`, 'utf8')

  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', '--config', configPath],
    {
      cwd: probeRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        CI: '1',
        NO_COLOR: '1',
      },
      timeout: 120_000,
    },
  )

  assert.equal(result.status, 1, 'the isolated Playwright probe must fail intentionally')
  assert.equal(result.signal, null, 'the isolated Playwright probe must exit normally')
  assert.equal(result.error, undefined, 'the isolated Playwright probe must launch successfully')

  const outputs = [
    Buffer.from(result.stdout ?? '', 'utf8'),
    Buffer.from(result.stderr ?? '', 'utf8'),
    ...visitFiles(probeRoot).map((filePath) => readFileSync(filePath)),
  ]
  const leakedCategories = Object.entries(protectedValues)
    .filter(([, value]) => outputs.some((output) => output.includes(Buffer.from(value, 'utf8'))))
    .map(([category]) => category)

  assert.deepEqual(
    leakedCategories,
    [],
    `protected output probe leaked categories: ${leakedCategories.join(', ')}`,
  )
  assert.equal(Object.keys(protectedDigests).length, 8)
  console.log('Playwright protected-output regression passed: 8 protected categories remained absent from stdout, stderr, JSON, HTML, and retained result artifacts during an intentional failure.')
} finally {
  rmSync(probeRoot, { recursive: true, force: true })
}
