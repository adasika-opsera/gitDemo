#!/usr/bin/env node
'use strict';

/**
 * Records a webpack 4 production build baseline:
 * - cold and warm wall-clock timings
 * - per-entry asset manifest with byte sizes
 * - chunk count and hashed-name strategy
 *
 * Exits non-zero on build failure or missing manifest; never writes partial output.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeManifest } = require('./manifestNormalizer.js');
const { getProductionEntryPointNames } = require('./getProductionEntryPoints.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WEBPACK_CONFIG = path.join(ROOT, 'config/webpack.config.js');
const OUTPUT_PATH = path.join(ROOT, 'dist/webpack');
const MANIFEST_PATH = path.join(OUTPUT_PATH, 'asset-manifest.json');
const BASELINE_PATH = path.join(ROOT, 'config/parity/webpack4-baseline.json');

function log(message) {
  process.stderr.write(`[record_build_baseline] ${message}\n`);
}

function getGitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  return 'unknown';
}

function cleanOutputDirectory() {
  fs.rmSync(OUTPUT_PATH, { recursive: true, force: true });
}

function runWebpackBuild() {
  const start = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules/webpack/bin/webpack.js'),
      '--config',
      WEBPACK_CONFIG,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ENABLE_RSPACK: '',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const elapsedSeconds = (Date.now() - start) / 1000;

  if (result.status !== 0) {
    log('webpack build failed');
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    process.exit(result.status || 1);
  }

  return elapsedSeconds;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    log(`manifest file missing at expected path: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function writeBaseline(baseline) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  log(`baseline written to ${BASELINE_PATH}`);
}

function main() {
  if (process.env.WEBPACK_VENDOR_DLL === 'true') {
    log('vendor DLL builds are excluded from the production baseline');
    process.exit(0);
  }

  log('running cold production webpack build');
  cleanOutputDirectory();
  const coldSeconds = runWebpackBuild();

  log('running warm production webpack build');
  const warmSeconds = runWebpackBuild();

  const rawManifest = readManifest();
  const baseline = normalizeManifest(rawManifest, {
    outputPath: OUTPUT_PATH,
    gitSha: getGitSha(),
    bundler: 'webpack4',
    wallClockSeconds: {
      cold: Number(coldSeconds.toFixed(3)),
      warm: Number(warmSeconds.toFixed(3)),
    },
  });

  // Ensure all production entry points appear even when empty.
  const presentEntries = new Set(baseline.entryPoints.map((entry) => entry.name));
  for (const entryName of getProductionEntryPointNames()) {
    if (!presentEntries.has(entryName)) {
      baseline.entryPoints.push({
        name: entryName,
        assetCount: 0,
        totalBytes: 0,
        assets: [],
      });
    }
  }
  baseline.entryPoints.sort((a, b) => a.name.localeCompare(b.name));

  writeBaseline(baseline);
}

main();
