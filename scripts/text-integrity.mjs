import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const TEXT_EXTENSIONS = new Set(['.css', '.example', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.toml', '.ts', '.tsx'])
const RELEASE_WORKFLOW_FILES = [
  '.env.example',
  'README.md',
  'config/preview-release.json',
  'docs/BACKEND_OPERATIONS.md',
  'docs/D1C4_ACTIVATION.md',
  'docs/PREVIEW_RELEASE_WORKFLOW.md',
  'package.json',
  'scripts/preview-check.mjs',
  'scripts/preview-check.test.mjs',
  'scripts/preview-plan.mjs',
  'scripts/preview-workflow.test.mjs',
  'scripts/text-integrity.mjs',
  'scripts/lib/preview-release/binding-inventory.mjs',
  'scripts/lib/preview-release/canonical.mjs',
  'scripts/lib/preview-release/cloudflare-readonly.mjs',
  'scripts/lib/preview-release/command-safety.mjs',
  'scripts/lib/preview-release/configuration.mjs',
  'scripts/lib/preview-release/errors.mjs',
  'scripts/lib/preview-release/local-state.mjs',
  'scripts/lib/preview-release/manifest.mjs',
  'scripts/lib/preview-release/migrations.mjs',
  'scripts/lib/preview-release/plan.mjs',
  'scripts/lib/preview-release/redaction.mjs',
  'scripts/lib/preview-release/reporting.mjs',
]

function git(args) {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed.`)
  return result.stdout
}

function changedFiles() {
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD']).split(/\r?\n/)
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)
  return [...new Set([...RELEASE_WORKFLOW_FILES, ...tracked, ...untracked])]
    .filter(Boolean)
    .filter((file) => existsSync(path.join(REPOSITORY_ROOT, file)))
    .filter((file) => TEXT_EXTENSIONS.has(path.extname(file)) || ['.env.example', 'package.json'].includes(file))
    .sort()
}

function scanFile(relativePath, packageScripts) {
  const findings = []
  const bytes = readFileSync(path.join(REPOSITORY_ROOT, relativePath))
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) findings.push('UTF-8 BOM')
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return ['invalid UTF-8']
  }
  if (source.includes('\0')) findings.push('NUL byte')
  if (source.length > 0 && !source.endsWith('\n')) findings.push('missing final newline')
  source.split('\n').forEach((line, index) => {
    if (/[ \t]+$/.test(line)) findings.push(`line ${index + 1}: trailing whitespace`)
    const duplicate = line.match(/\b([A-Za-z]{3,})\s+\1\b/i)
    if (duplicate) findings.push(`line ${index + 1}: duplicated word ${duplicate[1]}`)
  })
  if (relativePath.endsWith('.md')) {
    const fences = source.match(/^```/gm)?.length ?? 0
    if (fences % 2 !== 0) findings.push('unbalanced Markdown code fence')
    for (const match of source.matchAll(/npm run (?:--silent )?([a-z0-9:_-]+)/gi)) {
      if (!(match[1] in packageScripts)) findings.push(`unknown npm command ${match[1]}`)
    }
  }
  if (/Bearer [A-Za-z0-9_-]{24,}/.test(source)) findings.push('secret-like Bearer value')
  if (/PENNANT_PREVIEW_API_TOKEN\s*=\s*[A-Za-z0-9][A-Za-z0-9_-]{15,}/.test(source) && relativePath !== 'docs/PREVIEW_RELEASE_WORKFLOW.md') {
    findings.push('persisted Preview token-like value')
  }
  return findings
}

try {
  const files = changedFiles()
  if (files.length === 0) throw new Error('No release-workflow text files were available for integrity inspection.')
  const packageScripts = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')).scripts
  const findings = files.flatMap((file) => scanFile(file, packageScripts).map((finding) => `${file}: ${finding}`))
  if (findings.length > 0) {
    console.error(['Text integrity failed:', ...findings.map((finding) => `- ${finding}`)].join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Text integrity passed: ${files.length} release-workflow text files inspected; 0 findings.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Text integrity failed.')
  process.exitCode = 1
}
