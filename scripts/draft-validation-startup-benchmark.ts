import { performance } from 'node:perf_hooks'

const routeImportStarted = performance.now()
await import('../functions/api/v1/validate-draft')
const routeModuleInitializationMs = performance.now() - routeImportStarted

const healthImportStarted = performance.now()
await import('../functions/api/v1/health')
const healthModuleInitializationMs = performance.now() - healthImportStarted

const catalogImportStarted = performance.now()
const { createWorkerReplayCatalog } = await import('../src/game/replay/WorkerCatalog')
const catalogModuleInitializationMs = performance.now() - catalogImportStarted

const catalogStarted = performance.now()
const catalog = createWorkerReplayCatalog()
const catalogInitializationMs = performance.now() - catalogStarted

console.log(JSON.stringify({
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  routeModuleInitializationMs: Number(routeModuleInitializationMs.toFixed(3)),
  healthModuleInitializationMs: Number(healthModuleInitializationMs.toFixed(3)),
  catalogModuleInitializationMs: Number(catalogModuleInitializationMs.toFixed(3)),
  catalogInitializationMs: Number(catalogInitializationMs.toFixed(3)),
  catalog: { combinations: catalog.getCombinations().length },
}, null, 2))
