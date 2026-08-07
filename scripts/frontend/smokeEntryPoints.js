'use strict';

const { getProductionEntryPointNames } = require('./getProductionEntryPoints');

/** Global set by production entry bundles when they mount successfully. */
const MOUNT_GLOBAL = '__GITLAB_ENTRY_MOUNTED__';

/**
 * Build the smoke target list from a raw asset manifest and bundler entry names.
 * @param {object} rawManifest
 * @param {string[]} [entryPointNames]
 * @returns {Array<{ entry: string, script: string|null, runnable: boolean, skipReason: string|null }>}
 */
function buildSmokeTargetList(rawManifest, entryPointNames = getProductionEntryPointNames()) {
  const assets = Array.isArray(rawManifest?.assets) ? rawManifest.assets : [];
  const scriptsByEntry = {};

  for (const asset of assets) {
    if (!asset.entry || !asset.name) {
      continue;
    }

    if (!asset.name.endsWith('.js') || asset.name.endsWith('.map')) {
      continue;
    }

    if (!scriptsByEntry[asset.entry]) {
      scriptsByEntry[asset.entry] = asset.name;
    }
  }

  return entryPointNames.map((entry) => {
    const script = scriptsByEntry[entry] || null;

    return {
      entry,
      script,
      runnable: Boolean(script),
      skipReason: script ? null : 'no_emitted_assets',
    };
  });
}

/**
 * Evaluate a single entry smoke result into pass/fail/skipped status.
 * @param {object} entryResult
 * @returns {{ status: 'pass'|'fail'|'skipped', failures: string[] }}
 */
function evaluateEntrySmoke(entryResult) {
  if (!entryResult.runnable) {
    return {
      status: 'skipped',
      failures: [],
    };
  }

  const failures = [];

  if (!entryResult.scriptLoaded) {
    failures.push('entry script failed to load');
  }

  if (!entryResult.mounted) {
    failures.push(`entry did not set ${MOUNT_GLOBAL}`);
  }

  for (const message of entryResult.consoleErrors || []) {
    failures.push(`console.error: ${message}`);
  }

  for (const message of entryResult.unhandledRejections || []) {
    failures.push(`unhandled rejection: ${message}`);
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
}

/**
 * Aggregate per-entry smoke results into a summary payload.
 * @param {object} options
 * @param {string} options.bundler
 * @param {string} options.assetRoot
 * @param {Array<object>} options.entries
 * @returns {object}
 */
function aggregateSmokeResults({ bundler, assetRoot, entries }) {
  const summary = {
    total: entries.length,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const entry of entries) {
    summary[entry.status === 'pass' ? 'passed' : entry.status === 'fail' ? 'failed' : 'skipped'] += 1;
  }

  return {
    bundler,
    assetRoot,
    generatedAt: new Date().toISOString(),
    pass: summary.failed === 0,
    summary,
    entries,
  };
}

/**
 * Compare two smoke result payloads and detect pass/fail divergences per entry.
 * @param {object} resultsA
 * @param {object} resultsB
 * @returns {{ pass: boolean, divergences: Array<object>, summary: object }}
 */
function compareSmokeResults(resultsA, resultsB) {
  const entriesA = new Map((resultsA.entries || []).map((entry) => [entry.entry, entry]));
  const entriesB = new Map((resultsB.entries || []).map((entry) => [entry.entry, entry]));
  const allEntries = [...new Set([...entriesA.keys(), ...entriesB.keys()])].sort();
  const divergences = [];

  for (const entry of allEntries) {
    const left = entriesA.get(entry);
    const right = entriesB.get(entry);

    if (!left || !right) {
      divergences.push({
        entry,
        bundlerA: resultsA.bundler,
        statusA: left?.status || 'missing',
        bundlerB: resultsB.bundler,
        statusB: right?.status || 'missing',
        message: `Entry "${entry}" missing from one smoke result set`,
      });
      continue;
    }

    if (left.status === right.status) {
      continue;
    }

    if (left.status === 'skipped' && right.status === 'skipped') {
      continue;
    }

    divergences.push({
      entry,
      bundlerA: resultsA.bundler,
      statusA: left.status,
      bundlerB: resultsB.bundler,
      statusB: right.status,
      message: `Entry "${entry}" passed under ${resultsA.bundler} (${left.status}) but not under ${resultsB.bundler} (${right.status})`,
      failuresA: left.failures || [],
      failuresB: right.failures || [],
    });
  }

  return {
    pass: divergences.length === 0,
    divergences,
    summary: {
      bundlerA: resultsA.bundler,
      bundlerB: resultsB.bundler,
      divergenceCount: divergences.length,
    },
  };
}

/**
 * Merge runtime smoke divergences into the parity-defect log shape.
 * @param {object} comparison
 * @returns {Array<object>}
 */
function smokeDivergencesToParityDefects(comparison) {
  return (comparison.divergences || []).map((divergence) => ({
    kind: 'runtime_smoke_divergence',
    asset: divergence.entry,
    message: divergence.message,
    details: {
      bundlerA: divergence.bundlerA,
      statusA: divergence.statusA,
      bundlerB: divergence.bundlerB,
      statusB: divergence.statusB,
      failuresA: divergence.failuresA || [],
      failuresB: divergence.failuresB || [],
    },
  }));
}

module.exports = {
  MOUNT_GLOBAL,
  buildSmokeTargetList,
  evaluateEntrySmoke,
  aggregateSmokeResults,
  compareSmokeResults,
  smokeDivergencesToParityDefects,
};
