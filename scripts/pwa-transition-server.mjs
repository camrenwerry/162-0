import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const build = spawnSync('npm', ['run', 'build'], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: 'inherit',
  shell: false,
})
if (build.status !== 0) process.exit(build.status ?? 1)

const sourceRoot = path.join(repositoryRoot, 'dist')
const transitionRoot = mkdtempSync(path.join(tmpdir(), 'pennant-pursuit-pwa-transition-'))
const versionRoots = {
  a: path.join(transitionRoot, 'version-a'),
  b: path.join(transitionRoot, 'version-b'),
}
cpSync(sourceRoot, versionRoots.a, { recursive: true })
cpSync(sourceRoot, versionRoots.b, { recursive: true })

const versionAIndex = readFileSync(path.join(versionRoots.a, 'index.html'), 'utf8')
const entryMatch = versionAIndex.match(/<script type="module" crossorigin src="\/assets\/([^"]+\.js)"/u)
if (!entryMatch) throw new Error('The Version A application entry could not be identified.')
const versionAEntryPath = path.join(versionRoots.a, 'assets', entryMatch[1])
const versionAEntry = readFileSync(versionAEntryPath, 'utf8')
const classicChunkMatch = versionAEntry.match(/ClassicMode-[A-Za-z0-9_-]+\.js/u)
if (!classicChunkMatch) throw new Error('The Version A Classic lazy chunk could not be identified.')
writeFileSync(
  versionAEntryPath,
  versionAEntry.replaceAll(classicChunkMatch[0], 'ClassicMode-obsolete-local-transition.js'),
  'utf8',
)

const updatesChunkMatch = versionAEntry.match(/GameUpdatesScreen-[A-Za-z0-9_-]+\.js/u)
if (!updatesChunkMatch) throw new Error('The Version A updates lazy chunk could not be identified.')
const versionAUpdatesPath = path.join(versionRoots.a, 'assets', updatesChunkMatch[0])
writeFileSync(
  versionAUpdatesPath,
  `throw new TypeError("Network request failed");\n${readFileSync(versionAUpdatesPath, 'utf8')}`,
  'utf8',
)

function activeWorker(version) {
  return `
const VERSION = ${JSON.stringify(version)}
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'pwa-transition-version') {
    event.source?.postMessage({ type: 'pwa-transition-version', version: VERSION })
  }
})
`
}

function waitingWorker() {
  return `
const VERSION = 'B-waiting'
self.addEventListener('install', (event) => event.waitUntil(Promise.resolve()))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'pwa-transition-version') {
    event.source?.postMessage({ type: 'pwa-transition-version', version: VERSION })
  }
})
`
}

function failingWorker() {
  return `
self.addEventListener('install', (event) => {
  event.waitUntil(Promise.reject(new Error('Controlled local installation failure')))
})
`
}

const workerByMode = {
  a: activeWorker('A'),
  success: activeWorker('B'),
  waiting: waitingWorker(),
  'install-failure': failingWorker(),
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
])

let mode = 'a'
let serviceWorkerRequests = 0
let documentRequests = 0
const documentPaths = new Map()

function json(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

function currentRoot() {
  return mode === 'a' ? versionRoots.a : versionRoots.b
}

function safeAssetPath(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const relative = decoded.replace(/^\/+/u, '')
  const normalized = path.normalize(relative)
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null
  const root = currentRoot()
  const target = path.resolve(root, normalized)
  return target.startsWith(`${root}${path.sep}`) ? target : null
}

function serveFile(response, filePath) {
  response.writeHead(200, {
    'cache-control': 'no-store, no-cache, must-revalidate',
    'content-type': contentTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    expires: '0',
    pragma: 'no-cache',
  })
  response.end(readFileSync(filePath))
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1:4175')

  if (requestUrl.pathname === '/__pwa-state' && request.method === 'GET') {
    json(response, 200, {
      mode,
      serviceWorkerRequests,
      documentRequests,
      documentPaths: Object.fromEntries(documentPaths),
    })
    return
  }

  if (requestUrl.pathname === '/__pwa-mode' && request.method === 'POST') {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      let nextMode
      try {
        nextMode = JSON.parse(body).mode
      } catch {
        json(response, 400, { ok: false })
        return
      }
      if (!Object.hasOwn(workerByMode, nextMode)) {
        json(response, 400, { ok: false })
        return
      }
      mode = nextMode
      json(response, 200, { ok: true, mode })
    })
    return
  }

  if (requestUrl.pathname === '/sw.js') {
    serviceWorkerRequests += 1
    const sendWorker = () => {
      response.writeHead(200, {
        'cache-control': 'no-store, no-cache, must-revalidate',
        'content-type': 'text/javascript; charset=utf-8',
        'service-worker-allowed': '/',
      })
      response.end(workerByMode[mode])
    }
    if (mode === 'success') setTimeout(sendWorker, 1_200)
    else sendWorker()
    return
  }

  const acceptsHtml = request.headers.accept?.includes('text/html') ?? false
  let assetPath = safeAssetPath(requestUrl.pathname)
  if (assetPath && existsSync(assetPath) && statSync(assetPath).isDirectory()) {
    assetPath = path.join(assetPath, 'index.html')
  }
  if (assetPath && existsSync(assetPath) && statSync(assetPath).isFile()) {
    if (acceptsHtml && path.basename(assetPath) === 'index.html') {
      documentRequests += 1
      documentPaths.set(requestUrl.pathname, (documentPaths.get(requestUrl.pathname) ?? 0) + 1)
    }
    serveFile(response, assetPath)
    return
  }
  if (acceptsHtml) {
    documentRequests += 1
    documentPaths.set(requestUrl.pathname, (documentPaths.get(requestUrl.pathname) ?? 0) + 1)
    serveFile(response, path.join(currentRoot(), 'index.html'))
    return
  }
  response.writeHead(404, { 'cache-control': 'no-store' })
  response.end('Not found')
})

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  rmSync(transitionRoot, { recursive: true, force: true })
}

function stop() {
  server.close(() => {
    cleanup()
    process.exit(0)
  })
  setTimeout(() => {
    cleanup()
    process.exit(1)
  }, 5_000).unref()
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
process.once('exit', cleanup)
server.listen(4175, '127.0.0.1', () => {
  console.log('Two-version PWA transition server ready at http://127.0.0.1:4175')
})
