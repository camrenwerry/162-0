import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { canonicalHash, fileHash } from './canonical.mjs'
import { localError, remoteError } from './errors.mjs'

function output(result) {
  return String(result?.stdout ?? '').trim()
}

function assertResult(result, description, classification = 'local') {
  if (result?.error) throw localError(`${description} failed: ${result.error.message}`, classification)
  if (result?.signal) throw localError(`${description} ended with signal ${result.signal}.`, classification)
  if (result?.status !== 0) throw localError(`${description} exited with status ${result?.status ?? 'unknown'}.`, classification)
  return output(result)
}

export function createFixedRunner(environment = process.env, spawn = spawnSync) {
  const safeEnvironment = Object.fromEntries([
    'PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR', 'FORCE_COLOR',
  ].filter((key) => typeof environment[key] === 'string').map((key) => [key, environment[key]]))
  return (command, args, cwd) => spawn(command, args, {
    cwd,
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: safeEnvironment,
  })
}

function parseHeadTree(value) {
  const entries = value.split('\0').filter(Boolean).map((line) => {
    const match = line.match(/^(\d{6}) (blob|tree) ([0-9a-f]{40,64})\t(.+)$/)
    if (!match || match[2] !== 'blob') throw localError('Git returned an unreadable immutable HEAD tree.', 'git.source-inventory')
    return Object.freeze({ mode: match[1], object: match[3], path: match[4] })
  })
  if (entries.length === 0) throw localError('Immutable HEAD source inventory is empty.', 'git.source-inventory')
  return entries
}

function subsetHash(entries, predicate) {
  return canonicalHash(entries.filter(({ path: relativePath }) => predicate(relativePath)))
}

function directoryArtifactHash(directory) {
  try {
    if (!statSync(directory).isDirectory()) return null
  } catch {
    return null
  }
  const files = []
  const visit = (current, relative = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolutePath, relativePath)
      else if (entry.isFile()) files.push({ path: relativePath, sha256: fileHash(absolutePath) })
      else throw localError(`Build artifact contains unsupported filesystem entry ${relativePath}.`, 'artifacts.local-output')
    }
  }
  visit(directory)
  return files.length > 0 ? canonicalHash(files) : null
}

function major(version, label) {
  const match = String(version).trim().match(/^(?:v)?(\d+)\./)
  if (!match) throw localError(`${label} returned an unreadable version.`, 'toolchain.versions')
  return Number(match[1])
}

function parseDivergence(value) {
  const match = value.match(/^(\d+)\s+(\d+)$/)
  if (!match) throw localError('Git returned an unreadable divergence count.', 'git.divergence')
  return { ahead: Number(match[1]), behind: Number(match[2]) }
}

function assertLockfile(repositoryRoot, manifest) {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'))
  if (packageJson.name !== manifest.repository.packageName || packageJson.version !== manifest.repository.packageVersion) {
    throw localError('package.json identity differs from the immutable Preview manifest.', 'repository.package')
  }
  if (lock.name !== packageJson.name || lock.version !== packageJson.version || lock.lockfileVersion !== manifest.repository.lockfileVersion) {
    throw localError('package-lock.json metadata is inconsistent with package.json or the immutable Preview manifest.', 'repository.lockfile')
  }
  const root = lock.packages?.['']
  if (!root || root.name !== packageJson.name || root.version !== packageJson.version) {
    throw localError('package-lock.json root package metadata is inconsistent.', 'repository.lockfile')
  }
  return { packageJson, lock }
}

function assertDocumentationCommands(repositoryRoot, scripts) {
  const documents = ['README.md', 'docs/BACKEND_OPERATIONS.md', 'docs/D1C4_ACTIVATION.md', 'docs/PREVIEW_RELEASE_WORKFLOW.md']
  const missing = []
  for (const document of documents) {
    const source = readFileSync(path.join(repositoryRoot, document), 'utf8')
    for (const match of source.matchAll(/npm run (?:--silent )?([a-z0-9:_-]+)/gi)) {
      if (!(match[1] in scripts)) missing.push(`${document}: ${match[1]}`)
    }
  }
  if (missing.length > 0) throw localError(`Documentation references missing npm scripts: ${missing.join(', ')}.`, 'documentation.commands')
}

export function inspectLocalState({ repositoryRoot, manifest, runner = createFixedRunner() }) {
  const runGit = (args, description) => assertResult(runner('git', args, repositoryRoot), description, `git.${args[0]}`)
  const actualRoot = path.normalize(runGit(['rev-parse', '--show-toplevel'], 'Repository identity'))
  if (!manifest.repository.allowedRoots.map(path.normalize).includes(actualRoot)) {
    throw localError(`Repository root ${actualRoot} is not in the immutable allowed-root policy.`, 'repository.path')
  }
  if (actualRoot !== path.normalize(repositoryRoot)) throw localError('Command working directory is not the Git repository root.', 'repository.path')
  const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], 'Current branch')
  if (branch !== manifest.repository.previewBranch) throw localError(`Expected branch ${manifest.repository.previewBranch}; found ${branch || 'detached HEAD'}.`, 'git.branch')
  const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], 'Upstream branch')
  if (upstream !== manifest.repository.upstream) throw localError(`Expected upstream ${manifest.repository.upstream}; found ${upstream || 'none'}.`, 'git.upstream')
  const status = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'Worktree status')
  if (status.length > 0) throw localError('Tracked, staged, or untracked repository changes are not allowed.', 'git.worktree')
  const divergence = parseDivergence(runGit(['rev-list', '--left-right', '--count', 'HEAD...origin/develop'], 'Local divergence'))
  if (divergence.ahead !== 0 || divergence.behind !== 0) throw localError(`Expected 0 0 local divergence; found ${divergence.ahead} ${divergence.behind}.`, 'git.divergence')
  assertResult(runner('git', ['diff', '--check'], repositoryRoot), 'Git whitespace validation', 'git.diff-check')
  const remoteUrl = runGit(['config', '--get', 'remote.origin.url'], 'Origin URL')
  if (remoteUrl !== manifest.repository.remoteUrl) throw localError('origin URL differs from the immutable Preview manifest.', 'git.remote')
  const head = runGit(['rev-parse', 'HEAD'], 'Git HEAD')
  if (!/^[0-9a-f]{40}$/.test(head)) throw localError('Git returned an unreadable full HEAD.', 'git.head')

  const { packageJson } = assertLockfile(repositoryRoot, manifest)
  const nodeVersion = process.versions.node
  const npmVersion = assertResult(runner('npm', ['--version'], repositoryRoot), 'npm version', 'toolchain.versions')
  const wranglerPackage = JSON.parse(readFileSync(path.join(repositoryRoot, 'node_modules/wrangler/package.json'), 'utf8'))
  if (!manifest.toolchain.nodeAllowedMajors.includes(major(nodeVersion, 'Node'))) throw localError(`Node ${nodeVersion} is not approved by the Preview manifest.`, 'toolchain.versions')
  if (!manifest.toolchain.npmAllowedMajors.includes(major(npmVersion, 'npm'))) throw localError(`npm ${npmVersion} is not approved by the Preview manifest.`, 'toolchain.versions')
  if (wranglerPackage.version !== manifest.toolchain.wranglerVersion) throw localError(`Wrangler ${wranglerPackage.version} differs from approved ${manifest.toolchain.wranglerVersion}.`, 'toolchain.versions')
  assertDocumentationCommands(repositoryRoot, packageJson.scripts)

  return Object.freeze({
    repositoryRoot: actualRoot,
    branch,
    upstream,
    head,
    divergence,
    remoteUrl,
    toolchain: Object.freeze({ node: nodeVersion, npm: npmVersion, wrangler: wranglerPackage.version }),
  })
}

export function inspectServerDevelop({ repositoryRoot, manifest, runner = createFixedRunner() }) {
  const result = runner('git', ['ls-remote', '--heads', 'origin', `refs/heads/${manifest.repository.previewBranch}`], repositoryRoot)
  if (result?.error || result?.signal || result?.status !== 0) {
    throw remoteError('Read-only git ls-remote could not verify server-side develop.', 'server_git_read_failure', 'remote.git-head')
  }
  const line = output(result)
  const match = line.match(/^([0-9a-f]{40})\s+refs\/heads\/develop$/)
  if (!match) throw remoteError('Server-side develop response is missing or ambiguous.', 'ambiguous_server_git_state', 'remote.git-head')
  return match[1]
}

export function computeReleaseHashes({ repositoryRoot, manifestHash, configurationHash, toolchain, runner = createFixedRunner() }) {
  const result = runner('git', ['ls-tree', '-r', '-z', 'HEAD'], repositoryRoot)
  const entries = parseHeadTree(assertResult(result, 'Immutable HEAD source inventory', 'git.source-inventory'))
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const required = (relativePath) => {
    const entry = byPath.get(relativePath)
    if (!entry) throw localError(`Immutable HEAD is missing deployment input ${relativePath}.`, 'git.source-inventory')
    return canonicalHash(entry)
  }
  const pagesPredicate = (relativePath) => relativePath.startsWith('src/')
    || relativePath.startsWith('functions/') || relativePath.startsWith('public/')
    || relativePath.startsWith('data-import/') || relativePath.startsWith('scripts/lib/')
    || /^(?:package(?:-lock)?\.json|wrangler\.toml|vite\.config\.[^.]+|tsconfig[^/]*\.json|index\.html)$/.test(relativePath)
  const workerPredicate = (relativePath) => relativePath.startsWith('workers/draft-validation/')
    || relativePath.startsWith('functions/lib/') || relativePath.startsWith('src/')
    || relativePath.startsWith('migrations/') || relativePath.startsWith('scripts/lib/')
    || /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)$/.test(relativePath)
  const normalizedToolchain = toolchain ?? {}
  return Object.freeze({
    source: canonicalHash(entries),
    repositoryTree: canonicalHash(entries),
    lockfile: required('package-lock.json'),
    package: required('package.json'),
    manifest: manifestHash,
    configuration: configurationHash,
    toolchain: canonicalHash(normalizedToolchain),
    workerSourceArtifact: subsetHash(entries, workerPredicate),
    pagesSourceArtifact: subsetHash(entries, pagesPredicate),
    appBuildArtifact: directoryArtifactHash(path.join(repositoryRoot, 'dist')),
    workerBuildArtifact: directoryArtifactHash('/tmp/pennant-pursuit-validation-worker-build'),
    pagesFunctionsBuildArtifact: directoryArtifactHash('/tmp/pennant-pursuit-pages-c4-build'),
  })
}
