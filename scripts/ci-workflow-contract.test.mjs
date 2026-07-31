import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

const expectedWorkflow = [
  'name: Routine CI',
  '',
  'on:',
  '  push:',
  '    branches:',
  '      - develop',
  '  pull_request:',
  '    branches:',
  '      - develop',
  '',
  'permissions:',
  '  contents: read',
  '',
  'concurrency:',
  '  group: routine-ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
  '  cancel-in-progress: true',
  '',
  'jobs:',
  '  validate:',
  '    name: Validate',
  '    runs-on: ubuntu-24.04',
  '    timeout-minutes: 45',
  '',
  '    steps:',
  '      - name: Check out repository',
  '        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
  '        with:',
  '          persist-credentials: false',
  '',
  '      - name: Set up Node.js',
  '        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
  '        with:',
  '          node-version: 24.18.0',
  '          cache: npm',
  '          cache-dependency-path: package-lock.json',
  '',
  '      - name: Install locked dependencies',
  '        run: npm ci',
  '',
  '      - name: Install the routine Chromium browser',
  '        run: npx --no-install playwright install --with-deps chromium',
  '',
  '      - name: Run routine validation',
  '        run: npm run ci:validate',
  '',
].join('\n')

assert.equal(
  workflow,
  expectedWorkflow,
  'Routine CI must remain the exact reviewed workflow; alternate YAML forms or extra steps are forbidden.',
)
assert.match(workflow, /^on:\n  push:\n    branches:\n      - develop\n  pull_request:\n    branches:\n      - develop$/m)
assert.match(workflow, /^permissions:\n  contents: read$/m)
assert.equal((workflow.match(/^[ \t]*permissions:/gm) ?? []).length, 1)
assert.doesNotMatch(workflow, /^[ \t]+[a-z-]+:[ \t]+write$/m)
assert.doesNotMatch(workflow, /^[ \t]*permissions:[ \t]*\S+/m)
assert.doesNotMatch(workflow, /^[ \t]*env:/m)
assert.match(workflow, /^concurrency:\n  group: routine-ci-/m)
assert.match(workflow, /^  cancel-in-progress: true$/m)
assert.match(workflow, /^    timeout-minutes: 45$/m)
assert.match(workflow, /node-version: 24\.18\.0/)
assert.match(workflow, /cache: npm/)
assert.match(workflow, /cache-dependency-path: package-lock\.json/)
assert.match(workflow, /persist-credentials: false/)

const usesLines = [...workflow.matchAll(/^[ \t]*uses:[ \t]*(.+)$/gm)]
const actionReferences = [...workflow.matchAll(/^[ \t]*uses:[ \t]*([^@\s]+)@([0-9a-f]{40})(?:[ \t]+#[ \t]+(.+))?$/gm)]
assert.equal(actionReferences.length, usesLines.length, 'Every action must use one immutable full commit SHA')
assert.deepEqual(
  actionReferences.map((match) => match[1]),
  ['actions/checkout', 'actions/setup-node'],
)
for (const [, action, sha, version] of actionReferences) {
  assert.equal(sha.length, 40, `${action} is not pinned to a full commit SHA`)
  assert.equal(version, 'v6', `${action} is missing its reviewed major-version annotation`)
}

for (const forbidden of [
  'pull_request_target',
  'workflow_dispatch',
  'schedule:',
  'container:',
  'services:',
  'environment:',
  'id-token: write',
  'contents: write',
  'deployments: write',
  'secrets.',
  'wrangler ',
  'cloudflare',
  '--remote',
  ' deploy',
  'migrations apply',
]) {
  assert.equal(workflow.toLowerCase().includes(forbidden.toLowerCase()), false, `CI contains forbidden remote or privileged text: ${forbidden}`)
}

const runCommands = [...workflow.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1])
assert.deepEqual(runCommands, [
  'npm ci',
  'npx --no-install playwright install --with-deps chromium',
  'npm run ci:validate',
])

assert.equal(typeof packageJson.scripts['ci:validate'], 'string')
assert.equal(packageJson.scripts['ci:validate'].includes('release:validate'), false)

console.log('GitHub Actions contract passed: immutable actions, read-only token, locked install, bounded runtime, and no deployment or Cloudflare command path.')
