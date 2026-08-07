'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  stripContentHash,
  detectHashedNameStrategy,
  normalizeManifest,
  aggregateEntryBytes,
  compareBaselinesForReproducibility,
} = require('../../scripts/frontend/manifestNormalizer');
const { getProductionEntryPointNames } = require('../../scripts/frontend/getProductionEntryPoints');

const FIXTURE_PATH = path.join(__dirname, '../../fixtures/frontend/synthetic-manifest.json');

function createTempOutputDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-test-'));
  const manifest = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

  for (const asset of manifest.assets) {
    const filePath = path.join(dir, asset.name);
    fs.writeFileSync(filePath, `console.log('${asset.entry}');`);
  }

  return { dir, manifest };
}

describe('manifestNormalizer', () => {
  describe('stripContentHash', () => {
    it('normalises assets with identical logical names but different hashes to the same key', () => {
      expect(stripContentHash('main.a1b2c3d4.js')).toBe('main.js');
      expect(stripContentHash('main.deadbeef.js')).toBe('main.js');
      expect(stripContentHash('lazy.f1e2d3c4.chunk.js')).toBe('lazy.chunk.js');
    });

    it('leaves unhashed names unchanged', () => {
      expect(stripContentHash('main.js')).toBe('main.js');
    });
  });

  describe('detectHashedNameStrategy', () => {
    it('detects contenthash strategy from asset names', () => {
      expect(detectHashedNameStrategy(['main.a1b2c3d4.js', 'pages.e5f6a7b8.js'])).toBe(
        '[name].[contenthash:8].js',
      );
    });

    it('falls back to unhashed strategy when no hashes present', () => {
      expect(detectHashedNameStrategy(['main.js', 'pages.js'])).toBe('[name].js');
    });
  });

  describe('aggregateEntryBytes', () => {
    it('aggregates byte totals per entry point', () => {
      const totals = aggregateEntryBytes([
        { entry: 'main', bytes: 100 },
        { entry: 'main', bytes: 50 },
        { entry: 'pages', bytes: 200 },
      ]);

      expect(totals).toEqual({ main: 150, pages: 200 });
    });
  });

  describe('normalizeManifest', () => {
    let tempDir;
    let rawManifest;

    beforeEach(() => {
      ({ dir: tempDir, manifest: rawManifest } = createTempOutputDir());
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('produces deterministic asset ordering from the synthetic fixture', () => {
      const baseline = normalizeManifest(rawManifest, {
        outputPath: tempDir,
        gitSha: 'abc123',
        wallClockSeconds: { cold: 1.5, warm: 0.8 },
      });

      const assetLogicalNames = baseline.assets.map((asset) => asset.logicalName);
      expect(assetLogicalNames).toEqual(['main.js', 'pages.js']);

      const entryNames = baseline.entryPoints.map((entry) => entry.name);
      expect(entryNames).toEqual(getProductionEntryPointNames());
    });

    it('includes entry points with empty asset lists rather than omitting them', () => {
      const baseline = normalizeManifest(rawManifest, {
        outputPath: tempDir,
        gitSha: 'abc123',
      });

      const devToolsEntry = baseline.entryPoints.find((entry) => entry.name === 'dev_tools');
      expect(devToolsEntry).toBeDefined();
      expect(devToolsEntry.assets).toEqual([]);
      expect(devToolsEntry.assetCount).toBe(0);
      expect(devToolsEntry.totalBytes).toBe(0);
    });

    it('extracts chunk count and hashed-name strategy separately', () => {
      const baseline = normalizeManifest(rawManifest, {
        outputPath: tempDir,
        gitSha: 'abc123',
      });

      expect(baseline.chunkCount).toBe(2);
      expect(baseline.hashedNameStrategy).toBe('[name].[contenthash:8].js');
    });

    it('aggregates stable size totals per entry point', () => {
      const baseline = normalizeManifest(rawManifest, {
        outputPath: tempDir,
        gitSha: 'abc123',
      });

      expect(baseline.entryByteTotals.main).toBeGreaterThan(0);
      expect(baseline.entryByteTotals.pages).toBeGreaterThan(0);
    });
  });

  describe('compareBaselinesForReproducibility', () => {
    it('considers baselines equal when only wall-clock and timestamps differ', () => {
      const shared = {
        chunkCount: 2,
        hashedNameStrategy: '[name].[contenthash:8].js',
        entryPoints: [{ name: 'main', assetCount: 1, totalBytes: 100, assets: [] }],
        assets: [{ name: 'main.a1b2c3d4.js', logicalName: 'main.js', entry: 'main', bytes: 100, gzipBytes: null }],
      };

      const runA = {
        ...shared,
        generatedAt: '2026-01-01T00:00:00.000Z',
        wallClockSeconds: { cold: 1.0, warm: 0.5 },
      };

      const runB = {
        ...shared,
        generatedAt: '2026-01-02T00:00:00.000Z',
        wallClockSeconds: { cold: 2.0, warm: 1.0 },
      };

      const result = compareBaselinesForReproducibility(runA, runB);
      expect(result.equal).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it('detects differences in asset lists across runs', () => {
      const runA = {
        chunkCount: 2,
        hashedNameStrategy: '[name].[contenthash:8].js',
        entryPoints: [],
        assets: [{ name: 'main.a1b2c3d4.js', logicalName: 'main.js', entry: 'main', bytes: 100, gzipBytes: null }],
      };

      const runB = {
        ...runA,
        assets: [{ name: 'main.deadbeef.js', logicalName: 'main.js', entry: 'main', bytes: 100, gzipBytes: null }],
      };

      const result = compareBaselinesForReproducibility(runA, runB);
      expect(result.equal).toBe(false);
      expect(result.differences.length).toBeGreaterThan(0);
    });
  });
});

describe('getProductionEntryPoints', () => {
  it('enumerates 100% of production entry points from webpack config', () => {
    const names = getProductionEntryPointNames();
    expect(names).toContain('main');
    expect(names).toContain('pages');
    expect(names).toContain('admin');
    expect(names).toContain('dev_tools');
    expect(names.length).toBe(4);
  });
});
