'use strict';

const fs = require('fs');
const path = require('path');
const { getProductionEntryPointNames } = require('./getProductionEntryPoints');

/** Matches webpack contenthash segments in emitted asset names. */
const CONTENT_HASH_PATTERN = /\.([a-f0-9]{8})(?=\.(chunk\.)?(js|css|map)$)/gi;

/**
 * Strip content hashes from an asset name, preserving the logical name.
 * @param {string} assetName
 * @returns {string}
 */
function stripContentHash(assetName) {
  return assetName.replace(CONTENT_HASH_PATTERN, '');
}

/**
 * Detect the hashed-name strategy used by the bundler output.
 * @param {string[]} assetNames
 * @returns {string}
 */
function detectHashedNameStrategy(assetNames) {
  const hasContentHash = assetNames.some((name) =>
    /\.[a-f0-9]{8}\.(chunk\.)?(js|css|map)$/.test(name),
  );
  return hasContentHash ? '[name].[contenthash:8].js' : '[name].js';
}

/**
 * Read file size in bytes; returns 0 when the file is missing.
 * @param {string} filePath
 * @returns {number}
 */
function readFileBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/**
 * Build a normalised asset record from a raw manifest entry.
 * @param {object} rawAsset
 * @param {string} outputPath
 * @returns {{ name: string, logicalName: string, entry: string, bytes: number, gzipBytes: number|null }}
 */
function normalizeAsset(rawAsset, outputPath) {
  const name = rawAsset.name;
  const logicalName = stripContentHash(name);
  const absolutePath = path.join(outputPath, name);

  return {
    name,
    logicalName,
    entry: rawAsset.entry || '',
    bytes: readFileBytes(absolutePath),
    gzipBytes: rawAsset.gzipBytes ?? null,
  };
}

/**
 * Aggregate per-entry byte totals from normalised assets.
 * @param {Array<{ entry: string, bytes: number }>} assets
 * @returns {Record<string, number>}
 */
function aggregateEntryBytes(assets) {
  const totals = {};

  for (const asset of assets) {
    if (!asset.entry) {
      continue;
    }
    totals[asset.entry] = (totals[asset.entry] || 0) + asset.bytes;
  }

  return totals;
}

/**
 * Normalise a raw webpack manifest into a deterministic baseline shape.
 * Assets are sorted by logical name then entry for stable ordering.
 *
 * @param {object} rawManifest
 * @param {object} options
 * @param {string} options.outputPath - Directory containing emitted assets
 * @param {string} [options.gitSha]
 * @param {string} [options.bundler='webpack4']
 * @param {{ cold: number, warm: number }} [options.wallClockSeconds]
 * @returns {object}
 */
function normalizeManifest(rawManifest, options = {}) {
  const {
    outputPath,
    gitSha = 'unknown',
    bundler = 'webpack4',
    wallClockSeconds = { cold: 0, warm: 0 },
  } = options;

  const rawAssets = Array.isArray(rawManifest.assets) ? rawManifest.assets : [];
  const normalizedAssets = rawAssets
    .map((asset) => normalizeAsset(asset, outputPath))
    .sort((a, b) => {
      const nameCompare = a.logicalName.localeCompare(b.logicalName);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.entry.localeCompare(b.entry);
    });

  const entryPointNames = getProductionEntryPointNames();
  const assetsByEntry = {};

  for (const entry of entryPointNames) {
    assetsByEntry[entry] = [];
  }

  for (const asset of normalizedAssets) {
    const entry = asset.entry || '';
    if (assetsByEntry[entry]) {
      assetsByEntry[entry].push({
        name: asset.name,
        logicalName: asset.logicalName,
        bytes: asset.bytes,
        gzipBytes: asset.gzipBytes,
      });
    }
  }

  const entryPoints = entryPointNames.map((name) => ({
    name,
    assetCount: assetsByEntry[name].length,
    totalBytes: assetsByEntry[name].reduce((sum, asset) => sum + asset.bytes, 0),
    assets: assetsByEntry[name].sort((a, b) => a.logicalName.localeCompare(b.logicalName)),
  }));

  const assetNames = normalizedAssets.map((asset) => asset.name);
  const chunkCount = rawManifest.chunkCount ?? new Set(assetNames).size;

  return {
    generatedAt: new Date().toISOString(),
    gitSha,
    bundler,
    wallClockSeconds,
    hashedNameStrategy: detectHashedNameStrategy(assetNames),
    chunkCount,
    entryPoints,
    assets: normalizedAssets.map(({ name, logicalName, entry, bytes, gzipBytes }) => ({
      name,
      logicalName,
      entry,
      bytes,
      gzipBytes,
    })),
    entryByteTotals: aggregateEntryBytes(normalizedAssets),
  };
}

/**
 * Compare two baselines for reproducibility (excludes non-deterministic fields).
 * @param {object} baselineA
 * @param {object} baselineB
 * @returns {{ equal: boolean, differences: string[] }}
 */
function compareBaselinesForReproducibility(baselineA, baselineB) {
  const differences = [];

  const deterministicFields = ['chunkCount', 'hashedNameStrategy', 'entryPoints', 'assets'];

  for (const field of deterministicFields) {
    const aValue = JSON.stringify(baselineA[field]);
    const bValue = JSON.stringify(baselineB[field]);

    if (aValue !== bValue) {
      differences.push(`Field "${field}" differs`);
    }
  }

  return {
    equal: differences.length === 0,
    differences,
  };
}

module.exports = {
  stripContentHash,
  detectHashedNameStrategy,
  normalizeManifest,
  aggregateEntryBytes,
  compareBaselinesForReproducibility,
  CONTENT_HASH_PATTERN,
};
