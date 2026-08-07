#!/usr/bin/env node
'use strict';

/**
 * Dual-bundler parity harness (WO-002).
 * Normalises two asset manifests, compares them, and emits report artifacts.
 * Exits non-zero when blocking divergences are found outside the allowlist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeManifest } = require('./manifestNormalizer.js');
const { compareBundles } = require('./compareBundles.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const REPORTS_DIR = path.join(ROOT, 'reports/parity');

function log(message) {
  process.stderr.write(`[compare_bundles] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    manifestA: null,
    manifestB: null,
    outputA: null,
    outputB: null,
    bundlerA: 'webpack4',
    bundlerB: 'rspack',
    reportsDir: REPORTS_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--manifest-a':
        args.manifestA = next;
        index += 1;
        break;
      case '--manifest-b':
        args.manifestB = next;
        index += 1;
        break;
      case '--output-a':
        args.outputA = next;
        index += 1;
        break;
      case '--output-b':
        args.outputB = next;
        index += 1;
        break;
      case '--bundler-a':
        args.bundlerA = next;
        index += 1;
        break;
      case '--bundler-b':
        args.bundlerB = next;
        index += 1;
        break;
      case '--reports-dir':
        args.reportsDir = next;
        index += 1;
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

function printHelp() {
  process.stdout.write(`Usage: compare_bundles.mjs [options]

Options:
  --manifest-a <path>   Path to bundler A asset-manifest.json (required)
  --manifest-b <path>   Path to bundler B asset-manifest.json (required)
  --output-a <path>     Directory containing bundler A emitted assets
  --output-b <path>     Directory containing bundler B emitted assets
  --bundler-a <name>    Label for bundler A (default: webpack4)
  --bundler-b <name>    Label for bundler B (default: rspack)
  --reports-dir <path>  Output directory for reports (default: reports/parity)
`);
}

function readManifestFile(manifestPath, label) {
  if (!manifestPath) {
    throw new Error(`Missing required --manifest-${label.toLowerCase()} argument`);
  }

  const absolutePath = path.resolve(manifestPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} manifest missing at expected path: ${absolutePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} manifest unreadable at ${absolutePath}: ${error.message}`);
  }
}

function writeReports(result, reportsDir) {
  fs.mkdirSync(reportsDir, { recursive: true });

  const diffReportPath = path.join(reportsDir, 'diff-report.md');
  const sizeTablePath = path.join(reportsDir, 'size-table.json');
  const parityDefectsPath = path.join(reportsDir, 'parity-defects.json');

  fs.writeFileSync(diffReportPath, result.diffReport);
  fs.writeFileSync(sizeTablePath, `${JSON.stringify(result.sizeTable, null, 2)}\n`);
  fs.writeFileSync(
    parityDefectsPath,
    `${JSON.stringify({ pass: result.pass, summary: result.summary, defects: result.parityDefects }, null, 2)}\n`,
  );

  return { diffReportPath, sizeTablePath, parityDefectsPath };
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
    printHelp();
    process.exit(0);
  }

  try {
    const rawManifestA = readManifestFile(args.manifestA, 'A');
    const rawManifestB = readManifestFile(args.manifestB, 'B');

    const outputPathA = path.resolve(args.outputA || path.dirname(path.resolve(args.manifestA)));
    const outputPathB = path.resolve(args.outputB || path.dirname(path.resolve(args.manifestB)));

    const manifestA = normalizeManifest(rawManifestA, {
      outputPath: outputPathA,
      bundler: args.bundlerA,
    });
    const manifestB = normalizeManifest(rawManifestB, {
      outputPath: outputPathB,
      bundler: args.bundlerB,
    });

    const result = compareBundles(manifestA, manifestB, {
      outputPathA,
      outputPathB,
    });

    const reportPaths = writeReports(result, path.resolve(args.reportsDir));

    log(`diff report: ${reportPaths.diffReportPath}`);
    log(`size table: ${reportPaths.sizeTablePath}`);
    log(`parity defects: ${reportPaths.parityDefectsPath}`);

    if (result.pass) {
      log('parity check passed');
      process.exit(0);
    }

    log(`parity check failed with ${result.summary.blockingCount} blocking defect(s)`);
    process.exit(1);
  } catch (error) {
    log(error.message);
    process.exit(2);
  }
}

main();
