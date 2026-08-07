'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getProductionEntryPointNames } = require('./getProductionEntryPoints');
const { loadAllowlist, loadByteCompareConfig } = require('./loadParityConfig');

const COMPRESSION_SUFFIX_PATTERN = /\.(gz|br)$/i;
const SOURCEMAP_SUFFIX = '.map';

/**
 * Resolve a compression variant to its parent asset logical name.
 * @param {string} logicalName
 * @returns {string}
 */
function resolveCompressionParent(logicalName) {
  return logicalName.replace(COMPRESSION_SUFFIX_PATTERN, '');
}

/**
 * @param {object} manifest
 * @returns {void}
 */
function assertValidManifest(manifest, label) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`${label} manifest is missing or unreadable`);
  }

  if (!Array.isArray(manifest.assets)) {
    throw new Error(`${label} manifest is truncated: "assets" must be an array`);
  }

  if (manifest.assets.length === 0 && manifest.chunkCount === 0) {
    throw new Error(`${label} manifest is empty — refusing to report zero divergences`);
  }

  if (!Array.isArray(manifest.entryPoints)) {
    throw new Error(`${label} manifest is truncated: "entryPoints" must be an array`);
  }
}

/**
 * @param {object} manifest
 * @returns {Map<string, object>}
 */
function assetsByLogicalName(manifest) {
  const map = new Map();

  for (const asset of manifest.assets) {
    const logicalName = asset.logicalName || asset.name;
    const parentKey = resolveCompressionParent(logicalName);

    if (!map.has(parentKey)) {
      map.set(parentKey, []);
    }

    map.get(parentKey).push({
      ...asset,
      logicalName,
      isCompressionVariant: COMPRESSION_SUFFIX_PATTERN.test(logicalName),
      isSourcemap: logicalName.endsWith(SOURCEMAP_SUFFIX),
    });
  }

  return map;
}

/**
 * @param {object} defect
 * @param {Array<{ asset: string, kind: string }>} allowlist
 * @returns {boolean}
 */
function isAllowlisted(defect, allowlist) {
  return allowlist.some(
    (entry) => entry.kind === defect.kind && entry.asset === defect.asset,
  );
}

/**
 * @param {string} filePath
 * @returns {string|null}
 */
function digestFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * @param {string} logicalName
 * @param {string[]} excludePatterns
 * @returns {boolean}
 */
function isExcludedFromByteCompare(logicalName, excludePatterns) {
  return excludePatterns.some((pattern) => new RegExp(pattern).test(logicalName));
}

/**
 * Compare production entry coverage between two normalised manifests.
 * @returns {object[]}
 */
function compareEntryCoverage(manifestA, manifestB) {
  const defects = [];
  const productionEntries = getProductionEntryPointNames();

  const entryMapA = new Map(manifestA.entryPoints.map((entry) => [entry.name, entry]));
  const entryMapB = new Map(manifestB.entryPoints.map((entry) => [entry.name, entry]));

  for (const entryName of productionEntries) {
    const entryA = entryMapA.get(entryName);
    const entryB = entryMapB.get(entryName);

    if (!entryA || !entryB) {
      defects.push({
        kind: 'entry_missing',
        asset: entryName,
        message: `Production entry "${entryName}" is absent from one manifest`,
        details: {
          inA: Boolean(entryA),
          inB: Boolean(entryB),
        },
      });
      continue;
    }

    const hasAssetsA = entryA.assetCount > 0;
    const hasAssetsB = entryB.assetCount > 0;

    if (hasAssetsA !== hasAssetsB) {
      defects.push({
        kind: 'entry_coverage_mismatch',
        asset: entryName,
        message: `Production entry "${entryName}" has assets in one manifest but not the other`,
        details: {
          assetCountA: entryA.assetCount,
          assetCountB: entryB.assetCount,
        },
      });
    }
  }

  return defects;
}

/**
 * Compare asset sets between two manifests.
 * @returns {{ defects: object[], sizeTable: object[] }}
 */
function compareAssets(manifestA, manifestB) {
  const defects = [];
  const sizeTable = [];
  const mapA = assetsByLogicalName(manifestA);
  const mapB = assetsByLogicalName(manifestB);
  const allLogicalNames = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const logicalName of [...allLogicalNames].sort()) {
    const assetsA = mapA.get(logicalName) || [];
    const assetsB = mapB.get(logicalName) || [];
    const primaryA = assetsA.find((asset) => !asset.isCompressionVariant) || assetsA[0];
    const primaryB = assetsB.find((asset) => !asset.isCompressionVariant) || assetsB[0];

    const bytesA = primaryA ? primaryA.bytes : null;
    const bytesB = primaryB ? primaryB.bytes : null;

    sizeTable.push({
      logicalName,
      bytesA,
      bytesB,
      deltaBytes: bytesA != null && bytesB != null ? bytesB - bytesA : null,
      inA: assetsA.length > 0,
      inB: assetsB.length > 0,
    });

    if (assetsA.length === 0 && assetsB.length > 0) {
      defects.push({
        kind: 'asset_added',
        asset: logicalName,
        message: `Asset "${logicalName}" present in B but not A`,
      });
      continue;
    }

    if (assetsA.length > 0 && assetsB.length === 0) {
      defects.push({
        kind: 'asset_removed',
        asset: logicalName,
        message: `Asset "${logicalName}" present in A but not B`,
      });
      continue;
    }

    if (bytesA != null && bytesB != null && bytesA !== bytesB) {
      defects.push({
        kind: 'asset_size_changed',
        asset: logicalName,
        message: `Asset "${logicalName}" size changed from ${bytesA} to ${bytesB} bytes`,
        details: { bytesA, bytesB, deltaBytes: bytesB - bytesA },
      });
    }

    const sourcemapA = assetsA.some((asset) => asset.isSourcemap);
    const sourcemapB = assetsB.some((asset) => asset.isSourcemap);

    if (sourcemapA !== sourcemapB) {
      defects.push({
        kind: 'sourcemap_presence_mismatch',
        asset: logicalName,
        message: `Sourcemap presence differs for "${logicalName}"`,
        details: { inA: sourcemapA, inB: sourcemapB },
      });
    }
  }

  return { defects, sizeTable };
}

/**
 * Byte-level digest comparison for configured asset subset.
 * @returns {object[]}
 */
function compareByteDigests(manifestA, manifestB, options) {
  const { outputPathA, outputPathB, byteCompareConfig } = options;
  const defects = [];
  const mapA = assetsByLogicalName(manifestA);
  const mapB = assetsByLogicalName(manifestB);

  const targets = byteCompareConfig.assets.length > 0
    ? byteCompareConfig.assets
    : getProductionEntryPointNames().map((entry) => `${entry}.js`);

  for (const logicalName of targets) {
    if (isExcludedFromByteCompare(logicalName, byteCompareConfig.excludePatterns)) {
      continue;
    }

    const assetA = (mapA.get(logicalName) || []).find((asset) => !asset.isSourcemap);
    const assetB = (mapB.get(logicalName) || []).find((asset) => !asset.isSourcemap);

    if (!assetA || !assetB) {
      continue;
    }

    const digestA = digestFile(path.join(outputPathA, assetA.name));
    const digestB = digestFile(path.join(outputPathB, assetB.name));

    if (digestA == null || digestB == null) {
      defects.push({
        kind: 'byte_digest_unreadable',
        asset: logicalName,
        message: `Unable to read asset bytes for "${logicalName}"`,
      });
      continue;
    }

    if (digestA !== digestB) {
      defects.push({
        kind: 'byte_digest_mismatch',
        asset: logicalName,
        message: `Byte digest mismatch for "${logicalName}"`,
        details: { digestA, digestB },
      });
    }
  }

  return defects;
}

/**
 * @param {object[]} defects
 * @param {object} summary
 * @returns {string}
 */
function renderDiffReport(defects, summary) {
  const lines = [
    '# Bundle Parity Diff Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Bundler A: ${summary.bundlerA}`,
    `- Bundler B: ${summary.bundlerB}`,
    `- Chunk count: ${summary.chunkCountA} vs ${summary.chunkCountB}`,
    `- Hash strategy: ${summary.hashStrategyA} vs ${summary.hashStrategyB}`,
    `- Total defects: ${defects.length}`,
    `- Suppressed by allowlist: ${summary.suppressedCount}`,
    `- Blocking defects: ${summary.blockingCount}`,
    '',
  ];

  if (defects.length === 0) {
    lines.push('No divergences detected.', '');
    return `${lines.join('\n')}\n`;
  }

  lines.push('## Defects', '');

  for (const defect of defects) {
    lines.push(`### ${defect.kind}: ${defect.asset}`);
    lines.push('');
    lines.push(defect.message);
    if (defect.suppressed) {
      lines.push('');
      lines.push(`_Suppressed by allowlist (${defect.allowlistIssue}: ${defect.allowlistReason})_`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Compare two normalised manifests and produce parity results.
 *
 * @param {object} manifestA
 * @param {object} manifestB
 * @param {object} [options]
 * @returns {object}
 */
function compareBundles(manifestA, manifestB, options = {}) {
  assertValidManifest(manifestA, 'A');
  assertValidManifest(manifestB, 'B');

  const allowlist = options.allowlist ?? loadAllowlist(options.allowlistRaw);
  const byteCompareConfig = options.byteCompareConfig
    ?? loadByteCompareConfig(options.byteCompareRaw);

  const allDefects = [];

  if (manifestA.chunkCount !== manifestB.chunkCount) {
    allDefects.push({
      kind: 'chunk_count_mismatch',
      asset: '*',
      message: `Chunk count differs: ${manifestA.chunkCount} vs ${manifestB.chunkCount}`,
      details: {
        chunkCountA: manifestA.chunkCount,
        chunkCountB: manifestB.chunkCount,
      },
    });
  }

  if (manifestA.hashedNameStrategy !== manifestB.hashedNameStrategy) {
    allDefects.push({
      kind: 'hash_strategy_mismatch',
      asset: '*',
      message: `Hashed-name strategy differs: ${manifestA.hashedNameStrategy} vs ${manifestB.hashedNameStrategy}`,
      details: {
        strategyA: manifestA.hashedNameStrategy,
        strategyB: manifestB.hashedNameStrategy,
      },
    });
  }

  allDefects.push(...compareEntryCoverage(manifestA, manifestB));

  const { defects: assetDefects, sizeTable } = compareAssets(manifestA, manifestB);
  allDefects.push(...assetDefects);

  if (options.outputPathA && options.outputPathB) {
    allDefects.push(
      ...compareByteDigests(manifestA, manifestB, {
        outputPathA: options.outputPathA,
        outputPathB: options.outputPathB,
        byteCompareConfig,
      }),
    );
  }

  let suppressedCount = 0;
  const defects = allDefects.map((defect) => {
    if (isAllowlisted(defect, allowlist)) {
      suppressedCount += 1;
      const entry = allowlist.find(
        (item) => item.kind === defect.kind && item.asset === defect.asset,
      );
      return {
        ...defect,
        suppressed: true,
        allowlistReason: entry.reason,
        allowlistIssue: entry.issue,
      };
    }

    return { ...defect, suppressed: false };
  });

  const blockingDefects = defects.filter((defect) => !defect.suppressed);
  const parityDefects = blockingDefects.map(({ kind, asset, message, details }) => ({
    kind,
    asset,
    message,
    ...(details ? { details } : {}),
  }));

  const summary = {
    bundlerA: manifestA.bundler || 'unknown',
    bundlerB: manifestB.bundler || 'unknown',
    chunkCountA: manifestA.chunkCount,
    chunkCountB: manifestB.chunkCount,
    hashStrategyA: manifestA.hashedNameStrategy,
    hashStrategyB: manifestB.hashedNameStrategy,
    suppressedCount,
    blockingCount: blockingDefects.length,
  };

  return {
    pass: blockingDefects.length === 0,
    summary,
    defects,
    parityDefects,
    sizeTable,
    diffReport: renderDiffReport(defects, summary),
  };
}

module.exports = {
  compareBundles,
  assertValidManifest,
  assetsByLogicalName,
  resolveCompressionParent,
  isAllowlisted,
  renderDiffReport,
};
