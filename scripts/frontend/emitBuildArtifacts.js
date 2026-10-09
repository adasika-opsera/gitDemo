'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeManifest } = require('./manifestNormalizer.js');

const SUPPORTED_BUNDLERS = Object.freeze(['webpack4', 'rspack']);

/**
 * Bundler-distinct artifact layout for the dual-build coexistence window (WO-022).
 * Removing dual-build later is a single CI variable flip — paths stay stable.
 */
function artifactDirForBundler(bundler, reportsRoot = 'reports/parity') {
  assertBundler(bundler);
  return path.join(reportsRoot, 'builds', bundler);
}

function artifactPathsForBundler(bundler, reportsRoot = 'reports/parity') {
  const dir = artifactDirForBundler(bundler, reportsRoot);
  return {
    dir,
    normalizedManifest: path.join(dir, 'normalized-manifest.json'),
    sizeTable: path.join(dir, 'size-table.json'),
    timing: path.join(dir, 'build-timing.json'),
  };
}

function buildSizeTable(normalizedManifest) {
  if (!normalizedManifest || typeof normalizedManifest !== 'object') {
    throw new Error('normalizedManifest is required to build a size table');
  }

  const entryByteTotals = normalizedManifest.entryByteTotals || {};
  const entries = Object.keys(entryByteTotals)
    .sort()
    .map((entry) => ({
      entry,
      bytes: entryByteTotals[entry],
    }));

  return {
    bundler: normalizedManifest.bundler,
    generatedAt: normalizedManifest.generatedAt,
    gitSha: normalizedManifest.gitSha,
    chunkCount: normalizedManifest.chunkCount,
    hashedNameStrategy: normalizedManifest.hashedNameStrategy,
    entries,
    entryByteTotals,
    assets: (normalizedManifest.assets || []).map((asset) => ({
      name: asset.name,
      logicalName: asset.logicalName,
      entry: asset.entry,
      bytes: asset.bytes,
      gzipBytes: asset.gzipBytes,
    })),
  };
}

function emitBuildArtifacts({
  bundler,
  rawManifest,
  outputPath,
  reportsRoot = 'reports/parity',
  gitSha = process.env.CI_COMMIT_SHA || 'unknown',
  wallClockSeconds = { cold: 0, warm: 0 },
  buildStartedAt = null,
  buildFinishedAt = null,
}) {
  assertBundler(bundler);

  if (!rawManifest || typeof rawManifest !== 'object') {
    throw new Error('rawManifest is required');
  }

  if (!outputPath) {
    throw new Error('outputPath is required');
  }

  const normalized = normalizeManifest(rawManifest, {
    outputPath,
    bundler,
    gitSha,
    wallClockSeconds,
  });

  const sizeTable = buildSizeTable(normalized);
  const paths = artifactPathsForBundler(bundler, reportsRoot);

  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.normalizedManifest, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.writeFileSync(paths.sizeTable, `${JSON.stringify(sizeTable, null, 2)}\n`);

  const timing = {
    bundler,
    gitSha,
    wallClockSeconds,
    buildStartedAt,
    buildFinishedAt,
    recordedAt: new Date().toISOString(),
  };
  fs.writeFileSync(paths.timing, `${JSON.stringify(timing, null, 2)}\n`);

  return { normalized, sizeTable, paths, timing };
}

function assertBundler(bundler) {
  if (!SUPPORTED_BUNDLERS.includes(bundler)) {
    throw new Error(
      `Unsupported bundler "${bundler}". Expected one of: ${SUPPORTED_BUNDLERS.join(', ')}`,
    );
  }
}

function compareFrontendStageDuration(currentSeconds, baselineSeconds, toleranceRatio = 0) {
  if (typeof currentSeconds !== 'number' || Number.isNaN(currentSeconds) || currentSeconds < 0) {
    throw new Error('currentSeconds must be a non-negative number');
  }
  if (typeof baselineSeconds !== 'number' || Number.isNaN(baselineSeconds) || baselineSeconds <= 0) {
    throw new Error('baselineSeconds must be a positive number');
  }

  const limit = baselineSeconds * (1 + toleranceRatio);
  return {
    pass: currentSeconds <= limit,
    currentSeconds,
    baselineSeconds,
    limitSeconds: limit,
    deltaSeconds: currentSeconds - baselineSeconds,
  };
}

module.exports = {
  SUPPORTED_BUNDLERS,
  artifactDirForBundler,
  artifactPathsForBundler,
  buildSizeTable,
  emitBuildArtifacts,
  compareFrontendStageDuration,
};
