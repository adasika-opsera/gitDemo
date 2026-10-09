'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SUPPORTED_BUNDLERS,
  artifactPathsForBundler,
  buildSizeTable,
  emitBuildArtifacts,
  compareFrontendStageDuration,
} = require('../../scripts/frontend/emitBuildArtifacts');

const FIXTURE = path.join(__dirname, '../../fixtures/frontend/synthetic-manifest.json');

function createOutputDir(rawManifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-artifacts-'));
  for (const asset of rawManifest.assets) {
    fs.writeFileSync(path.join(dir, asset.name), 'x'.repeat(120));
  }
  return dir;
}

describe('emitBuildArtifacts', () => {
  it('exposes supported bundler names', () => {
    expect(SUPPORTED_BUNDLERS).toEqual(['webpack4', 'rspack']);
  });

  it('builds bundler-distinct artifact paths', () => {
    const webpackPaths = artifactPathsForBundler('webpack4', 'reports/parity');
    const rspackPaths = artifactPathsForBundler('rspack', 'reports/parity');

    expect(webpackPaths.normalizedManifest).toBe(
      path.join('reports/parity/builds/webpack4/normalized-manifest.json'),
    );
    expect(rspackPaths.sizeTable).toBe(
      path.join('reports/parity/builds/rspack/size-table.json'),
    );
    expect(webpackPaths.dir).not.toBe(rspackPaths.dir);
  });

  it('rejects unknown bundlers for artifact naming', () => {
    expect(() => artifactPathsForBundler('vite')).toThrow(/Unsupported bundler/);
  });

  it('builds a size table from a normalised manifest', () => {
    const sizeTable = buildSizeTable({
      bundler: 'webpack4',
      generatedAt: '2026-01-01T00:00:00.000Z',
      gitSha: 'abc',
      chunkCount: 2,
      hashedNameStrategy: '[name].[contenthash:8].js',
      entryByteTotals: { main: 10, pages: 20 },
      assets: [{ name: 'main.a.js', logicalName: 'main.js', entry: 'main', bytes: 10, gzipBytes: 4 }],
    });

    expect(sizeTable.entries).toEqual([
      { entry: 'main', bytes: 10 },
      { entry: 'pages', bytes: 20 },
    ]);
    expect(sizeTable.entryByteTotals.main).toBe(10);
  });

  it('emits normalised manifest, size table, and timing artifacts', () => {
    const rawManifest = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const outputDir = createOutputDir(rawManifest);
    const reportsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-reports-'));

    const result = emitBuildArtifacts({
      bundler: 'rspack',
      rawManifest,
      outputPath: outputDir,
      reportsRoot,
      gitSha: 'test-sha',
      wallClockSeconds: { cold: 1.5, warm: 1.1 },
      buildStartedAt: '2026-01-01T00:00:00.000Z',
      buildFinishedAt: '2026-01-01T00:00:01.500Z',
    });

    expect(fs.existsSync(result.paths.normalizedManifest)).toBe(true);
    expect(fs.existsSync(result.paths.sizeTable)).toBe(true);
    expect(fs.existsSync(result.paths.timing)).toBe(true);

    const normalized = JSON.parse(fs.readFileSync(result.paths.normalizedManifest, 'utf8'));
    const sizeTable = JSON.parse(fs.readFileSync(result.paths.sizeTable, 'utf8'));
    const timing = JSON.parse(fs.readFileSync(result.paths.timing, 'utf8'));

    expect(normalized.bundler).toBe('rspack');
    expect(normalized.gitSha).toBe('test-sha');
    expect(sizeTable.bundler).toBe('rspack');
    expect(Object.keys(sizeTable.entryByteTotals).length).toBeGreaterThan(0);
    expect(timing.wallClockSeconds.cold).toBe(1.5);

    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(reportsRoot, { recursive: true, force: true });
  });

  it('fails closed when required inputs are missing', () => {
    expect(() => emitBuildArtifacts({ bundler: 'webpack4' })).toThrow(/rawManifest/);
  });
});

describe('compareFrontendStageDuration', () => {
  it('passes when current duration is at or under baseline (+0%)', () => {
    expect(compareFrontendStageDuration(10, 12).pass).toBe(true);
    expect(compareFrontendStageDuration(12, 12).pass).toBe(true);
  });

  it('fails when current duration exceeds baseline', () => {
    const result = compareFrontendStageDuration(13, 12);
    expect(result.pass).toBe(false);
    expect(result.deltaSeconds).toBe(1);
  });
});
