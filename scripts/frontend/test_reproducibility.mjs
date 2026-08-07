#!/usr/bin/env node
'use strict';

/**
 * Integration test: run baseline recorder twice and assert reproducible output
 * (asset lists and chunk counts; wall-clock excluded).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareBaselinesForReproducibility } = require('./manifestNormalizer.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(ROOT, 'config/parity/webpack4-baseline.json');
const TEMP_BASELINE = path.join(ROOT, 'config/parity/webpack4-baseline.rerun.json');

function runBaselineScript() {
  const result = spawnSync(process.execPath, ['scripts/frontend/record_build_baseline.mjs'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

function main() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('Committed baseline not found; run yarn record-baseline first.');
    process.exit(1);
  }

  const committed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

  runBaselineScript();

  const regenerated = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  fs.writeFileSync(TEMP_BASELINE, JSON.stringify(regenerated, null, 2));

  const comparison = compareBaselinesForReproducibility(committed, regenerated);

  if (!comparison.equal) {
    console.error('Reproducibility check failed:');
    for (const diff of comparison.differences) {
      console.error(`  - ${diff}`);
    }
    process.exit(1);
  }

  console.log('Reproducibility check passed: asset lists and chunk counts match across runs.');
}

main();
