'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { compareBundles, assertValidManifest } = require('../../scripts/frontend/compareBundles');
const { loadAllowlist, loadByteCompareConfig } = require('../../scripts/frontend/loadParityConfig');
const { normalizeManifest } = require('../../scripts/frontend/manifestNormalizer');

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/frontend/parity');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

function createOutputDir(rawManifest, byteOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-test-'));

  for (const asset of rawManifest.assets) {
    const content = 'x'.repeat(byteOverrides[asset.name] ?? 100);
    fs.writeFileSync(path.join(dir, asset.name), content);
  }

  return dir;
}

function normalizeFixture(rawManifest, outputDir, bundler) {
  return normalizeManifest(rawManifest, {
    outputPath: outputDir,
    bundler,
    gitSha: 'test-sha',
  });
}

function compareFixturePair(webpackFixture, rspackFixture, options = {}) {
  const dirA = createOutputDir(webpackFixture, options.bytesA);
  const dirB = createOutputDir(rspackFixture, options.bytesB);

  const manifestA = normalizeFixture(webpackFixture, dirA, 'webpack4');
  const manifestB = normalizeFixture(rspackFixture, dirB, 'rspack');

  const result = compareBundles(manifestA, manifestB, {
    outputPathA: dirA,
    outputPathB: dirB,
    ...options.compareOptions,
  });

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });

  return result;
}

describe('loadParityConfig', () => {
  it('loads an empty allowlist', () => {
    expect(loadAllowlist({ entries: [] })).toEqual([]);
  });

  it('rejects allowlist entries without reason and issue', () => {
    expect(() => loadAllowlist({
      entries: [{ asset: 'main.js', kind: 'asset_size_changed' }],
    })).toThrow(/reason/);

    expect(() => loadAllowlist({
      entries: [{ asset: 'main.js', kind: 'asset_size_changed', reason: 'known drift' }],
    })).toThrow(/issue/);
  });

  it('loads byte-compare defaults for production entry chunks', () => {
    const config = loadByteCompareConfig({});
    expect(config.assets).toEqual([]);
    expect(config.excludePatterns).toContain('\\.map$');
  });
});

describe('compareBundles', () => {
  it('passes for identical webpack and rspack fixtures', () => {
    const result = compareFixturePair(
      readFixture('webpack-identical.json'),
      readFixture('rspack-identical.json'),
    );

    expect(result.pass).toBe(true);
    expect(result.parityDefects).toEqual([]);
    expect(result.sizeTable.length).toBeGreaterThan(0);
  });

  it('detects added and removed assets', () => {
    const webpackManifest = readFixture('webpack-identical.json');
    const rspackManifest = {
      ...readFixture('rspack-identical.json'),
      assets: readFixture('rspack-identical.json').assets.filter(
        (asset) => asset.name !== 'admin.c3d4e5f6.js',
      ),
    };

    const result = compareFixturePair(webpackManifest, rspackManifest);
    const kinds = result.parityDefects.map((defect) => defect.kind);

    expect(result.pass).toBe(false);
    expect(kinds).toContain('asset_removed');
  });

  it('detects size-changed assets', () => {
    const result = compareFixturePair(
      readFixture('webpack-size-drifted.json'),
      readFixture('rspack-size-drifted.json'),
      {
        bytesA: { 'main.a1b2c3d4.js': 100 },
        bytesB: { 'main.a1b2c3d4.js': 250 },
      },
    );

    expect(result.pass).toBe(false);
    expect(result.parityDefects.some((defect) => defect.kind === 'asset_size_changed')).toBe(true);
    expect(result.parityDefects.some((defect) => defect.asset === 'main.js')).toBe(true);
  });

  it('detects chunk-count divergence', () => {
    const result = compareFixturePair(
      readFixture('webpack-chunk-drifted.json'),
      readFixture('rspack-chunk-drifted.json'),
    );

    expect(result.pass).toBe(false);
    expect(result.parityDefects.some((defect) => defect.kind === 'chunk_count_mismatch')).toBe(true);
    expect(result.parityDefects.some((defect) => defect.kind === 'asset_added')).toBe(true);
  });

  it('detects hash-strategy divergence', () => {
    const result = compareFixturePair(
      readFixture('webpack-hash-drifted.json'),
      readFixture('rspack-hash-drifted.json'),
    );

    expect(result.pass).toBe(false);
    expect(result.parityDefects.some((defect) => defect.kind === 'hash_strategy_mismatch')).toBe(true);
  });

  it('reports byte-digest mismatches separately from manifest equivalence', () => {
    const manifest = readFixture('webpack-identical.json');
    const dirA = createOutputDir(manifest, { 'main.a1b2c3d4.js': 100 });
    const dirB = createOutputDir(manifest, { 'main.a1b2c3d4.js': 200 });

    const manifestA = normalizeFixture(manifest, dirA, 'webpack4');
    const manifestB = normalizeFixture(manifest, dirB, 'rspack');

    const result = compareBundles(manifestA, manifestB, {
      outputPathA: dirA,
      outputPathB: dirB,
      byteCompareRaw: {
        assets: ['main.js'],
        excludePatterns: ['\\.map$'],
      },
      allowlistRaw: { entries: [] },
    });

    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });

    expect(result.parityDefects.some((defect) => defect.kind === 'byte_digest_mismatch')).toBe(true);
  });

  it('suppresses allowlisted divergences', () => {
    const result = compareFixturePair(
      readFixture('webpack-chunk-drifted.json'),
      readFixture('rspack-chunk-drifted.json'),
      {
        compareOptions: {
          allowlistRaw: {
            entries: [
              {
                asset: '*',
                kind: 'chunk_count_mismatch',
                reason: 'Expected lazy chunk in rspack graph',
                issue: 'WO-002-fixture',
              },
              {
                asset: 'lazy.chunk.js',
                kind: 'asset_added',
                reason: 'Rspack emits native export chunk',
                issue: 'WO-002-fixture',
              },
            ],
          },
        },
      },
    );

    expect(result.summary.suppressedCount).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
    expect(result.parityDefects).toEqual([]);
  });

  it('fails loudly on empty manifests', () => {
    expect(() => assertValidManifest({ assets: [], chunkCount: 0 }, 'A')).toThrow(/empty/i);
    expect(() => assertValidManifest(null, 'A')).toThrow(/missing/i);
  });

  it('includes a human-readable diff report', () => {
    const result = compareFixturePair(
      readFixture('webpack-chunk-drifted.json'),
      readFixture('rspack-chunk-drifted.json'),
    );

    expect(result.diffReport).toContain('# Bundle Parity Diff Report');
    expect(result.diffReport).toContain('chunk_count_mismatch');
  });
});
