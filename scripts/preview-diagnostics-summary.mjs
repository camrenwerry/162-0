import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const OPERATIONS = new Set([
  'ticket',
  'submission',
  'leaderboard-read',
  'claim',
  'identity-status',
  'rename',
  'recovery',
])
const OUTCOMES = new Set([
  'success',
  'accepted',
  'idempotent',
  'conflict',
  'invalid',
  'rejected',
  'rate-limited',
  'server-error',
])
const LATENCIES = new Set(['lt-100ms', 'lt-500ms', 'lt-2000ms', 'gte-2000ms'])
const OUTPUT_PATTERN = /^\.preview-diagnostics\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/
const MAX_LINE_LENGTH = 65_536
const MAX_LINES = 1_000_000
const MAX_INPUT_BYTES = 16 * 1024 * 1024

function usage(message) {
  throw new Error(`${message}\nUsage: node scripts/preview-diagnostics-summary.mjs --source <pages|worker> --output .preview-diagnostics/<name>.json`)
}

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if ((key !== '--source' && key !== '--output') || typeof value !== 'string') {
      usage('Arguments must be exact flag/value pairs.')
    }
    if (key.slice(2) in result) usage(`${key} may be specified only once.`)
    result[key.slice(2)] = value
  }
  if (result.source !== 'pages' && result.source !== 'worker') {
    usage('--source must be pages or worker.')
  }
  if (typeof result.output !== 'string' || !OUTPUT_PATTERN.test(result.output)) {
    usage('--output must be one JSON file directly inside .preview-diagnostics/.')
  }
  return Object.freeze(result)
}

function exactDiagnosticEvent(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['event', 'latency', 'operation', 'outcome'])) return null
  if (value.event !== 'preview.operation') return null
  if (!OPERATIONS.has(value.operation) || !OUTCOMES.has(value.outcome) || !LATENCIES.has(value.latency)) return null
  return Object.freeze({
    operation: value.operation,
    outcome: value.outcome,
    latency: value.latency,
  })
}

function collectEvents(value, depth = 0, found = []) {
  if (depth > 5 || found.length >= 50) return found
  const exact = exactDiagnosticEvent(value)
  if (exact) {
    found.push(exact)
    return found
  }
  if (typeof value === 'string') {
    if (value.length > 2_048 || !value.trimStart().startsWith('{')) return found
    try {
      collectEvents(JSON.parse(value), depth + 1, found)
    } catch {
      // Tail wrappers may contain ordinary non-JSON console messages.
    }
    return found
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 50)) collectEvents(entry, depth + 1, found)
    return found
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value).slice(0, 50)) collectEvents(entry, depth + 1, found)
  }
  return found
}

const options = parseArguments(process.argv.slice(2))
const counts = new Map()
let acceptedEvents = 0
let discardedLines = 0
let totalLines = 0
let finalized = false

function acceptLine(line) {
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    discardedLines += 1
    return
  }
  const events = collectEvents(parsed)
  if (events.length === 0) {
    discardedLines += 1
    return
  }
  for (const event of events) {
    const key = JSON.stringify(event)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    acceptedEvents += 1
  }
}

function finalize() {
  if (finalized) return
  finalized = true
  const directory = '.preview-diagnostics'
  if (existsSync(directory) && !lstatSync(directory).isDirectory()) {
    throw new Error('.preview-diagnostics must be a real directory, not a file or symbolic link.')
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error('.preview-diagnostics must not be a symbolic link.')
  }

  const outputPath = path.resolve(options.output)
  if (path.dirname(outputPath) !== path.resolve(directory)) {
    throw new Error('Diagnostic summaries may be written only inside .preview-diagnostics/.')
  }
  const summary = Object.freeze({
    schemaVersion: 'pennant-preview-diagnostic-summary-v1',
    source: options.source,
    generatedAt: new Date().toISOString(),
    retention: {
      class: 'operator-local',
      recommendedDeleteAfterDays: 14,
    },
    acceptedEvents,
    discardedLines,
    counts: [...counts.entries()]
      .map(([key, count]) => ({ ...JSON.parse(key), count }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    privacy: {
      rawInputRetained: false,
      identityDataRetained: false,
      credentialsRetained: false,
      requestBodiesRetained: false,
      userAgentRetained: false,
      networkAddressRetained: false,
    },
    limitations: [
      'Counts cover only events observed while this collector was connected.',
      'This file is a local per-session aggregate, not a durable remote telemetry service.',
      'Discarded lines are counted but never copied into the summary.',
    ],
  })
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  process.stdout.write(`Wrote privacy-safe aggregate summary to ${options.output}\n`)
}

const decoder = new StringDecoder('utf8')
let inputBytes = 0
let pendingLine = ''
let pendingLineTooLong = false
let inputFinished = false
let inputFailed = false

function failInput(message) {
  if (inputFailed || inputFinished) return
  inputFailed = true
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
  process.stdin.destroy()
}

function finishLine() {
  totalLines += 1
  if (totalLines > MAX_LINES) {
    failInput(`Input exceeded the ${MAX_LINES}-line session limit.`)
    return
  }
  if (pendingLineTooLong) discardedLines += 1
  else acceptLine(pendingLine.endsWith('\r') ? pendingLine.slice(0, -1) : pendingLine)
  pendingLine = ''
  pendingLineTooLong = false
}

function appendLineFragment(fragment) {
  if (pendingLineTooLong) return
  if (pendingLine.length + fragment.length > MAX_LINE_LENGTH) {
    pendingLine = ''
    pendingLineTooLong = true
    return
  }
  pendingLine += fragment
}

function consumeText(text) {
  let start = 0
  for (let newline = text.indexOf('\n'); newline >= 0; newline = text.indexOf('\n', start)) {
    appendLineFragment(text.slice(start, newline))
    finishLine()
    if (inputFailed) return
    start = newline + 1
  }
  appendLineFragment(text.slice(start))
}

function finishInput() {
  if (inputFinished || inputFailed) return
  consumeText(decoder.end())
  if (inputFailed) return
  if (pendingLine.length > 0 || pendingLineTooLong) finishLine()
  if (inputFailed) return
  inputFinished = true
  finalize()
}

process.stdin.on('data', (chunk) => {
  inputBytes += chunk.length
  if (inputBytes > MAX_INPUT_BYTES) {
    failInput(`Input exceeded the ${MAX_INPUT_BYTES}-byte session limit; no summary was written.`)
    return
  }
  consumeText(decoder.write(chunk))
})
process.stdin.once('end', finishInput)
process.stdin.once('error', (error) => {
  failInput(`Diagnostic input failed: ${error instanceof Error ? error.message : 'unknown input error'}`)
})
process.once('SIGINT', () => {
  process.exitCode = 130
  finishInput()
  process.stdin.destroy()
})
