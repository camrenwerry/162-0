import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Log, LogLevel, Miniflare } from 'miniflare'

const WORKER_BUNDLE = '/tmp/pennant-pursuit-draft-timing-safe-workerd/draft-timing-safe-workerd.worker.js'
const workerdPackage = JSON.parse(readFileSync(new URL('../node_modules/workerd/package.json', import.meta.url), 'utf8'))
const runtime = new Miniflare({
  compatibilityDate: '2026-07-14',
  log: new Log(LogLevel.ERROR),
  modules: true,
  modulesRoot: '/tmp/pennant-pursuit-draft-timing-safe-workerd',
  scriptPath: WORKER_BUNDLE,
})

try {
  const response = await runtime.dispatchFetch('http://draft-timing-safe.test/')
  const responseBody = await response.text()
  assert.equal(response.status, 200, responseBody)
  assert.deepEqual(JSON.parse(responseBody), {
    timingSafeEqualAvailable: true,
    detachedTimingSafeEqualThrows: true,
    issuedTicketVerified: true,
    modifiedTicketReason: 'invalid_ticket_signature',
    digestComparison: [true, false, null],
  })
  console.log(`Workerd timing-safe regression passed under workerd@${workerdPackage.version}.`)
} finally {
  await runtime.dispose()
}
