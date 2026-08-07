'use strict';

const {
  buildSmokeTargetList,
  evaluateEntrySmoke,
  aggregateSmokeResults,
  compareSmokeResults,
  smokeDivergencesToParityDefects,
} = require('../../scripts/frontend/smokeEntryPoints');
const { getProductionEntryPointNames } = require('../../scripts/frontend/getProductionEntryPoints');

const FIXTURES_DIR = `${__dirname}/../../fixtures/frontend/smoke`;

function readFixture(relativePath) {
  return JSON.parse(
    require('fs').readFileSync(`${FIXTURES_DIR}/${relativePath}`, 'utf8'),
  );
}

describe('buildSmokeTargetList', () => {
  it('enumerates all production entry points from the bundler config', () => {
    const manifest = readFixture('passing/asset-manifest.json');
    const targets = buildSmokeTargetList(manifest);

    expect(targets.map((target) => target.entry)).toEqual(getProductionEntryPointNames());
    expect(targets.filter((target) => target.runnable)).toHaveLength(3);
    expect(targets.find((target) => target.entry === 'dev_tools')).toMatchObject({
      runnable: false,
      skipReason: 'no_emitted_assets',
    });
  });

  it('maps each runnable entry to its primary script asset', () => {
    const manifest = readFixture('passing/asset-manifest.json');
    const targets = buildSmokeTargetList(manifest);

    expect(targets.find((target) => target.entry === 'main')).toMatchObject({
      script: 'main.pass.js',
      runnable: true,
    });
  });
});

describe('evaluateEntrySmoke', () => {
  it('passes when the script loads, mounts, and emits no errors', () => {
    const result = evaluateEntrySmoke({
      runnable: true,
      scriptLoaded: true,
      mounted: true,
      consoleErrors: [],
      unhandledRejections: [],
    });

    expect(result).toEqual({ status: 'pass', failures: [] });
  });

  it('fails on console errors, unhandled rejections, or missing mount signal', () => {
    expect(evaluateEntrySmoke({
      runnable: true,
      scriptLoaded: true,
      mounted: false,
      consoleErrors: [],
      unhandledRejections: [],
    }).status).toBe('fail');

    expect(evaluateEntrySmoke({
      runnable: true,
      scriptLoaded: true,
      mounted: true,
      consoleErrors: ['boom'],
      unhandledRejections: [],
    }).failures[0]).toMatch(/console.error/);

    expect(evaluateEntrySmoke({
      runnable: true,
      scriptLoaded: true,
      mounted: true,
      consoleErrors: [],
      unhandledRejections: ['lazy route failed'],
    }).failures[0]).toMatch(/unhandled rejection/);
  });

  it('skips zero-asset entries', () => {
    expect(evaluateEntrySmoke({ runnable: false }).status).toBe('skipped');
  });
});

describe('aggregateSmokeResults', () => {
  it('summarises pass, fail, and skipped counts', () => {
    const payload = aggregateSmokeResults({
      bundler: 'webpack4',
      assetRoot: 'dist/webpack',
      entries: [
        { entry: 'main', status: 'pass' },
        { entry: 'admin', status: 'fail', failures: ['console.error: boom'] },
        { entry: 'dev_tools', status: 'skipped', skipReason: 'no_emitted_assets' },
      ],
    });

    expect(payload.pass).toBe(false);
    expect(payload.summary).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    });
  });
});

describe('compareSmokeResults', () => {
  it('passes when both bundlers report the same per-entry status', () => {
    const left = aggregateSmokeResults({
      bundler: 'webpack4',
      assetRoot: 'dist/webpack',
      entries: [
        { entry: 'main', status: 'pass' },
        { entry: 'admin', status: 'pass' },
        { entry: 'dev_tools', status: 'skipped' },
      ],
    });
    const right = aggregateSmokeResults({
      bundler: 'rspack',
      assetRoot: 'dist/rspack',
      entries: [
        { entry: 'main', status: 'pass' },
        { entry: 'admin', status: 'pass' },
        { entry: 'dev_tools', status: 'skipped' },
      ],
    });

    expect(compareSmokeResults(left, right)).toMatchObject({
      pass: true,
      divergences: [],
    });
  });

  it('detects pass/fail divergence for the same entry', () => {
    const left = aggregateSmokeResults({
      bundler: 'webpack4',
      assetRoot: 'dist/webpack',
      entries: [{ entry: 'admin', status: 'pass' }],
    });
    const right = aggregateSmokeResults({
      bundler: 'rspack',
      assetRoot: 'dist/rspack',
      entries: [{ entry: 'admin', status: 'fail', failures: ['console.error: boom'] }],
    });

    const comparison = compareSmokeResults(left, right);

    expect(comparison.pass).toBe(false);
    expect(comparison.divergences).toHaveLength(1);
    expect(comparison.divergences[0]).toMatchObject({
      entry: 'admin',
      statusA: 'pass',
      statusB: 'fail',
    });
  });

  it('maps divergences into parity-defect records', () => {
    const comparison = compareSmokeResults(
      aggregateSmokeResults({
        bundler: 'webpack4',
        assetRoot: 'dist/webpack',
        entries: [{ entry: 'pages', status: 'pass' }],
      }),
      aggregateSmokeResults({
        bundler: 'rspack',
        assetRoot: 'dist/rspack',
        entries: [{ entry: 'pages', status: 'fail', failures: ['entry did not set __GITLAB_ENTRY_MOUNTED__'] }],
      }),
    );

    expect(smokeDivergencesToParityDefects(comparison)).toEqual([
      expect.objectContaining({
        kind: 'runtime_smoke_divergence',
        asset: 'pages',
      }),
    ]);
  });
});

describe('fixture smoke harness integration', () => {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const scriptPath = path.join(__dirname, '../../scripts/frontend/smoke_entry_points.mjs');

  function runSmoke(args, env = {}) {
    return spawnSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  }

  it('passes against the committed passing fixture assets', () => {
    const outputPath = path.join(os.tmpdir(), `smoke-pass-${Date.now()}.json`);
    const result = runSmoke([
      '--asset-root', `${FIXTURES_DIR}/passing`,
      '--bundler', 'fixture-pass',
      '--output', outputPath,
    ]);

    expect(result.status).toBe(0);

    const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(payload.pass).toBe(true);
    expect(payload.summary.failed).toBe(0);
    expect(payload.entries.find((entry) => entry.entry === 'dev_tools').status).toBe('skipped');

    fs.unlinkSync(outputPath);
  });

  it('fails against the committed failing fixture entry', () => {
    const outputPath = path.join(os.tmpdir(), `smoke-fail-${Date.now()}.json`);
    const result = runSmoke([
      '--asset-root', `${FIXTURES_DIR}/failing`,
      '--bundler', 'fixture-fail',
      '--output', outputPath,
    ]);

    expect(result.status).toBe(1);

    const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(payload.pass).toBe(false);
    expect(payload.entries.find((entry) => entry.entry === 'admin').status).toBe('fail');

    fs.unlinkSync(outputPath);
  });

  it('diff mode fails when bundler results diverge', () => {
    const leftPath = path.join(os.tmpdir(), `smoke-left-${Date.now()}.json`);
    const rightPath = path.join(os.tmpdir(), `smoke-right-${Date.now()}.json`);
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-diff-'));

    fs.writeFileSync(leftPath, `${JSON.stringify(aggregateSmokeResults({
      bundler: 'webpack4',
      assetRoot: 'dist/webpack',
      entries: [{ entry: 'admin', status: 'pass' }],
    }), null, 2)}\n`);

    fs.writeFileSync(rightPath, `${JSON.stringify(aggregateSmokeResults({
      bundler: 'rspack',
      assetRoot: 'dist/rspack',
      entries: [{ entry: 'admin', status: 'fail', failures: ['console.error: boom'] }],
    }), null, 2)}\n`);

    const result = runSmoke([
      '--mode', 'diff',
      '--results-a', leftPath,
      '--results-b', rightPath,
      '--reports-dir', reportDir,
    ]);

    expect(result.status).toBe(1);
    expect(fs.existsSync(path.join(reportDir, 'smoke-divergence-report.json'))).toBe(true);

    fs.unlinkSync(leftPath);
    fs.unlinkSync(rightPath);
    fs.rmSync(reportDir, { recursive: true, force: true });
  });
});
