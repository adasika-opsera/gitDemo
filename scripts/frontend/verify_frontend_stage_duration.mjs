#!/usr/bin/env node
'use strict';

/**
 * Compare dual-build frontend stage wall-clock against a committed baseline (WO-022).
 * Stage duration is max(webpack timing, rspack timing) because the jobs run in parallel.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  artifactPathsForBundler,
  compareFrontendStageDuration,
} = require('./emitBuildArtifacts.js');

function log(message) {
  process.stderr.write(`[verify_frontend_stage_duration] ${message}\n`);
}

function readTiming(bundler, reportsRoot) {
  const timingPath = artifactPathsForBundler(bundler, reportsRoot).timing;
  if (!fs.existsSync(timingPath)) {
    throw new Error(`Missing timing artifact for ${bundler} at ${timingPath}`);
  }
  return JSON.parse(fs.readFileSync(timingPath, 'utf8'));
}

function wallSeconds(timing) {
  const cold = timing?.wallClockSeconds?.cold;
  if (typeof cold === 'number' && !Number.isNaN(cold)) {
    return cold;
  }
  throw new Error(`Timing artifact for ${timing.bundler} lacks wallClockSeconds.cold`);
}

function main() {
  const reportsRoot = process.argv.includes('--reports-root')
    ? process.argv[process.argv.indexOf('--reports-root') + 1]
    : 'reports/parity';
  const baselinePath = process.argv.includes('--baseline')
    ? process.argv[process.argv.indexOf('--baseline') + 1]
    : 'config/parity/frontend-stage-duration-baseline.json';

  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const webpackTiming = readTiming('webpack4', reportsRoot);
    const rspackTiming = readTiming('rspack', reportsRoot);
    const currentSeconds = Math.max(wallSeconds(webpackTiming), wallSeconds(rspackTiming));
    const result = compareFrontendStageDuration(currentSeconds, baseline.maxWallClockSeconds, 0);

    const report = {
      pass: result.pass,
      currentSeconds: result.currentSeconds,
      baselineSeconds: result.baselineSeconds,
      deltaSeconds: result.deltaSeconds,
      mode: 'parallel_max',
      webpackSeconds: wallSeconds(webpackTiming),
      rspackSeconds: wallSeconds(rspackTiming),
      recordedAt: new Date().toISOString(),
    };

    const outDir = path.join(reportsRoot, 'builds');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'frontend-stage-duration-report.json');
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    log(`wrote ${outPath}`);

    if (!result.pass) {
      log(
        `Frontend stage duration ${result.currentSeconds}s exceeds baseline ${result.baselineSeconds}s (+0% tolerance)`,
      );
      process.exit(1);
    }

    log(`Frontend stage duration OK: ${result.currentSeconds}s <= ${result.baselineSeconds}s`);
  } catch (error) {
    log(error.message);
    process.exit(1);
  }
}

main();
