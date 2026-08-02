import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { validateReleasePackage } from './lib/preview-release/artifacts.mjs'
import { executeReleasePackage } from './lib/preview-release/release-execution.mjs'
import { canonicalJson } from './lib/preview-release/canonical.mjs'
import {
  createOfflineRemoteObservation,
  createUnavailableRemoteEvidence,
  parseRemoteObservationArtifact,
  REMOTE_EVIDENCE_AVAILABILITY,
  REMOTE_EVIDENCE_COMPLETENESS,
  REMOTE_MIGRATION_KEYS,
  REMOTE_OBSERVATION_COMPARISONS,
  REMOTE_OBSERVATION_KIND,
  REMOTE_OBSERVATION_LOCAL_EXPECTATIONS,
  REMOTE_OBSERVATION_SCHEMA_VERSION,
  REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION,
  REMOTE_RESOURCE_KEYS,
  renderRemoteObservationJson,
  validateRemoteEvidence,
  validateRemoteObservationArtifact,
} from './lib/release-inspection/remote-contracts.mjs'
import {
  assertPaginationBudget,
  assertReviewedRouteZoneBudget,
  assertSerializedObservationBudget,
  BACKEND_SCHEMA_VERSION_SQL,
  consumeRequestBudget,
  createPreviewOperationRequest,
  createRequestBudget,
  MIGRATION_ROWS_SQL,
  MIGRATION_TABLE_DISCOVERY_SQL,
  parseStrictRemoteJson,
  PREVIEW_ENDPOINT_FAMILIES,
  PREVIEW_OPERATION_NAMES,
  PREVIEW_OPERATION_REGISTRY,
  REMOTE_OBSERVATION_LIMITS,
  validateD1SelectBody,
  validateObservationCredentialEnvironment,
  validatePreviewOperationRequest,
  validateRemoteObservationLimits,
} from './lib/release-inspection/remote-transport.mjs'
import { assertReleaseInspectionIntrinsicIntegrity } from './lib/release-inspection/intrinsic-integrity.mjs'
import { assertNoReleaseInspectionArtifactForLegacyExecution } from './lib/release-inspection/markers.mjs'
import { RELEASE_INSPECTION_CAPABILITIES, RELEASE_INSPECTION_SURFACES } from './lib/release-inspection/contracts.mjs'
import {
  parseReleaseInspectionObserveArguments,
  renderOfflineRemoteObservationSummary,
  runReleaseInspectionObserveCli,
} from './release-inspection-observe.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const encoder = new TextEncoder()
const ACCOUNT_ID = 'a'.repeat(32)
const ZONE_ID = 'b'.repeat(32)
const DATABASE_ID = 'ba6255b4-9425-4863-b10f-79149180f75a'
const PRODUCTION_DATABASE_ID = '4b821c17-b88b-462d-a2ed-c6a2113cc362'
const CAPTURE_STARTED_AT_MS = 1_785_585_600_000
const FIRST_READ_COMPLETED_AT_MS = CAPTURE_STARTED_AT_MS + 1_000
const SECOND_READ_STARTED_AT_MS = CAPTURE_STARTED_AT_MS + 3_000
const SECOND_READ_COMPLETED_AT_MS = CAPTURE_STARTED_AT_MS + 4_000
const CAPTURE_COMPLETED_AT_MS = SECOND_READ_COMPLETED_AT_MS
const EXPIRES_AT_MS = SECOND_READ_COMPLETED_AT_MS + 300_000
const ONLINE_NOW_MS = SECOND_READ_COMPLETED_AT_MS + 1_000
const ONLINE_TIME_CONTEXT = Object.freeze({ nowMs: ONLINE_NOW_MS })
const identity = Object.freeze({
  accountId: ACCOUNT_ID,
  pagesProject: 'diamond-draft',
  workerName: 'pennant-pursuit-validation-preview',
  databaseId: DATABASE_ID,
  routeZoneIds: [ZONE_ID],
})
const resourceOperations = Object.freeze({
  account: 'account',
  accountZones: 'account-zones',
  pagesProject: 'pages-project',
  pagesPreviewDeployments: 'pages-preview-deployments',
  workerSettings: 'worker-settings',
  workerDeployments: 'worker-deployments',
  workerPublicUrl: 'worker-subdomain',
  workerSchedules: 'worker-schedules',
  workerCustomDomains: 'worker-custom-domains',
  workerRoutes: 'worker-routes',
  d1Database: 'd1-database',
})
const migrationOperations = Object.freeze({
  tableDiscovery: 'migration-table-discovery',
  migrationRows: 'migration-rows',
  backendSchemaVersion: 'backend-schema-version',
})
const applicableSurfaces = Object.freeze({
  leaderboardRead: ['frontend', 'pages'],
  identityClaim: ['frontend', 'pages', 'worker'],
  identityStatus: ['frontend', 'pages', 'worker'],
  identityRename: ['frontend', 'pages', 'worker'],
  draftSubmission: ['frontend', 'pages', 'worker'],
  identityRecovery: ['frontend', 'pages', 'worker'],
  cleanupCron: ['worker', 'schedule'],
})
const surfaceOperations = Object.freeze({
  frontend: 'pages-project',
  pages: 'pages-project',
  worker: 'worker-settings',
  schedule: 'worker-schedules',
})

function matchingEvidence(operation) {
  const definition = PREVIEW_OPERATION_REGISTRY[operation]
  return {
    availability: 'available',
    completeness: 'complete',
    comparison: 'MATCH',
    expected: 'disabled',
    observed: 'disabled',
    reason: 'observed-match',
    endpointFamily: definition.endpointFamily,
    operation,
    httpMethod: definition.method,
    readOrdinals: [1, 2],
    capturedAtMs: {
      firstRead: FIRST_READ_COMPLETED_AT_MS,
      secondRead: SECOND_READ_COMPLETED_AT_MS,
    },
  }
}

function completeOnlineMatchArtifact() {
  const artifact = clonedOfflineArtifact()
  artifact.capture = {
    mode: 'online-preview',
    captureStartedAtMs: CAPTURE_STARTED_AT_MS,
    captureCompletedAtMs: CAPTURE_COMPLETED_AT_MS,
    expiresAtMs: EXPIRES_AT_MS,
    freshnessStatus: 'fresh',
    credentialScope: 'unverified',
    reviewedRouteZoneCount: 1,
    requestCounts: { firstRead: 14, secondRead: 14, total: 28 },
    stableRead: {
      status: 'stable',
      delayMs: 2_000,
      firstReadCompletedAtMs: FIRST_READ_COMPLETED_AT_MS,
      secondReadStartedAtMs: SECOND_READ_STARTED_AT_MS,
      secondReadCompletedAtMs: SECOND_READ_COMPLETED_AT_MS,
      firstSemanticHash: 'a'.repeat(64),
      secondSemanticHash: 'a'.repeat(64),
    },
    pagination: {
      accountZones: { completeness: 'complete', pagesRead: 1, recordsRead: 1 },
      pagesPreviewDeployments: { completeness: 'complete', pagesRead: 1, recordsRead: 1 },
      workerCustomDomains: { completeness: 'complete', pagesRead: 1, recordsRead: 0 },
    },
    responseCompleteness: 'complete',
  }
  artifact.environments.preview.contactStatus = 'attempted'
  artifact.environments.preview.comparison = 'MATCH'
  artifact.environments.preview.completeness = 'complete'
  artifact.environments.preview.reason = 'observed-match'
  for (const [key, operation] of Object.entries(resourceOperations)) {
    artifact.environments.preview.resources[key] = matchingEvidence(operation)
  }
  for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
    artifact.environments.preview.capabilities[capability].comparison = 'MATCH'
    for (const surface of applicableSurfaces[capability]) {
      artifact.environments.preview.capabilities[capability].surfaces[surface] = matchingEvidence(surfaceOperations[surface])
    }
  }
  for (const [key, operation] of Object.entries(migrationOperations)) {
    artifact.environments.preview.migrationObservation[key] = matchingEvidence(operation)
  }
  return artifact
}

function clonedOfflineArtifact() {
  return structuredClone(createOfflineRemoteObservation())
}

function validateOnlineArtifact(artifact, nowMs = ONLINE_NOW_MS) {
  return validateRemoteObservationArtifact(artifact, { nowMs })
}

function exportNames(source) {
  return new Set([...source.matchAll(/^export (?:const|function|class) ([A-Za-z_$][\w$]*)/gmu)]
    .map((match) => match[1]))
}

function localModuleGraph(entryPath) {
  const pending = [entryPath]
  const visited = new Set()
  const modules = []
  while (pending.length > 0) {
    const modulePath = pending.pop()
    if (visited.has(modulePath)) continue
    visited.add(modulePath)
    const source = readFileSync(modulePath, 'utf8')
    modules.push({ modulePath, source })
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
      if (!match[1].startsWith('.')) continue
      const resolved = path.resolve(path.dirname(modulePath), match[1])
      if (resolved.endsWith('.mjs')) pending.push(resolved)
    }
  }
  return modules
}

function capturePrototypeRejection(prototype, key, descriptor, operation) {
  const original = Object.getOwnPropertyDescriptor(prototype, key)
  let caught = null
  if (descriptor === null) delete prototype[key]
  else Object.defineProperty(prototype, key, descriptor)
  try {
    operation()
  } catch (error) {
    caught = error
  } finally {
    if (original) Object.defineProperty(prototype, key, original)
    else delete prototype[key]
  }
  assert.ok(caught instanceof Error, `${String(key)} mutation was accepted`)
  assert.match(caught.message, /intrinsic integrity/i, String(key))
  assert.ok(caught.message.length < 1_024, String(key))
  assert.doesNotThrow(
    () => assertReleaseInspectionIntrinsicIntegrity(),
    `${String(key)} mutation was not exactly restored`,
  )
}

function captureZeroReadPublicEntryRejection(owner, key, invoke, label) {
  const reflectDefineProperty = Reflect.defineProperty
  const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor
  const original = reflectGetOwnPropertyDescriptor(owner, key)
  assert.ok(original?.configurable, `${label} helper must be configurable for isolated testing`)
  let inputReads = 0
  let replacementCalls = 0
  let caught = null
  let returned = false
  const trap = () => {
    inputReads += 1
    throw new Error(`${label} input was read`)
  }
  const input = new Proxy(Object.create(null), {
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    ownKeys: trap,
  })
  reflectDefineProperty(owner, key, {
    ...original,
    value: function releaseInspectionTargetedReplacement() {
      replacementCalls += 1
      throw new Error(`${label} replacement was invoked`)
    },
  })
  try {
    try {
      invoke(input)
      returned = true
    } catch (error) {
      caught = error
    }
  } finally {
    reflectDefineProperty(owner, key, original)
  }
  assert.equal(returned, false, `${label} returned under intrinsic mutation`)
  assert.match(caught?.message ?? '', /intrinsic integrity/i, label)
  assert.equal(replacementCalls, 0, `${label} invoked the replaced helper`)
  assert.equal(inputReads, 0, `${label} read caller input before refusal`)
  assert.doesNotThrow(() => assertReleaseInspectionIntrinsicIntegrity(), `${label} was not restored`)
}

function runIsolatedIntrinsicMutationGroup(groupName, specs) {
  const intrinsicUrl = pathToFileURL(path.join(
    repositoryRoot,
    'scripts/lib/release-inspection/intrinsic-integrity.mjs',
  )).href
  const contractsUrl = pathToFileURL(path.join(
    repositoryRoot,
    'scripts/lib/release-inspection/remote-contracts.mjs',
  )).href
  const transportUrl = pathToFileURL(path.join(
    repositoryRoot,
    'scripts/lib/release-inspection/remote-transport.mjs',
  )).href
  const observeUrl = pathToFileURL(path.join(
    repositoryRoot,
    'scripts/release-inspection-observe.mjs',
  )).href
  const source = `
    const specs = ${JSON.stringify(specs)};
    const markers = ${JSON.stringify([
      'pennant-pursuit-validation-production',
      PRODUCTION_DATABASE_ID,
      '16204021',
      'PENNANT_PREVIEW_API_TOKEN',
      'secret_value',
      '--token=synthetic-sentinel',
      'artifactKind',
      'toolContractVersion',
      'capabilityMatrix',
      'remoteObservation',
      'productionContacted',
      'MATCH',
      'NO-OP',
      'AUTHORIZED',
      '1.5',
    ])};
    const { assertReleaseInspectionIntrinsicIntegrity } = await import(${JSON.stringify(intrinsicUrl)});
    const remoteContracts = await import(${JSON.stringify(contractsUrl)});
    const remoteTransport = await import(${JSON.stringify(transportUrl)});
    const observer = await import(${JSON.stringify(observeUrl)});
    const reflectApply = Reflect.apply;
    const reflectDefineProperty = Reflect.defineProperty;
    const reflectDeleteProperty = Reflect.deleteProperty;
    const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
    const reflectGetPrototypeOf = Reflect.getPrototypeOf;
    const reflectSetPrototypeOf = Reflect.setPrototypeOf;
    const symbolIterator = Symbol.iterator;
    const ownerFactories = {
      globalThis: () => globalThis,
      Array: () => Array,
      'Array.prototype': () => Array.prototype,
      ArrayIteratorPrototype: () => reflectGetPrototypeOf(reflectApply(Array.prototype[symbolIterator], [], [])),
      Buffer: () => Buffer,
      Date: () => Date,
      Function: () => Function,
      'Function.prototype': () => Function.prototype,
      JSON: () => JSON,
      Map: () => Map,
      'Map.prototype': () => Map.prototype,
      MapIteratorPrototype: () => reflectGetPrototypeOf(reflectApply(Map.prototype[symbolIterator], new Map(), [])),
      Math: () => Math,
      Number: () => Number,
      Object: () => Object,
      'Object.prototype': () => Object.prototype,
      Reflect: () => Reflect,
      RegExp: () => RegExp,
      'RegExp.prototype': () => RegExp.prototype,
      Set: () => Set,
      'Set.prototype': () => Set.prototype,
      SetIteratorPrototype: () => reflectGetPrototypeOf(reflectApply(Set.prototype[symbolIterator], new Set(), [])),
      String: () => String,
      'String.prototype': () => String.prototype,
      StringIteratorPrototype: () => reflectGetPrototypeOf(reflectApply(String.prototype[symbolIterator], '', [])),
      Symbol: () => Symbol,
      TextDecoder: () => TextDecoder,
      'TextDecoder.prototype': () => TextDecoder.prototype,
      Uint8Array: () => Uint8Array,
      'Uint8Array.prototype': () => Uint8Array.prototype,
      URL: () => URL,
      'URL.prototype': () => URL.prototype,
      URLSearchParams: () => URLSearchParams,
      'URLSearchParams.prototype': () => URLSearchParams.prototype,
      WeakSet: () => WeakSet,
      'WeakSet.prototype': () => WeakSet.prototype,
    };
    const resolveKey = (key) => key === '@@iterator'
      ? symbolIterator
      : key === '@@replace'
        ? Symbol.replace
        : key;
    const expectedFunctionExports = {
      remoteContracts: [
        'createOfflineRemoteObservation',
        'createUnavailableRemoteEvidence',
        'parseRemoteObservationArtifact',
        'renderRemoteObservationJson',
        'validateRemoteEvidence',
        'validateRemoteObservationArtifact',
      ],
      remoteTransport: [
        'assertPaginationBudget',
        'assertReviewedRouteZoneBudget',
        'assertSerializedObservationBudget',
        'consumeRequestBudget',
        'createPreviewOperationRequest',
        'createRequestBudget',
        'parseStrictRemoteJson',
        'validateD1SelectBody',
        'validateObservationCredentialEnvironment',
        'validatePreviewOperationRequest',
        'validateRemoteObservationLimits',
      ],
      observer: [
        'parseReleaseInspectionObserveArguments',
        'renderOfflineRemoteObservationSummary',
        'runReleaseInspectionObserveCli',
      ],
    };
    for (const [namespaceName, namespace] of [
      ['remoteContracts', remoteContracts],
      ['remoteTransport', remoteTransport],
      ['observer', observer],
    ]) {
      const actual = Object.keys(namespace).filter((key) => typeof namespace[key] === 'function').sort();
      const expected = expectedFunctionExports[namespaceName];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(namespaceName + ' exported-function inventory changed: ' + JSON.stringify(actual));
      }
    }
    let sensitiveReads = 0;
    let replacementCalls = 0;
    const trap = () => {
      sensitiveReads += 1;
      throw 'sensitive dependency was read';
    };
    const opaque = new Proxy(Object.create(null), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    const opaqueArgs = new Proxy([], {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    const publicEntries = [
      { name: 'remote-contracts.createOfflineRemoteObservation', invoke: () => remoteContracts.createOfflineRemoteObservation() },
      { name: 'remote-contracts.createUnavailableRemoteEvidence', invoke: () => remoteContracts.createUnavailableRemoteEvidence(opaque) },
      { name: 'remote-contracts.parseRemoteObservationArtifact', invoke: () => remoteContracts.parseRemoteObservationArtifact(opaque, opaque) },
      { name: 'remote-contracts.renderRemoteObservationJson', invoke: () => remoteContracts.renderRemoteObservationJson(opaque, opaque) },
      { name: 'remote-contracts.validateRemoteEvidence', invoke: () => remoteContracts.validateRemoteEvidence(opaque) },
      { name: 'remote-contracts.validateRemoteObservationArtifact', invoke: () => remoteContracts.validateRemoteObservationArtifact(opaque, opaque) },
      { name: 'remote-transport.assertPaginationBudget', invoke: () => remoteTransport.assertPaginationBudget(opaque) },
      { name: 'remote-transport.assertReviewedRouteZoneBudget', invoke: () => remoteTransport.assertReviewedRouteZoneBudget(opaque) },
      { name: 'remote-transport.assertSerializedObservationBudget', invoke: () => remoteTransport.assertSerializedObservationBudget(opaque) },
      { name: 'remote-transport.consumeRequestBudget', invoke: () => remoteTransport.consumeRequestBudget(opaque, opaque, opaque) },
      { name: 'remote-transport.createPreviewOperationRequest', invoke: () => remoteTransport.createPreviewOperationRequest(opaque, opaque, opaque) },
      { name: 'remote-transport.createRequestBudget', invoke: () => remoteTransport.createRequestBudget(opaque) },
      { name: 'remote-transport.parseStrictRemoteJson', invoke: () => remoteTransport.parseStrictRemoteJson(opaque) },
      { name: 'remote-transport.validateD1SelectBody', invoke: () => remoteTransport.validateD1SelectBody(opaque, opaque) },
      { name: 'remote-transport.validateObservationCredentialEnvironment', invoke: () => remoteTransport.validateObservationCredentialEnvironment(opaque) },
      { name: 'remote-transport.validatePreviewOperationRequest', invoke: () => remoteTransport.validatePreviewOperationRequest(opaque, opaque) },
      { name: 'remote-transport.validateRemoteObservationLimits', invoke: () => remoteTransport.validateRemoteObservationLimits(opaque) },
      { name: 'observer.parseReleaseInspectionObserveArguments', invoke: () => observer.parseReleaseInspectionObserveArguments(opaqueArgs) },
      { name: 'observer.renderOfflineRemoteObservationSummary', invoke: () => observer.renderOfflineRemoteObservationSummary(opaque) },
      { name: 'observer.runReleaseInspectionObserveCli', invoke: () => observer.runReleaseInspectionObserveCli(opaqueArgs, opaque) },
    ];
    const coveredPublicEntries = new Array(publicEntries.length).fill(false);
    let publicEntryCursor = 0;
    function invokeProtectedEntry() {
      const entryIndex = publicEntryCursor % publicEntries.length;
      const entry = publicEntries[entryIndex];
      publicEntryCursor += 1;
      coveredPublicEntries[entryIndex] = true;
      sensitiveReads = 0;
      replacementCalls = 0;
      let caught = null;
      let returned = false;
      try {
        entry.invoke();
        returned = true;
      } catch (error) {
        caught = error;
      }
      return { caught, entryName: entry.name, replacementCalls, returned, sensitiveReads };
    }
    function assertRejected(result, label, marker) {
      const message = result.caught && typeof result.caught.message === 'string'
        ? result.caught.message
        : '';
      if (!/intrinsic integrity/iu.test(message)) {
        throw new Error(label + ' did not fail through intrinsic integrity: ' + message);
      }
      if (result.sensitiveReads !== 0) {
        throw new Error(label + ' via ' + result.entryName + ' performed a sensitive read before refusing.');
      }
      if (result.replacementCalls !== 0) {
        throw new Error(label + ' via ' + result.entryName + ' invoked the replaced helper before refusing.');
      }
      if (result.returned) {
        throw new Error(label + ' via ' + result.entryName + ' returned under intrinsic mutation.');
      }
      if (message.includes(marker)) {
        throw new Error(label + ' leaked its injected marker.');
      }
      assertReleaseInspectionIntrinsicIntegrity();
    }
    function mutateDescriptor(owner, key, descriptor, label, marker) {
      const original = reflectGetOwnPropertyDescriptor(owner, key);
      if (!original || original.configurable !== true) {
        throw new Error(label + ' is not safely configurable for isolated testing.');
      }
      let result;
      if (descriptor === null) reflectDeleteProperty(owner, key);
      else reflectDefineProperty(owner, key, descriptor);
      try {
        result = invokeProtectedEntry();
      } finally {
        reflectDefineProperty(owner, key, original);
      }
      assertRejected(result, label, marker);
    }
    const uniqueOwnerNames = [];
    for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
      const spec = specs[specIndex];
      const owner = ownerFactories[spec.owner]();
      const key = resolveKey(spec.key);
      const original = reflectGetOwnPropertyDescriptor(owner, key);
      if (!original || original.configurable !== true) {
        throw new Error(spec.owner + '.' + spec.key + ' is not configurable.');
      }
      if (!uniqueOwnerNames.includes(spec.owner)) uniqueOwnerNames.push(spec.owner);
      const marker = markers[specIndex % markers.length];
      const revoked = Proxy.revocable(original.value, {});
      revoked.revoke();
      const variants = [
        ['replacement-function', {
          configurable: true,
          enumerable: original.enumerable,
          writable: true,
          value: function releaseInspectionInjectedHelper() {
            replacementCalls += 1;
            return marker;
          },
        }],
        ['getter', {
          configurable: true,
          enumerable: original.enumerable,
          get() {
            replacementCalls += 1;
            return marker;
          },
        }],
        ['setter', {
          configurable: true,
          enumerable: original.enumerable,
          set() {
            replacementCalls += 1;
            throw marker;
          },
        }],
        ['data-value', {
          configurable: true,
          enumerable: original.enumerable,
          writable: true,
          value: marker,
        }],
        ['proxy-value', {
          configurable: true,
          enumerable: original.enumerable,
          writable: true,
          value: new Proxy(original.value, {}),
        }],
        ['revoked-proxy-value', {
          configurable: true,
          enumerable: original.enumerable,
          writable: true,
          value: revoked.proxy,
        }],
        ['exotic-object-value', {
          configurable: true,
          enumerable: original.enumerable,
          writable: true,
          value: Object.create(null),
        }],
        ['descriptor-flags', {
          ...original,
          enumerable: !original.enumerable,
        }],
        ['removed', null],
      ];
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        const [variantName, descriptor] = variants[variantIndex];
        mutateDescriptor(
          owner,
          key,
          descriptor,
          spec.owner + '.' + spec.key + ':' + variantName,
          marker,
        );
      }
      if (typeof original.value === 'function') {
        const nestedSymbol = Symbol('release-inspection-nested-' + specIndex);
        let nestedResult;
        reflectDefineProperty(original.value, nestedSymbol, {
          configurable: true,
          value: marker,
          writable: true,
        });
        try {
          nestedResult = invokeProtectedEntry();
        } finally {
          reflectDeleteProperty(original.value, nestedSymbol);
        }
        assertRejected(nestedResult, spec.owner + '.' + spec.key + ':nested-symbol', marker);
      }
    }
    for (let ownerIndex = 0; ownerIndex < uniqueOwnerNames.length; ownerIndex += 1) {
      const ownerName = uniqueOwnerNames[ownerIndex];
      if (ownerName === 'globalThis') continue;
      const owner = ownerFactories[ownerName]();
      const marker = markers[ownerIndex % markers.length];
      const addedSymbol = Symbol('release-inspection-owner-' + ownerIndex);
      let symbolResult;
      reflectDefineProperty(owner, addedSymbol, {
        configurable: true,
        value: marker,
        writable: true,
      });
      try {
        symbolResult = invokeProtectedEntry();
      } finally {
        reflectDeleteProperty(owner, addedSymbol);
      }
      assertRejected(symbolResult, ownerName + ':added-symbol', marker);

      const originalPrototype = reflectGetPrototypeOf(owner);
      let prototypeResult;
      const prototypeChanged = reflectSetPrototypeOf(owner, { releaseInspectionMarker: marker });
      if (!prototypeChanged) continue;
      try {
        prototypeResult = invokeProtectedEntry();
      } finally {
        reflectSetPrototypeOf(owner, originalPrototype);
      }
      assertRejected(prototypeResult, ownerName + ':prototype-link', marker);
    }
    const uncoveredPublicEntries = publicEntries
      .filter((entry, index) => !coveredPublicEntries[index])
      .map((entry) => entry.name);
    if (uncoveredPublicEntries.length !== 0) {
      throw new Error('public entries lacked direct mutation coverage: ' + uncoveredPublicEntries.join(', '));
    }
    const validUnavailable = remoteContracts.createUnavailableRemoteEvidence();
    if (validUnavailable.reason !== 'offline-observation-not-attempted') {
      throw new Error('valid unavailable evidence failed after intrinsic restoration.');
    }
    const validBudget = remoteTransport.createRequestBudget('full-read');
    if (validBudget.maximum !== 64 || validBudget.remaining !== 64 || validBudget.used !== 0) {
      throw new Error('valid request budget failed after intrinsic restoration.');
    }
    const validArguments = observer.parseReleaseInspectionObserveArguments(['--offline', '--json']);
    if (validArguments.mode !== 'offline' || validArguments.json !== true) {
      throw new Error('valid observer arguments failed after intrinsic restoration.');
    }
    assertReleaseInspectionIntrinsicIntegrity();
    process.stdout.write(JSON.stringify({
      group: ${JSON.stringify(groupName)},
      cases: specs.length,
      publicEntries: publicEntries.length,
    }));
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
  })
  assert.equal(result.status, 0, `${groupName}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  assert.equal(result.signal, null, groupName)
  assert.deepEqual(JSON.parse(result.stdout), {
    group: groupName,
    cases: specs.length,
    publicEntries: 20,
  })
}

test('offline artifact uses the exact additive kind, integer schema token, tool contract, and immutable local hashes', () => {
  const artifact = createOfflineRemoteObservation()
  assert.equal(artifact.kind, 'pennant-pursuit-release-inspection-remote-observation')
  assert.equal(artifact.kind, REMOTE_OBSERVATION_KIND)
  assert.equal(artifact.schemaVersion, REMOTE_OBSERVATION_SCHEMA_VERSION)
  assert.equal(artifact.toolContractVersion, REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION)
  assert.deepEqual(artifact.localExpectations, REMOTE_OBSERVATION_LOCAL_EXPECTATIONS)
  assert.equal(Object.isFrozen(artifact), true)
  assert.equal(Object.isFrozen(artifact.localExpectations.protectedSourceHashes), true)
  assert.equal(artifact.releaseCurrentness, 'UNKNOWN')
  assert.equal(artifact.executionAuthorization, 'prohibited')
  assert.equal(artifact.noRemoteMutation, true)
  assert.equal(artifact.noFilesystemWrites, true)
  assert.equal(artifact.noSecretValues, true)
  assert.equal(artifact.productionContacted, false)
  assert.deepEqual(validateRemoteObservationArtifact(artifact), artifact)

  const serialized = renderRemoteObservationJson(artifact)
  assert.equal(serialized.endsWith('\n'), true)
  assert.deepEqual(parseRemoteObservationArtifact(serialized), artifact)
  for (const token of ['1.0', '1e0', '01', '+1', '-1', '2', '"1"', 'null']) {
    assert.throws(
      () => parseRemoteObservationArtifact(serialized.replace('"schemaVersion":1', `"schemaVersion":${token}`)),
      /exact integer token|version|contract/i,
      token,
    )
  }
})

test('artifact has exactly seven capabilities, four surfaces, closed resources, and closed migration evidence', () => {
  const preview = createOfflineRemoteObservation().environments.preview
  assert.deepEqual(Object.keys(preview.capabilities), [...RELEASE_INSPECTION_CAPABILITIES].sort())
  for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
    assert.deepEqual(Object.keys(preview.capabilities[capability].surfaces), [...RELEASE_INSPECTION_SURFACES].sort())
    assert.equal(preview.capabilities[capability].comparison, 'UNAVAILABLE')
  }
  assert.deepEqual(Object.keys(preview.resources), [...REMOTE_RESOURCE_KEYS].sort())
  assert.deepEqual(Object.keys(preview.migrationObservation), [...REMOTE_MIGRATION_KEYS].sort())
  assert.equal(preview.resources.secretPresence.reason, 'secret-presence-contract-unavailable')
  assert.equal(preview.migrationObservation.appliedSourceHashes.availability, 'unavailable')
  assert.deepEqual(createOfflineRemoteObservation().environments.production, {
    contactStatus: 'not-attempted',
    comparison: 'UNAVAILABLE',
    completeness: 'not-attempted',
    reason: 'production-remote-inspection-excluded',
    remoteEvidence: 'excluded',
  })
})

test('closed vocabularies and evidence semantic combinations reject contradictions and unsafe values', () => {
  assert.deepEqual(REMOTE_OBSERVATION_COMPARISONS, ['MATCH', 'DRIFT', 'UNKNOWN', 'UNAVAILABLE'])
  assert.deepEqual(REMOTE_EVIDENCE_AVAILABILITY, ['available', 'unavailable', 'not-applicable'])
  assert.deepEqual(REMOTE_EVIDENCE_COMPLETENESS, ['complete', 'partial', 'not-attempted', 'not-applicable'])
  const match = {
    availability: 'available',
    completeness: 'complete',
    comparison: 'MATCH',
    expected: ['disabled', true, 0, null],
    observed: ['disabled', true, 0, null],
    reason: 'observed-match',
    endpointFamily: 'account',
    operation: 'account',
    httpMethod: 'GET',
    readOrdinals: [1, 2],
    capturedAtMs: {
      firstRead: FIRST_READ_COMPLETED_AT_MS,
      secondRead: SECOND_READ_COMPLETED_AT_MS,
    },
  }
  assert.deepEqual(validateRemoteEvidence(match), match)
  const drift = structuredClone(match)
  drift.comparison = 'DRIFT'
  drift.reason = 'observed-drift'
  drift.observed[0] = 'enabled'
  assert.deepEqual(validateRemoteEvidence(drift), drift)
  const partial = {
    availability: 'unavailable',
    completeness: 'partial',
    comparison: 'UNKNOWN',
    expected: 'disabled',
    observed: null,
    reason: 'malformed-response',
    endpointFamily: 'account',
    operation: 'account',
    httpMethod: 'GET',
    readOrdinals: [1],
    capturedAtMs: { firstRead: FIRST_READ_COMPLETED_AT_MS, secondRead: null },
  }
  assert.deepEqual(validateRemoteEvidence(partial), partial)
  for (const mutate of [
    (value) => { value.comparison = 'UNAVAILABLE' },
    (value) => { value.reason = 'observed-match' },
    (value) => { value.operation = 'not-applicable'; value.endpointFamily = 'not-applicable'; value.httpMethod = 'not-applicable' },
    (value) => {
      value.readOrdinals = []
      value.capturedAtMs = { firstRead: null, secondRead: null }
    },
  ]) {
    const candidate = structuredClone(partial)
    mutate(candidate)
    assert.throws(() => validateRemoteEvidence(candidate), /remote observation contract refused/i)
  }

  for (const mutate of [
    (value) => { value.future = true },
    (value) => { value.comparison = 'NO-OP' },
    (value) => { value.httpMethod = 'POST' },
    (value) => { value.capturedAtMs = { firstRead: null, secondRead: null } },
    (value) => { value.readOrdinals = [2, 1] },
    (value) => { value.observed = value.expected },
    (value) => { value.reason = 'observed-match' },
  ]) {
    const candidate = structuredClone(drift)
    mutate(candidate)
    assert.throws(() => validateRemoteEvidence(candidate), /remote observation contract refused/i)
  }
  for (const unsafe of [
    { secret: 'hidden' },
    { nested: { text: 'hidden' } },
    'Authorization: Bearer hidden',
    'contains secret material',
  ]) {
    const candidate = structuredClone(match)
    candidate.expected = unsafe
    candidate.observed = unsafe
    assert.throws(() => validateRemoteEvidence(candidate), /unsafe|secret-bearing|closed evidence-value/i)
  }
  const arbitraryObject = structuredClone(match)
  arbitraryObject.expected = { state: 'disabled' }
  arbitraryObject.observed = { state: 'disabled' }
  assert.throws(() => validateRemoteEvidence(arbitraryObject), /closed evidence-value/i)
  assert.throws(() => validateRemoteEvidence({ ...match, expected: 1n }), /unsupported|plain|JSON-compatible/i)
  assert.throws(() => validateRemoteEvidence(Object.create({ ...match })), /plain|evidence/i)
})

test('forged MATCH, currentness, authorization, Production contact, versions, and unknown fields fail closed', () => {
  for (const mutate of [
    (artifact) => { artifact.environments.preview.comparison = 'MATCH' },
    (artifact) => { artifact.releaseCurrentness = 'CURRENT' },
    (artifact) => { artifact.executionAuthorization = 'authorized' },
    (artifact) => { artifact.productionContacted = true },
    (artifact) => { artifact.noRemoteMutation = false },
    (artifact) => { artifact.noSecretValues = false },
    (artifact) => { artifact.schemaVersion = 2 },
    (artifact) => { artifact.toolContractVersion = 'release-inspection-read-only-observation-v2' },
    (artifact) => { artifact.future = true },
    (artifact) => { artifact.localExpectations.expectationHash = '0'.repeat(64) },
    (artifact) => { artifact.environments.production.remoteEvidence = 'observed' },
  ]) {
    const artifact = clonedOfflineArtifact()
    mutate(artifact)
    assert.throws(() => validateRemoteObservationArtifact(artifact), /remote observation contract refused/i)
  }

  const unknown = clonedOfflineArtifact()
  unknown.capture = {
    ...unknown.capture,
    mode: 'online-preview',
    captureStartedAtMs: CAPTURE_STARTED_AT_MS,
    captureCompletedAtMs: FIRST_READ_COMPLETED_AT_MS,
    expiresAtMs: null,
    freshnessStatus: 'unknown',
    responseCompleteness: 'partial',
    requestCounts: { firstRead: 1, secondRead: 0, total: 1 },
    stableRead: {
      ...unknown.capture.stableRead,
      firstReadCompletedAtMs: FIRST_READ_COMPLETED_AT_MS,
    },
  }
  unknown.environments.preview.contactStatus = 'attempted'
  unknown.environments.preview.comparison = 'UNKNOWN'
  unknown.environments.preview.completeness = 'partial'
  unknown.environments.preview.reason = 'observed-match'
  unknown.environments.preview.resources.account = {
    availability: 'unavailable',
    completeness: 'partial',
    comparison: 'UNKNOWN',
    expected: null,
    observed: null,
    reason: 'malformed-response',
    endpointFamily: 'account',
    operation: 'account',
    httpMethod: 'GET',
    readOrdinals: [1],
    capturedAtMs: { firstRead: FIRST_READ_COMPLETED_AT_MS, secondRead: null },
  }
  assert.throws(() => validateOnlineArtifact(unknown), /remote observation contract refused/i)
})

test('complete online MATCH binds every resource and migration slot to its exact operation', () => {
  const artifact = completeOnlineMatchArtifact()
  assert.equal(validateOnlineArtifact(artifact).environments.preview.comparison, 'MATCH')
  const slots = [
    ...Object.entries(resourceOperations).map(([key, operation]) => ['resources', key, operation]),
    ...Object.entries(migrationOperations).map(([key, operation]) => ['migrationObservation', key, operation]),
  ]
  for (const [inventory, key, requiredOperation] of slots) {
    for (const substitutedOperation of PREVIEW_OPERATION_NAMES) {
      if (substitutedOperation === requiredOperation) continue
      const candidate = completeOnlineMatchArtifact()
      candidate.environments.preview[inventory][key] = matchingEvidence(substitutedOperation)
      assert.throws(
        () => validateOnlineArtifact(candidate),
        /exact operation/i,
        `${inventory}.${key} accepted ${substitutedOperation}`,
      )
    }
  }
})

test('millisecond timeline binds both evidence reads, stable-read ordering, exact expiration, and injected freshness', () => {
  const artifact = completeOnlineMatchArtifact()
  assert.throws(
    () => validateRemoteObservationArtifact(artifact),
    /injected nowMs clock context/i,
  )
  assert.equal(validateOnlineArtifact(artifact).capture.expiresAtMs, EXPIRES_AT_MS)

  const completionLag = completeOnlineMatchArtifact()
  completionLag.capture.captureCompletedAtMs += 1_000
  assert.equal(
    validateOnlineArtifact(completionLag, completionLag.capture.captureCompletedAtMs).capture.expiresAtMs,
    SECOND_READ_COMPLETED_AT_MS + REMOTE_OBSERVATION_LIMITS.freshnessWindowMs,
  )

  for (const [label, mutate, pattern] of [
    ['first evidence before capture', (value) => {
      value.environments.preview.resources.account.capturedAtMs.firstRead = CAPTURE_STARTED_AT_MS - 1
    }, /first-read evidence timestamp/i],
    ['second evidence outside interval', (value) => {
      value.environments.preview.resources.account.capturedAtMs.secondRead = SECOND_READ_COMPLETED_AT_MS + 1
    }, /second-read evidence timestamp/i],
    ['ordinal 1 evidence during read 2', (value) => {
      value.environments.preview.resources.account.capturedAtMs.firstRead = SECOND_READ_STARTED_AT_MS
    }, /first-read evidence timestamp/i],
    ['ordinal 2 evidence during read 1', (value) => {
      value.environments.preview.resources.account.capturedAtMs.secondRead = FIRST_READ_COMPLETED_AT_MS
    }, /second-read evidence timestamp/i],
    ['missing explicit second timestamp', (value) => {
      value.environments.preview.resources.account.capturedAtMs.secondRead = null
    }, /ordinals.*capturedAtMs|capturedAtMs.*ordinals/i],
    ['swapped read intervals', (value) => {
      value.capture.stableRead.secondReadStartedAtMs = FIRST_READ_COMPLETED_AT_MS - 1
    }, /stable-read hashes, timestamps, or ordinals/i],
    ['stable delay too short', (value) => {
      value.capture.stableRead.secondReadStartedAtMs = FIRST_READ_COMPLETED_AT_MS
        + REMOTE_OBSERVATION_LIMITS.stableReadDelayMs - 1
    }, /stable-read hashes, timestamps, or ordinals/i],
    ['second completion before start', (value) => {
      value.capture.stableRead.secondReadCompletedAtMs = SECOND_READ_STARTED_AT_MS - 1
    }, /stable-read hashes, timestamps, or ordinals/i],
    ['capture completion before second read', (value) => {
      value.capture.captureCompletedAtMs = SECOND_READ_COMPLETED_AT_MS - 1
    }, /stable-read hashes, timestamps, or ordinals/i],
    ['expiration tied to wrong boundary', (value) => {
      value.capture.expiresAtMs = value.capture.captureCompletedAtMs
        + REMOTE_OBSERVATION_LIMITS.freshnessWindowMs + 1
    }, /stable-read hashes, timestamps, or ordinals/i],
    ['string timestamp', (value) => {
      value.capture.captureStartedAtMs = '1785585600000'
    }, /timestamps|capture metadata/i],
    ['unsafe integer timestamp', (value) => {
      value.capture.captureCompletedAtMs = Number.MAX_SAFE_INTEGER + 1
    }, /timestamps|capture metadata/i],
    ['fractional timestamp', (value) => {
      value.capture.stableRead.firstReadCompletedAtMs += 0.5
    }, /timestamps|capture metadata/i],
    ['negative timestamp', (value) => {
      value.capture.captureStartedAtMs = -1
    }, /timestamps|capture metadata/i],
    ['mixed 2026 and 2040 timeline', (value) => {
      value.capture.stableRead.secondReadStartedAtMs = 2_208_988_800_000
      value.capture.stableRead.secondReadCompletedAtMs = 2_208_988_801_000
    }, /stable-read hashes, timestamps, or ordinals/i],
  ]) {
    const candidate = completeOnlineMatchArtifact()
    mutate(candidate)
    assert.throws(() => validateOnlineArtifact(candidate), pattern, label)
  }

  assert.throws(
    () => validateOnlineArtifact(
      completeOnlineMatchArtifact(),
      CAPTURE_COMPLETED_AT_MS - REMOTE_OBSERVATION_LIMITS.maximumFutureClockSkewMs - 1,
    ),
    /future-dated.*clock tolerance/i,
  )
  assert.equal(
    validateOnlineArtifact(
      completeOnlineMatchArtifact(),
      CAPTURE_COMPLETED_AT_MS - REMOTE_OBSERVATION_LIMITS.maximumFutureClockSkewMs,
    ).environments.preview.comparison,
    'MATCH',
  )

  const stale = completeOnlineMatchArtifact()
  stale.capture.freshnessStatus = 'stale'
  assert.throws(
    () => validateOnlineArtifact(stale, EXPIRES_AT_MS + 1),
    /MATCH requires stable complete matching|required observable fields/i,
  )
  const contradictoryFreshness = completeOnlineMatchArtifact()
  assert.throws(
    () => validateOnlineArtifact(contradictoryFreshness, EXPIRES_AT_MS + 1),
    /freshness contradicts/i,
  )

  const offlineTimestamp = clonedOfflineArtifact()
  offlineTimestamp.capture.captureStartedAtMs = CAPTURE_STARTED_AT_MS
  assert.throws(
    () => validateRemoteObservationArtifact(offlineTimestamp),
    /offline capture metadata/i,
  )
  const offlineEvidenceTimestamp = clonedOfflineArtifact()
  offlineEvidenceTimestamp.environments.preview.resources.account.capturedAtMs.firstRead = CAPTURE_STARTED_AT_MS
  assert.throws(
    () => validateRemoteObservationArtifact(offlineEvidenceTimestamp),
    /capturedAtMs|ordinals|offline evidence/i,
  )

  const canonicalOnline = renderRemoteObservationJson(
    completeOnlineMatchArtifact(),
    ONLINE_TIME_CONTEXT,
  )
  const exponentTimestamp = canonicalOnline.replace(
    `"captureStartedAtMs":${CAPTURE_STARTED_AT_MS}`,
    '"captureStartedAtMs":1.7855856e12',
  )
  assert.notEqual(exponentTimestamp, canonicalOnline)
  assert.throws(
    () => parseRemoteObservationArtifact(exponentTimestamp, ONLINE_TIME_CONTEXT),
    /exact nonnegative integer tokens/i,
  )
})

test('completed online evidence requires exact [1, 2] ordinals for every required slot', () => {
  const sparse = new Array(2)
  sparse[0] = 1
  const invalidOrdinals = [
    [1],
    [2],
    [2, 1],
    [1, 1],
    [1, 2, 2],
    [1.5, 2],
    ['1', 2],
    sparse,
  ]
  const slots = [
    ...Object.keys(resourceOperations).map((key) => ['resources', key]),
    ...Object.keys(migrationOperations).map((key) => ['migrationObservation', key]),
    ...RELEASE_INSPECTION_CAPABILITIES.flatMap((capability) => (
      applicableSurfaces[capability].map((surface) => ['capabilities', capability, surface])
    )),
  ]
  for (const slot of slots) {
    for (const readOrdinals of invalidOrdinals) {
      const candidate = completeOnlineMatchArtifact()
      const evidence = slot[0] === 'capabilities'
        ? candidate.environments.preview.capabilities[slot[1]].surfaces[slot[2]]
        : candidate.environments.preview[slot[0]][slot[1]]
      evidence.readOrdinals = readOrdinals
      assert.throws(
        () => validateOnlineArtifact(candidate),
        /ordinals|capturedAtMs|plain|data elements|vocabulary/i,
        `${slot.join('.')}: ${JSON.stringify(readOrdinals)}`,
      )
    }
  }
})

test('request accounting is derived from pagination, route-zone count, and stable double-read graph', () => {
  const valid = completeOnlineMatchArtifact()
  valid.capture.pagination.accountZones.pagesRead = 2
  valid.capture.pagination.accountZones.recordsRead = 26
  valid.capture.requestCounts = { firstRead: 15, secondRead: 15, total: 30 }
  assert.equal(validateOnlineArtifact(valid).environments.preview.comparison, 'MATCH')

  for (const mutate of [
    (artifact) => { artifact.capture.requestCounts = { firstRead: 1, secondRead: 1, total: 2 } },
    (artifact) => { artifact.capture.requestCounts = { firstRead: 14, secondRead: 13, total: 27 } },
    (artifact) => { artifact.capture.requestCounts = { firstRead: 14, secondRead: 14, total: 27 } },
    (artifact) => { artifact.capture.requestCounts = { firstRead: 65, secondRead: 14, total: 79 } },
    (artifact) => { artifact.capture.reviewedRouteZoneCount = 2 },
    (artifact) => { artifact.capture.pagination.accountZones.pagesRead = 2 },
    (artifact) => { artifact.capture.pagination.pagesPreviewDeployments.completeness = 'partial' },
  ]) {
    const candidate = completeOnlineMatchArtifact()
    mutate(candidate)
    assert.throws(
      () => validateOnlineArtifact(candidate),
      /request counts|budget|stable complete|pagination/i,
    )
  }
})

test('capability applicability matrix is exact for every capability and surface', () => {
  const valid = completeOnlineMatchArtifact()
  assert.equal(validateOnlineArtifact(valid).environments.preview.comparison, 'MATCH')
  for (const capability of RELEASE_INSPECTION_CAPABILITIES) {
    for (const surface of RELEASE_INSPECTION_SURFACES) {
      const candidate = completeOnlineMatchArtifact()
      const isApplicable = applicableSurfaces[capability].includes(surface)
      if (isApplicable) {
        const required = surfaceOperations[surface]
        const wrong = PREVIEW_OPERATION_NAMES.find((operation) => operation !== required)
        candidate.environments.preview.capabilities[capability].surfaces[surface] = matchingEvidence(wrong)
      } else {
        candidate.environments.preview.capabilities[capability].surfaces[surface] = matchingEvidence(surfaceOperations[surface])
      }
      assert.throws(
        () => validateOnlineArtifact(candidate),
        /exact operation|non-applicable/i,
        `${capability}.${surface}`,
      )
    }
  }
})

test('MATCH and DRIFT aggregation rejects missing, partial, unknown, unavailable, and contradictory evidence', () => {
  const drift = completeOnlineMatchArtifact()
  drift.environments.preview.comparison = 'DRIFT'
  drift.environments.preview.reason = 'observed-drift'
  drift.environments.preview.resources.account.comparison = 'DRIFT'
  drift.environments.preview.resources.account.reason = 'observed-drift'
  drift.environments.preview.resources.account.observed = 'enabled'
  assert.equal(validateOnlineArtifact(drift).environments.preview.comparison, 'DRIFT')

  const mutations = [
    (artifact) => {
      artifact.environments.preview.resources.account.comparison = 'DRIFT'
      artifact.environments.preview.resources.account.reason = 'observed-drift'
      artifact.environments.preview.resources.account.observed = 'enabled'
    },
    (artifact) => {
      artifact.environments.preview.resources.account.comparison = 'UNKNOWN'
      artifact.environments.preview.resources.account.reason = 'unknown-observation'
    },
    (artifact) => { artifact.environments.preview.resources.account = createUnavailableRemoteEvidence() },
    (artifact) => {
      const evidence = artifact.environments.preview.resources.account
      evidence.completeness = 'partial'
      evidence.comparison = 'UNKNOWN'
      evidence.reason = 'partial-response'
      evidence.readOrdinals = [1]
      evidence.capturedAtMs.secondRead = null
    },
    (artifact) => { delete artifact.environments.preview.resources.account },
    (artifact) => {
      artifact.environments.preview.capabilities.cleanupCron.surfaces.frontend = matchingEvidence('pages-project')
    },
    (artifact) => {
      artifact.environments.preview.comparison = 'DRIFT'
      artifact.environments.preview.reason = 'observed-drift'
    },
  ]
  for (const mutate of mutations) {
    const candidate = completeOnlineMatchArtifact()
    mutate(candidate)
    assert.throws(
      () => validateOnlineArtifact(candidate),
      /MATCH|DRIFT|inventory|non-applicable|complete/i,
    )
  }
})

test('positive evidence schema and normalized compound secret aliases fail before retention', () => {
  const sentinel = ['nested', 'credential', 'sentinel', 'must', 'not', 'survive'].join('-')
  const unsafeKeys = [
    'secret',
    'ＳＥＣＲＥＴ',
    'se\u0301cret',
    'sеcret',
    'SeCrEtS',
    'value',
    'text',
    'credential',
    'key',
    'api_key',
    'private-key',
    'private key',
    'key.base64',
    'key_jwk',
    'toKen',
    'authorization',
    'payload',
    'digest',
    'preview',
    'content',
    'data',
    'access_token',
    'accessToken',
    'api_token',
    'apiToken',
    'client_secret',
    'clientSecret',
    'auth-token',
    'authorizationValue',
    'secret_value',
    'secretValue',
    'credential_value',
    'credentialValue',
    'signing_key',
    'privateKey',
    'tokenPayload',
    'responseBody',
    'rawData',
    'accessTokenDigest',
    'api-secret-key',
    'authorizationPayloadPreview',
    'clientCredentialData',
  ]
  for (const key of unsafeKeys) {
    const evidence = matchingEvidence('account')
    evidence.expected = { safe: { [key]: sentinel } }
    evidence.observed = structuredClone(evidence.expected)
    let message = ''
    try {
      validateRemoteEvidence(evidence)
    } catch (error) {
      message = error.message
    }
    assert.match(message, /secret-bearing|mixed-script|non-ASCII/i, key)
    assert.equal(message.includes(sentinel), false, key)
  }

  for (const json of [false, true]) {
    const artifact = clonedOfflineArtifact()
    artifact.environments.preview.resources.account.expected = { ＳＥＣＲＥＴ: sentinel }
    let stdout = ''
    let message = ''
    try {
      runReleaseInspectionObserveCli(json ? ['--json'] : [], {
        createArtifact: () => artifact,
        output: { write(value) { stdout += value } },
      })
    } catch (error) {
      message = error.message
    }
    assert.equal(stdout, '')
    assert.equal(stdout.includes(sentinel), false)
    assert.equal(message.includes(sentinel), false)
  }
  const programmaticArtifact = clonedOfflineArtifact()
  programmaticArtifact.environments.preview.resources.account.expected = {
    credentialValue: sentinel,
  }
  for (const operation of [
    () => validateRemoteObservationArtifact(programmaticArtifact),
    () => renderRemoteObservationJson(programmaticArtifact),
  ]) {
    let message = ''
    try {
      operation()
    } catch (error) {
      message = error.message
    }
    assert.ok(message.length > 0 && message.length < 1_024)
    assert.equal(message.includes(sentinel), false)
  }
  let thrownOutput = ''
  let thrownMessage = ''
  try {
    runReleaseInspectionObserveCli([], {
      createArtifact() { throw new Error(sentinel) },
      output: { write(value) { thrownOutput += value } },
    })
  } catch (error) {
    thrownMessage = error.message
  }
  assert.equal(thrownOutput, '')
  assert.equal(thrownMessage.includes(sentinel), false)
})

test('strict remote parser rejects duplicate keys, dangerous keys, BOM, invalid UTF-8, malformed JSON, trailing content, limits, and unsupported envelopes', () => {
  const valid = encoder.encode('{"success":true,"errors":[],"messages":[],"result":{"state":"disabled"}}')
  assert.deepEqual(parseStrictRemoteJson(valid), {
    success: true,
    errors: [],
    messages: [],
    result: { state: 'disabled' },
  })
  const cases = [
    [encoder.encode('{"success":true,"errors":[],"messages":[],"result":{"x":1,"x":2}}'), /duplicate/i],
    [encoder.encode('{"success":true,"errors":[],"messages":[],"result":{"__proto__":{}}}'), /dangerous/i],
    [new Uint8Array([0xEF, 0xBB, 0xBF, ...valid]), /BOM-free/i],
    [new Uint8Array([0xC3, 0x28]), /BOM-free UTF-8/i],
    [encoder.encode('{"success":true'), /malformed JSON/i],
    [encoder.encode('{"success":true,"errors":[],"messages":[],"result":{}} trailing'), /trailing/i],
    [encoder.encode('[]'), /top-level shape/i],
    [encoder.encode('{"success":true,"errors":[],"messages":[],"result":{},"future":true}'), /unsupported fields/i],
  ]
  for (const [bytes, pattern] of cases) assert.throws(() => parseStrictRemoteJson(bytes), pattern)
  assert.throws(
    () => parseStrictRemoteJson(new Uint8Array(REMOTE_OBSERVATION_LIMITS.maximumResponseBytes + 1)),
    /byte limit/i,
  )
  const deep = `${'{"x":'.repeat(50)}0${'}'.repeat(50)}`
  assert.throws(
    () => parseStrictRemoteJson(encoder.encode(`{"success":true,"errors":[],"messages":[],"result":${deep}}`)),
    /nesting/i,
  )
  const manyNodes = `[${Array.from({ length: 50_010 }, () => '0').join(',')}]`
  assert.throws(
    () => parseStrictRemoteJson(encoder.encode(`{"success":true,"errors":[],"messages":[],"result":${manyNodes}}`)),
    /property\/node/i,
  )
  const rawSentinel = ['raw-body', 'must-not-be-retained'].join('-')
  let message = ''
  try {
    parseStrictRemoteJson(encoder.encode(`{"success":true,"errors":[],"messages":[],"result":"${rawSentinel}"} trailing`))
  } catch (error) {
    message = error.message
  }
  assert.equal(message.includes(rawSentinel), false)
})

test('operation registry is exact, Preview-only, immutable, fixed-origin, and has only eleven GETs plus three SELECT POSTs', () => {
  const expected = {
    account: ['account', 'GET', '/client/v4/accounts/{accountId}', ['accountId'], 'none', 1, ['accountId']],
    'account-zones': ['zones', 'GET', '/client/v4/zones', ['accountId', 'page'], 'page', 10, ['accountId']],
    'pages-project': ['pages', 'GET', '/client/v4/accounts/{accountId}/pages/projects/{pagesProject}', ['accountId', 'pagesProject'], 'none', 1, ['accountId', 'pagesProject']],
    'pages-preview-deployments': ['pages', 'GET', '/client/v4/accounts/{accountId}/pages/projects/{pagesProject}/deployments', ['accountId', 'page', 'pagesProject'], 'page', 10, ['accountId', 'pagesProject']],
    'worker-settings': ['workers', 'GET', '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/settings', ['accountId', 'workerName'], 'none', 1, ['accountId', 'workerName']],
    'worker-deployments': ['workers', 'GET', '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/deployments', ['accountId', 'workerName'], 'none', 1, ['accountId', 'workerName']],
    'worker-subdomain': ['workers', 'GET', '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/subdomain', ['accountId', 'workerName'], 'none', 1, ['accountId', 'workerName']],
    'worker-schedules': ['workers', 'GET', '/client/v4/accounts/{accountId}/workers/scripts/{workerName}/schedules', ['accountId', 'workerName'], 'none', 1, ['accountId', 'workerName']],
    'worker-custom-domains': ['workers', 'GET', '/client/v4/accounts/{accountId}/workers/domains', ['accountId', 'workerName'], 'filtered-single-page', 1, ['accountId', 'workerName']],
    'worker-routes': ['zones', 'GET', '/client/v4/zones/{zoneId}/workers/routes', ['accountId', 'workerName', 'zoneId'], 'none', 1, ['accountId', 'workerName', 'routeZoneIds']],
    'd1-database': ['d1', 'GET', '/client/v4/accounts/{accountId}/d1/database/{databaseId}', ['accountId', 'databaseId'], 'none', 1, ['accountId', 'databaseId']],
    'migration-table-discovery': ['d1', 'POST', '/client/v4/accounts/{accountId}/d1/database/{databaseId}/query', ['accountId', 'databaseId'], 'none', 1, ['accountId', 'databaseId']],
    'migration-rows': ['d1', 'POST', '/client/v4/accounts/{accountId}/d1/database/{databaseId}/query', ['accountId', 'databaseId'], 'none', 1, ['accountId', 'databaseId']],
    'backend-schema-version': ['d1', 'POST', '/client/v4/accounts/{accountId}/d1/database/{databaseId}/query', ['accountId', 'databaseId'], 'none', 1, ['accountId', 'databaseId']],
  }
  const projected = Object.fromEntries(Object.entries(PREVIEW_OPERATION_REGISTRY).map(([name, definition]) => [name, [
    definition.endpointFamily,
    definition.method,
    definition.pathTemplate,
    definition.parameterKeys,
    definition.pagination.kind,
    definition.pagination.maximumPages,
    definition.previewIdentityFields,
  ]]))
  assert.deepEqual(projected, expected)
  assert.deepEqual(PREVIEW_OPERATION_NAMES, Object.keys(expected).sort())
  assert.deepEqual(PREVIEW_ENDPOINT_FAMILIES, ['account', 'zones', 'pages', 'workers', 'd1'])
  assert.equal(Object.values(PREVIEW_OPERATION_REGISTRY).filter(({ method }) => method === 'GET').length, 11)
  assert.equal(Object.values(PREVIEW_OPERATION_REGISTRY).filter(({ method }) => method === 'POST').length, 3)
  for (const definition of Object.values(PREVIEW_OPERATION_REGISTRY)) {
    assert.equal(definition.origin, 'https://api.cloudflare.com')
    assert.equal(definition.responseLimitBytes, 1_048_576)
    assert.equal(definition.requestBudgetWeight, 1)
    assert.equal(definition.productionPoisoning, 'reject-raw-normalized-repeatedly-encoded')
    assert.equal(definition.secretPresenceContract, 'unavailable')
    assert.equal(Object.isFrozen(definition), true)
    if (definition.method === 'POST') {
      assert.equal(definition.operationClass, 'exact-select-post')
      assert.deepEqual(definition.params, [])
    } else {
      assert.equal(definition.operationClass, 'get')
      assert.equal(definition.sql, null)
    }
  }
})

test('request builder allows no arbitrary origin, URL, method, path, query, body, operation, parameter, or extension', () => {
  const request = createPreviewOperationRequest('account-zones', { accountId: ACCOUNT_ID, page: 1 }, identity)
  assert.deepEqual(request.query, [
    { name: 'account.id', value: ACCOUNT_ID },
    { name: 'type', value: 'full,partial,secondary,internal' },
    { name: 'page', value: '1' },
    { name: 'per_page', value: '25' },
  ])
  assert.deepEqual(validatePreviewOperationRequest(request, identity), request)
  assert.throws(() => createPreviewOperationRequest('arbitrary', {}, identity), /closed Preview-only registry/i)
  assert.throws(
    () => createPreviewOperationRequest('account', { accountId: ACCOUNT_ID, url: 'https://example.test' }, identity),
    /parameter schema/i,
  )
  for (const mutate of [
    (candidate) => { candidate.origin = 'https://example.test' },
    (candidate) => { candidate.method = 'POST' },
    (candidate) => { candidate.path = '/client/v4/accounts/production' },
    (candidate) => { candidate.query.push({ name: 'arbitrary', value: '1' }) },
    (candidate) => { candidate.body = { sql: 'SELECT 1', params: [] } },
    (candidate) => { candidate.url = 'https://api.cloudflare.com/client/v4/accounts' },
  ]) {
    const candidate = structuredClone(request)
    mutate(candidate)
    assert.throws(() => validatePreviewOperationRequest(candidate, identity), /request|descriptor|operation/i)
  }
})

test('trusted intrinsic boundary rejects standard-prototype data, accessor, removal, addition, and nested-value substitutions across every observer path', () => {
  const markerValues = [
    'pennant-pursuit-validation-production',
    PRODUCTION_DATABASE_ID,
    'PENNANT_PREVIEW_API_TOKEN',
    'secret',
    'productionContacted',
    'artifactKind',
    'toolContractVersion',
    'capabilityMatrix',
    'remoteObservation',
  ]
  const targets = [
    [Object.prototype, 'constructor'],
    [Object.prototype, 'toString'],
    [Object.prototype, 'valueOf'],
    [Object.prototype, '__proto__'],
    [Array.prototype, 'filter'],
    [Array.prototype, 'map'],
    [Array.prototype, 'includes'],
    [Array.prototype, 'slice'],
    [Array.prototype, Symbol.iterator],
    [Function.prototype, 'call'],
    [Function.prototype, 'apply'],
    [Function.prototype, 'bind'],
  ]
  const observerPaths = [
    () => createPreviewOperationRequest('account', { accountId: ACCOUNT_ID }, identity),
    () => createPreviewOperationRequest('account-zones', { accountId: ACCOUNT_ID, page: 1 }, identity),
    () => validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: 'local-test-value' }),
    () => validateRemoteEvidence(matchingEvidence('account')),
    () => validateReleasePackage(createOfflineRemoteObservation()),
    () => runReleaseInspectionObserveCli(['--online-preview'], new Proxy({}, {
      get() { throw new Error('dependencies must remain unread') },
    })),
  ]
  const descriptorKinds = ['data', 'getter', 'setter']
  let caseIndex = 0
  for (const [prototype, key] of targets) {
    const original = Object.getOwnPropertyDescriptor(prototype, key)
    assert.equal(original?.configurable, true, String(key))
    for (const kind of descriptorKinds) {
      const marker = markerValues[caseIndex % markerValues.length]
      const operation = observerPaths[caseIndex % observerPaths.length]
      const descriptor = kind === 'data'
        ? { configurable: true, enumerable: original.enumerable, writable: true, value: marker }
        : kind === 'getter'
          ? { configurable: true, enumerable: original.enumerable, get() { return marker } }
          : { configurable: true, enumerable: original.enumerable, set() { return marker } }
      capturePrototypeRejection(prototype, key, descriptor, operation)
      caseIndex += 1
    }
  }

  capturePrototypeRejection(
    Object.prototype,
    'releaseInspectionAddedAlias',
    { configurable: true, value: 'secret', writable: true },
    observerPaths[0],
  )
  capturePrototypeRejection(Object.prototype, 'toString', null, observerPaths[2])
  const toStringDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toString')
  capturePrototypeRejection(
    Object.prototype,
    'toString',
    { ...toStringDescriptor, enumerable: !toStringDescriptor.enumerable },
    observerPaths[4],
  )

  const intrinsicFunction = Array.prototype.filter
  capturePrototypeRejection(
    intrinsicFunction,
    'productionContacted',
    { configurable: true, value: false, writable: true },
    observerPaths[3],
  )

  const trustedArrayParent = Object.getPrototypeOf(Array.prototype)
  let prototypeLinkError = null
  Object.setPrototypeOf(Array.prototype, { productionContacted: false })
  try {
    observerPaths[5]()
  } catch (error) {
    prototypeLinkError = error
  } finally {
    Object.setPrototypeOf(Array.prototype, trustedArrayParent)
  }
  assert.match(prototypeLinkError?.message ?? '', /intrinsic integrity/i)
  assert.doesNotThrow(() => assertReleaseInspectionIntrinsicIntegrity())
})

test('known String, Number, and Set helper bypasses now fail at the shared integrity boundary', () => {
  const normalizeDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'normalize')
  capturePrototypeRejection(
    String.prototype,
    'normalize',
    { ...normalizeDescriptor, value: () => '' },
    () => createPreviewOperationRequest('account', {
      accountId: '16204021000000000000000000000000',
    }, identity),
  )
  capturePrototypeRejection(
    String.prototype,
    'normalize',
    { ...normalizeDescriptor, value: () => '' },
    () => assertNoReleaseInspectionArtifactForLegacyExecution({
      artifactKind: REMOTE_OBSERVATION_KIND,
    }),
  )

  const safeIntegerDescriptor = Object.getOwnPropertyDescriptor(Number, 'isSafeInteger')
  const originalIsFinite = Number.isFinite
  capturePrototypeRejection(
    Number,
    'isSafeInteger',
    { ...safeIntegerDescriptor, value: (value) => originalIsFinite(value) && value >= 0 },
    () => validateRemoteEvidence({
      ...matchingEvidence('account'),
      completeness: 'partial',
      comparison: 'UNKNOWN',
      reason: 'partial-response',
      readOrdinals: [1],
      capturedAtMs: { firstRead: 1.5, secondRead: null },
    }),
  )

  const setHasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, 'has')
  capturePrototypeRejection(
    Set.prototype,
    'has',
    { ...setHasDescriptor, value: () => true },
    () => parseReleaseInspectionObserveArguments(['--token=synthetic-sentinel']),
  )
})

test('targeted public helper mutations reject with zero replacement calls and zero input reads', () => {
  captureZeroReadPublicEntryRejection(
    Set.prototype,
    'has',
    (reason) => createUnavailableRemoteEvidence(reason),
    'createUnavailableRemoteEvidence',
  )
  assert.deepEqual(createUnavailableRemoteEvidence(), {
    availability: 'unavailable',
    completeness: 'not-attempted',
    comparison: 'UNAVAILABLE',
    expected: null,
    observed: null,
    reason: 'offline-observation-not-attempted',
    endpointFamily: 'not-applicable',
    operation: 'not-applicable',
    httpMethod: 'not-applicable',
    readOrdinals: [],
    capturedAtMs: { firstRead: null, secondRead: null },
  })

  captureZeroReadPublicEntryRejection(
    Object,
    'getPrototypeOf',
    (kind) => createRequestBudget(kind),
    'createRequestBudget',
  )
  assert.deepEqual(createRequestBudget('full-read'), {
    kind: 'full-read',
    used: 0,
    remaining: 64,
    maximum: 64,
  })
})

test('isolated protected-global binding mutations fail before argument, option, or output access', () => {
  runIsolatedIntrinsicMutationGroup('global-bindings', [
    'Array',
    'Boolean',
    'Date',
    'Error',
    'Function',
    'JSON',
    'Map',
    'Math',
    'Number',
    'Object',
    'Reflect',
    'RegExp',
    'Set',
    'String',
    'Symbol',
    'TextDecoder',
    'TypeError',
    'Uint8Array',
    'URL',
    'URLSearchParams',
    'WeakSet',
    'decodeURIComponent',
    'encodeURIComponent',
  ].map((key) => ({ owner: 'globalThis', key })))
})

test('isolated String and iterator helper mutations fail closed and restore exactly', () => {
  runIsolatedIntrinsicMutationGroup('string-and-iterators', [
    'normalize',
    'toLowerCase',
    'includes',
    'startsWith',
    'endsWith',
    'replace',
    'replaceAll',
    'split',
    'trim',
    'codePointAt',
    'charCodeAt',
    'match',
  ].map((key) => ({ owner: 'String.prototype', key })).concat([
    { owner: 'String.prototype', key: '@@iterator' },
    { owner: 'StringIteratorPrototype', key: 'next' },
    { owner: 'ArrayIteratorPrototype', key: 'next' },
    { owner: 'SetIteratorPrototype', key: 'next' },
    { owner: 'MapIteratorPrototype', key: 'next' },
  ]))
})

test('isolated Number, collection, regular-expression, parser, URL, and time helper mutations fail closed', () => {
  runIsolatedIntrinsicMutationGroup('number-collection-parser-url-time', [
    { owner: 'Number', key: 'isSafeInteger' },
    { owner: 'Number', key: 'isFinite' },
    { owner: 'Number', key: 'isInteger' },
    { owner: 'Buffer', key: 'allocUnsafe' },
    { owner: 'Buffer', key: 'byteLength' },
    { owner: 'Buffer', key: 'from' },
    { owner: 'Set.prototype', key: 'has' },
    { owner: 'Set.prototype', key: 'add' },
    { owner: 'Set.prototype', key: '@@iterator' },
    { owner: 'Map.prototype', key: 'get' },
    { owner: 'Map.prototype', key: 'set' },
    { owner: 'Map.prototype', key: 'has' },
    { owner: 'Map.prototype', key: '@@iterator' },
    { owner: 'WeakSet.prototype', key: 'has' },
    { owner: 'WeakSet.prototype', key: 'add' },
    { owner: 'RegExp.prototype', key: 'test' },
    { owner: 'RegExp.prototype', key: 'exec' },
    { owner: 'RegExp.prototype', key: '@@replace' },
    { owner: 'JSON', key: 'parse' },
    { owner: 'JSON', key: 'stringify' },
    { owner: 'TextDecoder.prototype', key: 'decode' },
    { owner: 'Date', key: 'now' },
    { owner: 'URL.prototype', key: 'toString' },
    { owner: 'URLSearchParams.prototype', key: 'toString' },
    { owner: 'URLSearchParams.prototype', key: '@@iterator' },
    { owner: 'Math', key: 'ceil' },
    { owner: 'Math', key: 'max' },
    { owner: 'Math', key: 'min' },
  ])
})

test('isolated Array, Object, Reflect, and Function helper regressions fail closed', () => {
  runIsolatedIntrinsicMutationGroup('array-object-reflect-function', [
    { owner: 'Array', key: 'isArray' },
    { owner: 'Array', key: 'from' },
    ...['every', 'some', 'map', 'filter', 'includes', 'slice', 'push', 'sort', 'join']
      .map((key) => ({ owner: 'Array.prototype', key })),
    { owner: 'Array.prototype', key: '@@iterator' },
    ...[
      'hasOwn',
      'freeze',
      'values',
      'entries',
      'keys',
      'fromEntries',
      'getPrototypeOf',
      'getOwnPropertyDescriptor',
      'defineProperty',
      'isFrozen',
    ].map((key) => ({ owner: 'Object', key })),
    ...['ownKeys', 'getPrototypeOf', 'getOwnPropertyDescriptor', 'defineProperty']
      .map((key) => ({ owner: 'Reflect', key })),
    ...['call', 'apply', 'bind'].map((key) => ({ owner: 'Function.prototype', key })),
  ])
})

test('captured Node module helpers remain immutable to later module-object replacement', () => {
  const canonicalUrl = pathToFileURL(path.join(
    repositoryRoot,
    'scripts/lib/preview-release/canonical.mjs',
  )).href
  const contractsUrl = pathToFileURL(path.join(
    repositoryRoot,
    'scripts/lib/release-inspection/remote-contracts.mjs',
  )).href
  const source = `
    import { Buffer } from 'node:buffer';
    import { createHash } from 'node:crypto';
    import { Stats } from 'node:fs';
    import path from 'node:path';
    import { types as utilTypes } from 'node:util';
    const { aggregateFileHash, decodeStrictUtf8, readBoundedUtf8File } = await import(${JSON.stringify(canonicalUrl)});
    const { createOfflineRemoteObservation } = await import(${JSON.stringify(contractsUrl)});
    const hashPrototype = Reflect.getPrototypeOf(createHash('sha256'));
    const statsMethodOwner = Reflect.getPrototypeOf(Stats.prototype);
    const targets = [
      [path, 'join'],
      [utilTypes, 'isProxy'],
      [hashPrototype, 'update'],
      [hashPrototype, 'digest'],
      [statsMethodOwner, 'isFile'],
    ];
    const originals = targets.map(([owner, key]) => Reflect.getOwnPropertyDescriptor(owner, key));
    try {
      for (const [owner, key] of targets) {
        const original = Reflect.getOwnPropertyDescriptor(owner, key);
        Reflect.defineProperty(owner, key, {
          ...original,
          value() { throw new Error('mutable Node helper was invoked'); },
        });
      }
      const artifact = createOfflineRemoteObservation();
      if (artifact.releaseCurrentness !== 'UNKNOWN' || artifact.executionAuthorization !== 'prohibited') {
        throw new Error('captured helper mutation changed the offline boundary.');
      }
      const hash = aggregateFileHash(${JSON.stringify(repositoryRoot)}, ['package.json']);
      if (!/^[0-9a-f]{64}$/u.test(hash)) throw new Error('captured path helper did not produce a hash.');
      const decoded = decodeStrictUtf8(new Uint8Array([0x6f, 0x6b]));
      if (decoded !== 'ok') throw new Error('captured decoder helper did not decode bytes.');
      const packageSource = readBoundedUtf8File(${JSON.stringify(path.join(repositoryRoot, 'package.json'))}, {
        maxBytes: 1024 * 1024,
      });
      if (!packageSource.includes('pennant-pursuit')) {
        throw new Error('captured Stats helper did not preserve bounded file reads.');
      }
    } finally {
      for (let index = 0; index < targets.length; index += 1) {
        Reflect.defineProperty(targets[index][0], targets[index][1], originals[index]);
      }
    }
    process.stdout.write('captured-node-helpers-restored');
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  assert.equal(result.stdout, 'captured-node-helpers-restored')
})

test('trusted Production boundary rejects known, encoded, nested, inherited, swapped, and caller-relabeled identities', () => {
  const productionWorker = 'pennant-pursuit-validation-production'
  const percentEncode = (value) => [...value]
    .map((character) => `%${character.codePointAt(0).toString(16).padStart(2, '0')}`)
    .join('')
  const encodedProductionWorker = percentEncode(productionWorker)
  const fullwidth = [...productionWorker.toUpperCase()].map((character) => {
    const code = character.codePointAt(0)
    return code >= 0x21 && code <= 0x7E ? String.fromCodePoint(code + 0xFEE0) : character
  }).join('')
  for (const productionIdentifier of [
    productionWorker,
    'pennant-pursuit-production',
    PRODUCTION_DATABASE_ID,
    '16204021',
    '16204022',
  ]) {
    const candidate = { ...identity, productionBoundary: { environment: 'preview', identity: productionIdentifier } }
    assert.throws(
      () => createPreviewOperationRequest('account', { accountId: ACCOUNT_ID }, candidate),
      /Production identifier/i,
      productionIdentifier,
    )
  }
  for (const value of [
    productionWorker,
    productionWorker.toUpperCase(),
    fullwidth,
    encodedProductionWorker,
    encodedProductionWorker.replaceAll('%', '%25'),
    encodedProductionWorker.replaceAll('%', '%252525'),
  ]) {
    assert.throws(
      () => createPreviewOperationRequest('worker-settings', { accountId: ACCOUNT_ID, workerName: value }, identity),
      /Production identifier/i,
      value,
    )
  }
  for (const mutate of [
    (candidate) => { candidate.workerName = productionWorker },
    (candidate) => { candidate.databaseId = PRODUCTION_DATABASE_ID },
    (candidate) => { candidate.productionDenylist = [] },
    (candidate) => { candidate.productionDenylist = ['unrelated.example'] },
    (candidate) => { candidate.productionBoundary = { environment: 'preview', identity: 'pennant-pursuit-production' } },
    (candidate) => { candidate.previewOnly = true; candidate.classifier = { value: '16204021' } },
  ]) {
    const candidate = structuredClone(identity)
    mutate(candidate)
    if (candidate.productionDenylist) candidate.workerName = productionWorker
    assert.throws(
      () => createPreviewOperationRequest('worker-settings', {
        accountId: ACCOUNT_ID,
        workerName: candidate.workerName,
      }, candidate),
      /Production identifier/i,
    )
  }
  const inherited = Object.assign(Object.create({ environment: 'pennant-pursuit-validation-production' }), identity)
  assert.throws(
    () => createPreviewOperationRequest('account', { accountId: ACCOUNT_ID }, inherited),
    /Production identifier/i,
  )
  Object.defineProperty(Array.prototype, 'inheritedPreviewIdentity', {
    configurable: true,
    value: 'pennant-pursuit-validation-production',
  })
  try {
    assert.throws(
      () => createPreviewOperationRequest('account', { accountId: ACCOUNT_ID }, identity),
      /intrinsic integrity/i,
    )
  } finally {
    delete Array.prototype.inheritedPreviewIdentity
  }
  for (const override of ['productionDenylist', 'identityClassifier', 'environment', 'previewOnly', 'productionBoundary']) {
    const candidate = { ...identity, [override]: override === 'previewOnly' ? true : [] }
    assert.throws(
      () => createPreviewOperationRequest('account', { accountId: ACCOUNT_ID }, candidate),
      /exact reviewed identity fields/i,
    )
  }
  assert.throws(
    () => createPreviewOperationRequest('worker-routes', {
      accountId: ACCOUNT_ID,
      workerName: identity.workerName,
      zoneId: 'c'.repeat(32),
    }, identity),
    /route-zone allowlist/i,
  )
  const valid = createPreviewOperationRequest('worker-settings', {
    accountId: ACCOUNT_ID,
    workerName: identity.workerName,
  }, identity)
  assert.equal(valid.previewOnly, true)
  assert.equal(valid.path.includes(identity.workerName), true)
})

test('D1 contracts permit only the three exact SELECT bodies with params empty and no caller SQL', () => {
  assert.equal(MIGRATION_TABLE_DISCOVERY_SQL, [
    'SELECT name FROM sqlite_schema',
    "WHERE type = 'table'",
    "  AND name IN ('backend_schema', 'd1_migrations')",
    'ORDER BY name ASC',
  ].join('\n'))
  assert.equal(MIGRATION_ROWS_SQL, 'SELECT id, name, applied_at\nFROM d1_migrations\nORDER BY id ASC')
  assert.equal(BACKEND_SCHEMA_VERSION_SQL, 'SELECT version\nFROM backend_schema\nWHERE id = 1')
  for (const operation of ['migration-table-discovery', 'migration-rows', 'backend-schema-version']) {
    const request = createPreviewOperationRequest(operation, { accountId: ACCOUNT_ID, databaseId: DATABASE_ID }, identity)
    assert.equal(request.method, 'POST')
    assert.equal(request.path, `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`)
    assert.deepEqual(request.query, [])
    assert.deepEqual(request.body, { sql: PREVIEW_OPERATION_REGISTRY[operation].sql, params: [] })
    assert.deepEqual(validateD1SelectBody(operation, request.body), request.body)
    for (const body of [
      { sql: `${request.body.sql} `, params: [] },
      { sql: `${request.body.sql}\n-- comment`, params: [] },
      { sql: `${request.body.sql};`, params: [] },
      { sql: request.body.sql.toLowerCase(), params: [] },
      { sql: 'DELETE FROM d1_migrations', params: [] },
      { sql: 'PRAGMA table_info(d1_migrations)', params: [] },
      { sql: 'BEGIN TRANSACTION', params: [] },
      { sql: request.body.sql, params: ['caller'] },
      { sql: request.body.sql, params: [], future: true },
    ]) assert.throws(() => validateD1SelectBody(operation, body), /exact reviewed SQL|params/i)
  }
  assert.throws(
    () => createPreviewOperationRequest('migration-rows', {
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      sql: MIGRATION_ROWS_SQL,
    }, identity),
    /parameter schema/i,
  )
})

test('credential guard accepts only the dedicated environment token, rejects poisoning without value reads, and retains no token', () => {
  const sentinel = ['cfut', 'credential', 'must', 'not', 'leak'].join('_')
  const accepted = validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: sentinel })
  assert.deepEqual(accepted, {
    credentialName: 'PENNANT_PREVIEW_API_TOKEN',
    available: true,
    scope: 'unverified',
  })
  assert.equal(JSON.stringify(accepted).includes(sentinel), false)
  const prohibited = [
    'CLOUDFLARE_API_TOKEN',
    'CF_API_KEY',
    'WRANGLER_OAUTH_TOKEN',
    'PENNANT_PREVIEW_DEPLOY_API_TOKEN',
    'PENNANT_PRODUCTION_API_TOKEN',
    'CLOUDFLARE_PRODUCTION_SECRET',
    'CLOUDFLARE_API_TOKEN_FILE',
    'PENNANT_PREVIEW_ACCOUNT_ID',
  ]
  for (const key of prohibited) {
    let reads = 0
    const environment = { PENNANT_PREVIEW_API_TOKEN: sentinel }
    Object.defineProperty(environment, key, {
      enumerable: true,
      get() {
        reads += 1
        return sentinel
      },
    })
    let message = ''
    try {
      validateObservationCredentialEnvironment(environment)
    } catch (error) {
      message = error.message
    }
    assert.equal(reads, 0, key)
    assert.equal(message.includes(sentinel), false, key)
    assert.match(message, /dedicated|prohibited|data propert/i)
  }
  assert.throws(() => validateObservationCredentialEnvironment({}), /dedicated Preview credential/i)
  assert.throws(() => validateObservationCredentialEnvironment(new Proxy({}, {})), /non-proxy/i)

  const aliases = [
    'pennant_preview_api_token',
    'Pennant_Preview_Api_Token',
    'ＰＥＮＮＡＮＴ＿ＰＲＥＶＩＥＷ＿ＡＰＩ＿ＴＯＫＥＮ',
    'PENNANT-PREVIEW-API-TOKEN',
    'PENNANT PREVIEW API TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'WRANGLER_OAUTH_TOKEN',
    'PENNANT_PRODUCTION_API_TOKEN',
    'PENNANT_PREVIEW_ACCOUNT_ID',
  ]
  for (const alias of aliases) {
    const environment = { PENNANT_PREVIEW_API_TOKEN: sentinel, [alias]: sentinel }
    let message = ''
    try {
      validateObservationCredentialEnvironment(environment)
    } catch (error) {
      message = error.message
    }
    assert.match(message, /dedicated|credential|identity/i, alias)
    assert.equal(message.includes(sentinel), false, alias)
  }

  Object.defineProperty(Object.prototype, 'CLOUDFLARE_API_TOKEN', {
    configurable: true,
    value: sentinel,
  })
  try {
    assert.throws(
      () => validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: sentinel }),
      /intrinsic integrity/i,
    )
  } finally {
    delete Object.prototype.CLOUDFLARE_API_TOKEN
  }
  for (const inheritedAlias of [
    'pennant_preview_api_token',
    'Pennant_Preview_Api_Token',
    'ＰＥＮＮＡＮＴ＿ＰＲＥＶＩＥＷ＿ＡＰＩ＿ＴＯＫＥＮ',
    'CLOUDFLARE_API_TОKEN',
  ]) {
    Object.defineProperty(Object.prototype, inheritedAlias, {
      configurable: true,
      value: sentinel,
    })
    try {
      assert.throws(
        () => validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: sentinel }),
        /intrinsic integrity/i,
      )
    } finally {
      delete Object.prototype[inheritedAlias]
    }
  }
  const inheritedSymbol = Symbol('credential')
  Object.defineProperty(Object.prototype, inheritedSymbol, {
    configurable: true,
    value: sentinel,
  })
  try {
    assert.throws(
      () => validateObservationCredentialEnvironment({ PENNANT_PREVIEW_API_TOKEN: sentinel }),
      /intrinsic integrity/i,
    )
  } finally {
    delete Object.prototype[inheritedSymbol]
  }
  const customPrototype = { pennant_preview_api_token: sentinel }
  assert.throws(
    () => validateObservationCredentialEnvironment(Object.assign(Object.create(customPrototype), {
      PENNANT_PREVIEW_API_TOKEN: sentinel,
    })),
    /hostile prototype/i,
  )
  assert.throws(
    () => validateObservationCredentialEnvironment({
      PENNANT_PREVIEW_API_TOKEN: sentinel,
      [Symbol('credential')]: sentinel,
    }),
    /exactly the dedicated/i,
  )
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  assert.throws(() => validateObservationCredentialEnvironment(proxy), /non-proxy/i)
  assert.throws(() => validateObservationCredentialEnvironment(new Date()), /hostile prototype/i)
})

test('approved request, pagination, zone, response, timeout, retry, redirect, and serialization budgets are exact', () => {
  assert.deepEqual(validateRemoteObservationLimits(REMOTE_OBSERVATION_LIMITS), REMOTE_OBSERVATION_LIMITS)
  assert.deepEqual(REMOTE_OBSERVATION_LIMITS, {
    maximumReviewedRouteZones: 32,
    maximumRequestsPerFullRead: 64,
    maximumRequestsPerDoubleRead: 128,
    maximumPaginationPages: 10,
    maximumRecordsPerFamily: 250,
    maximumResponseBytes: 1_048_576,
    maximumSerializedObservationBytes: 1_048_576,
    requestTimeoutMs: 10_000,
    fullReadTimeoutMs: 120_000,
    doubleReadTimeoutMs: 300_000,
    stableReadDelayMs: 2_000,
    freshnessWindowMs: 300_000,
    maximumFutureClockSkewMs: 1_000,
    concurrency: 1,
    automaticRetries: 0,
    redirectPolicy: 'reject-every-3xx',
  })
  const altered = { ...REMOTE_OBSERVATION_LIMITS, automaticRetries: 1 }
  assert.throws(() => validateRemoteObservationLimits(altered), /approved contract/i)
  let full = createRequestBudget('full-read')
  full = consumeRequestBudget(full, 'account', 64)
  assert.deepEqual(full, { kind: 'full-read', used: 64, remaining: 0, maximum: 64 })
  assert.throws(() => consumeRequestBudget(full, 'account'), /exhausted/i)
  let double = createRequestBudget('double-read')
  double = consumeRequestBudget(double, 'account', 128)
  assert.equal(double.remaining, 0)
  assert.deepEqual(assertPaginationBudget({ page: 10, pages: 10, records: 250 }), {
    page: 10,
    pages: 10,
    records: 250,
  })
  assert.throws(() => assertPaginationBudget({ page: 11, pages: 11, records: 250 }), /page or record budget/i)
  assert.throws(() => assertPaginationBudget({ page: 10, pages: 10, records: 251 }), /page or record budget/i)
  assert.equal(assertReviewedRouteZoneBudget(Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(32, '0'))).length, 32)
  assert.throws(
    () => assertReviewedRouteZoneBudget(Array.from({ length: 33 }, (_, index) => index.toString(16).padStart(32, '0'))),
    /route-zone inventory/i,
  )
  assert.equal(assertSerializedObservationBudget('x'.repeat(1_048_576)).length, 1_048_576)
  assert.throws(() => assertSerializedObservationBudget('x'.repeat(1_048_577)), /byte limit/i)
})

test('legacy package and executor barriers reject new artifacts, markers, fragments, hostile objects, and forged wrappers before option reads', async () => {
  const artifact = createOfflineRemoteObservation()
  const fullwidth = (value) => [...value].map((character) => {
    const code = character.codePointAt(0)
    return code >= 0x21 && code <= 0x7E ? String.fromCodePoint(code + 0xFEE0) : character
  }).join('')
  const cyclic = { releaseCurrentness: 'UNKNOWN' }
  cyclic.self = cyclic
  let getterReads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'productionContacted', {
    enumerable: true,
    get() {
      getterReads += 1
      return false
    },
  })
  const deep = {}
  let cursor = deep
  for (let index = 0; index < 66; index += 1) {
    cursor.child = {}
    cursor = cursor.child
  }
  const candidates = [
    artifact,
    { kind: REMOTE_OBSERVATION_KIND },
    { kind: REMOTE_OBSERVATION_KIND.toUpperCase() },
    { kind: fullwidth(REMOTE_OBSERVATION_KIND) },
    { toolContractVersion: REMOTE_OBSERVATION_TOOL_CONTRACT_VERSION },
    { nested: [[[{ releaseCurrentness: 'UNKNOWN' }]]] },
    { localExpectations: {} },
    { stableRead: {} },
    { credentialScope: 'unverified' },
    { requestCounts: {} },
    { capturedAtMs: null },
    { readOrdinals: [] },
    { endpointFamily: 'workers' },
    Object.create({ productionContacted: false }),
    accessor,
    cyclic,
    deep,
    new Proxy({ releaseCurrentness: 'UNKNOWN' }, {}),
    { value: Symbol('remote-observation') },
    { value: 1n },
    { kind: 'pennant-pursuit-preview-release-package', nested: artifact },
  ]
  for (const candidate of candidates) {
    assert.throws(() => validateReleasePackage(candidate), /release-inspection artifacts.*prohibited/i)
    let optionReads = 0
    await assert.rejects(
      () => executeReleasePackage(candidate, new Proxy({}, {
        get() {
          optionReads += 1
          throw new Error('options must remain unread')
        },
      })),
      /release-inspection artifacts.*prohibited/i,
    )
    assert.equal(optionReads, 0)
  }
  assert.equal(getterReads, 0)
})

test('offline CLI is deterministic stdout-only and reads no credentials, network, clocks, subprocess, or writer dependencies', () => {
  assert.deepEqual(parseReleaseInspectionObserveArguments([]), {
    help: false,
    mode: 'offline',
    json: false,
    noColor: false,
  })
  assert.equal(parseReleaseInspectionObserveArguments(['--offline', '--json', '--no-color']).mode, 'offline')
  for (const args of [
    ['--token', 'hidden'],
    ['--token=hidden'],
    ['--config', 'config.json'],
    ['--output', 'artifact.json'],
    ['--offline', '--online-preview'],
    ['--help', '--json'],
  ]) assert.throws(() => parseReleaseInspectionObserveArguments(args), /accepts only/i)
  assert.throws(
    () => runReleaseInspectionObserveCli([], { token: 'must-not-be-accepted' }),
    /accepts only/i,
  )

  let output = ''
  const artifact = runReleaseInspectionObserveCli(['--json'], {
    output: { write(value) { output += value } },
  })
  assert.equal(output, renderRemoteObservationJson(artifact))

  const environmentDescriptor = Object.getOwnPropertyDescriptor(process, 'env')
  let environmentReads = 0
  let fetchReads = 0
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  try {
    Object.defineProperty(process, 'env', {
      configurable: true,
      get() {
        environmentReads += 1
        throw new Error('credentials must remain unread')
      },
    })
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get() {
        fetchReads += 1
        throw new Error('network must remain uninitialized')
      },
    })
    let offlineOutput = ''
    runReleaseInspectionObserveCli([], { output: { write(value) { offlineOutput += value } } })
    assert.match(offlineOutput, /Preview: not-attempted; comparison UNAVAILABLE/)
    let dependencyReads = 0
    assert.throws(
      () => runReleaseInspectionObserveCli(['--online-preview'], new Proxy({}, {
        get() {
          dependencyReads += 1
          throw new Error('dependency must remain unread')
        },
      })),
      /unimplemented.*before credentials/i,
    )
    assert.equal(dependencyReads, 0)
  } finally {
    Object.defineProperty(process, 'env', environmentDescriptor)
    if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor)
    else delete globalThis.fetch
  }
  assert.deepEqual({ environmentReads, fetchReads }, { environmentReads: 0, fetchReads: 0 })

  const statusBefore = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).stdout
  const childEnvironment = { ...process.env }
  const childSentinel = ['offline', 'credential', 'must', 'remain', 'unread'].join('_')
  childEnvironment.PENNANT_PREVIEW_API_TOKEN = childSentinel
  const first = spawnSync(process.execPath, ['scripts/release-inspection-observe.mjs', '--json'], {
    cwd: repositoryRoot,
    env: childEnvironment,
    encoding: 'utf8',
  })
  const second = spawnSync(process.execPath, ['scripts/release-inspection-observe.mjs', '--json'], {
    cwd: repositoryRoot,
    env: childEnvironment,
    encoding: 'utf8',
  })
  const statusAfter = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).stdout
  assert.equal(first.status, 0)
  assert.equal(first.stderr, '')
  assert.equal(first.stdout, second.stdout)
  assert.equal(first.stdout.includes(childSentinel), false)
  assert.equal(statusAfter, statusBefore)
})

test('human and JSON CLI paths validate and freeze injected artifacts before writing', () => {
  const sentinel = ['renderer', 'injection', 'must', 'not', 'escape'].join('-')
  const mutations = [
    (artifact) => { artifact.environments.preview.comparison = sentinel },
    (artifact) => { artifact.releaseCurrentness = sentinel },
    (artifact) => { artifact.executionAuthorization = sentinel },
    (artifact) => { artifact.productionContacted = true; artifact.future = sentinel },
    (artifact) => { artifact.environments.preview.resources.account.expected = { token: sentinel } },
  ]
  for (const json of [false, true]) {
    for (const mutate of mutations) {
      const artifact = clonedOfflineArtifact()
      mutate(artifact)
      let stdout = ''
      let message = ''
      try {
        runReleaseInspectionObserveCli(json ? ['--json'] : [], {
          createArtifact: () => artifact,
          output: { write(value) { stdout += value } },
        })
      } catch (error) {
        message = error.message
      }
      assert.equal(stdout, '')
      assert.equal(stdout.includes(sentinel), false)
      assert.equal(message.includes(sentinel), false)
      assert.ok(message.length > 0 && message.length < 1_024)
    }
  }
  const valid = clonedOfflineArtifact()
  const returned = runReleaseInspectionObserveCli([], {
    createArtifact: () => valid,
    output: { write() {} },
  })
  assert.equal(Object.isFrozen(returned), true)
  assert.equal(Object.isFrozen(returned.environments.preview.resources), true)
  assert.equal(renderOfflineRemoteObservationSummary(valid).includes('UNAVAILABLE'), true)

  const child = spawnSync(process.execPath, [
    'scripts/release-inspection-observe.mjs',
    `--token=${sentinel}`,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  assert.equal(child.status, 2)
  assert.equal(child.stdout, '')
  assert.equal(child.stderr.includes(sentinel), false)
  assert.ok(child.stderr.length > 0 && child.stderr.length < 1_024)
})

test('secret sentinel never appears in outputs, errors, retained artifacts, declarations, fixtures, or observer module graph', () => {
  const sentinel = ['sentinel', 'secret', 'value', 'must', 'never', 'survive'].join('-')
  const retained = []
  let output = ''
  retained.push(runReleaseInspectionObserveCli(['--json'], { output: { write(value) { output += value } } }))
  retained.push(output)
  try {
    validateObservationCredentialEnvironment({
      PENNANT_PREVIEW_API_TOKEN: sentinel,
      CLOUDFLARE_API_TOKEN: sentinel,
    })
  } catch (error) {
    retained.push(error.message)
  }
  try {
    validateRemoteEvidence({
      ...createUnavailableRemoteEvidence(),
      expected: sentinel,
    })
  } catch (error) {
    retained.push(error.message)
  }
  const graph = localModuleGraph(path.join(repositoryRoot, 'scripts/release-inspection-observe.mjs'))
  for (const module of graph) retained.push(module.source)
  assert.equal(canonicalJson(retained).includes(sentinel), false)
  const graphSource = graph.map(({ source }) => source).join('\n')
  for (const forbidden of [
    'node:child_process',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'fetch(',
    'writeFile',
    'appendFile',
    'mkdir',
    'ls-remote',
    'preview-plan',
    'preview-readiness',
    'release-execution',
    'cloudflare-readonly',
  ]) assert.equal(graphSource.includes(forbidden), false, forbidden)
})

test('runtime exports and declarations remain in exact parity', () => {
  for (const stem of ['remote-contracts', 'remote-transport']) {
    const runtime = readFileSync(path.join(repositoryRoot, `scripts/lib/release-inspection/${stem}.mjs`), 'utf8')
    const declaration = readFileSync(path.join(repositoryRoot, `scripts/lib/release-inspection/${stem}.d.mts`), 'utf8')
    assert.deepEqual(exportNames(runtime), exportNames(declaration), stem)
  }
})
