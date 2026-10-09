#!/usr/bin/env node
'use strict';

/**
 * Emit bundler-distinct normalised manifest + size table after a production build (WO-022).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { emitBuildArtifacts } = require('./emitBuildArtifacts.js');

function log(message) {
  process.stderr.write(`[emit_build_artifacts] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    bundler: null,
    manifest: null,
    output: null,
    reportsRoot: 'reports/parity',
    gitSha: process.env.CI_COMMIT_SHA || 'unknown',
    wallClock: null,
    startedAt: null,
    finishedAt: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--bundler':
        args.bundler = next;
        i += 1;
        break;
      case '--manifest':
        args.manifest = next;
        i += 1;
        break;
      case '--output':
        args.output = next;
        i += 1;
        break;
      case '--reports-root':
        args.reportsRoot = next;
        i += 1;
        break;
      case '--git-sha':
        args.gitSha = next;
        i += 1;
        break;
      case '--wall-clock-seconds':
        args.wallClock = Number(next);
        i += 1;
        break;
      case '--started-at':
        args.startedAt = next;
        i += 1;
        break;
      case '--finished-at':
        args.finishedAt = next;
        i += 1;
        break;
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    log(error.message);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(`Usage: emit_build_artifacts.mjs --bundler <webpack4|rspack> --manifest <path> --output <distDir>\n`);
    process.exit(0);
  }

  if (!args.bundler || !args.manifest || !args.output) {
    log('Required: --bundler, --manifest, --output');
    process.exit(2);
  }

  const manifestPath = path.resolve(args.manifest);
  if (!fs.existsSync(manifestPath)) {
    log(`Manifest missing at expected path: ${manifestPath}`);
    process.exit(1);
  }

  let rawManifest;
  try {
    rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    log(`Failed to parse manifest ${manifestPath}: ${error.message}`);
    process.exit(1);
  }

  const wall = typeof args.wallClock === 'number' && !Number.isNaN(args.wallClock)
    ? { cold: args.wallClock, warm: args.wallClock }
    : { cold: 0, warm: 0 };

  try {
    const result = emitBuildArtifacts({
      bundler: args.bundler,
      rawManifest,
      outputPath: path.resolve(args.output),
      reportsRoot: path.resolve(args.reportsRoot),
      gitSha: args.gitSha,
      wallClockSeconds: wall,
      buildStartedAt: args.startedAt,
      buildFinishedAt: args.finishedAt,
    });
    log(`wrote ${result.paths.normalizedManifest}`);
    log(`wrote ${result.paths.sizeTable}`);
    log(`wrote ${result.paths.timing}`);
  } catch (error) {
    log(error.message);
    process.exit(1);
  }
}

main();
