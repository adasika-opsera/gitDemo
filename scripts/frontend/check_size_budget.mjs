#!/usr/bin/env node
'use strict';

/**
 * Per-entry bundle size budget gate (WO-003).
 * Compares current build entryByteTotals against the frozen webpack 4 baseline.
 * Exits non-zero when any entry exceeds its baseline or rebaseline audit fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeManifest } = require('./manifestNormalizer.js');
const {
  checkSizeBudget,
  formatViolationMessages,
  REBASELINE_REMEDIATION,
} = require('./checkSizeBudget.js');
const { loadRebaselineLog } = require('./loadParityConfig.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'config/parity/webpack4-baseline.json');
const REPORTS_DIR = path.join(ROOT, 'reports/parity');

function log(message) {
  process.stderr.write(`[check_size_budget] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    manifest: null,
    output: null,
    baseline: DEFAULT_BASELINE_PATH,
    currentTotals: null,
    reportsDir: REPORTS_DIR,
    skipRebaselineCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--manifest':
        args.manifest = next;
        index += 1;
        break;
      case '--output':
        args.output = next;
        index += 1;
        break;
      case '--baseline':
        args.baseline = next;
        index += 1;
        break;
      case '--current-totals':
        args.currentTotals = next;
        index += 1;
        break;
      case '--reports-dir':
        args.reportsDir = next;
        index += 1;
        break;
      case '--skip-rebaseline-check':
        args.skipRebaselineCheck = true;
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
  process.stdout.write(`Usage: check_size_budget.mjs [options]

Options:
  --manifest <path>         Path to asset-manifest.json from the current build
  --output <path>           Directory containing emitted assets (required with --manifest)
  --baseline <path>         Frozen baseline JSON (default: config/parity/webpack4-baseline.json)
  --current-totals <path>   Pre-computed entryByteTotals JSON (for fixture/integration tests)
  --reports-dir <path>      Output directory for reports (default: reports/parity)
  --skip-rebaseline-check   Skip rebaseline audit validation
  --help                    Show this help
`);
}

function readJsonFile(filePath, label) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} missing at expected path: ${absolutePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} unreadable at ${absolutePath}: ${error.message}`);
  }
}

function loadCurrentEntryByteTotals(args) {
  if (args.currentTotals) {
    const payload = readJsonFile(args.currentTotals, 'Current totals fixture');
    const totals = payload.entryByteTotals ?? payload;

    if (!totals || typeof totals !== 'object') {
      throw new Error('Current totals fixture must contain entryByteTotals object');
    }

    return {
      entryByteTotals: totals,
      currentSource: args.currentTotals,
    };
  }

  if (!args.manifest) {
    throw new Error('Missing required --manifest or --current-totals argument');
  }

  const rawManifest = readJsonFile(args.manifest, 'Asset manifest');
  const outputPath = path.resolve(args.output || path.dirname(path.resolve(args.manifest)));
  const normalized = normalizeManifest(rawManifest, {
    outputPath,
    bundler: 'current',
  });

  return {
    entryByteTotals: normalized.entryByteTotals,
    currentSource: args.manifest,
  };
}

function writeReports(result, reportsDir) {
  fs.mkdirSync(reportsDir, { recursive: true });

  const reportJsonPath = path.join(reportsDir, 'size-budget-report.json');
  const reportMarkdownPath = path.join(reportsDir, 'size-budget-report.md');

  fs.writeFileSync(reportJsonPath, `${JSON.stringify(result.reportJson, null, 2)}\n`);
  fs.writeFileSync(reportMarkdownPath, result.sizeBudgetReport);

  return { reportJsonPath, reportMarkdownPath };
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
    const baseline = readJsonFile(args.baseline, 'Baseline');
    const baselineEntryByteTotals = baseline.entryByteTotals;

    if (!baselineEntryByteTotals || typeof baselineEntryByteTotals !== 'object') {
      throw new Error('Baseline is missing entryByteTotals');
    }

    const { entryByteTotals: currentEntryByteTotals, currentSource } = loadCurrentEntryByteTotals(args);
    const rebaselineLog = args.skipRebaselineCheck ? null : loadRebaselineLog();

    const result = checkSizeBudget({
      baselineEntryByteTotals,
      currentEntryByteTotals,
      rebaselineLog,
      baselineSource: args.baseline,
      currentSource,
    });

    const reportPaths = writeReports(result, path.resolve(args.reportsDir));

    log(`size budget report: ${reportPaths.reportJsonPath}`);
    log(`size budget markdown: ${reportPaths.reportMarkdownPath}`);

    if (result.pass) {
      log('size budget check passed');
      process.exit(0);
    }

    if (!result.rebaselineValid) {
      log('rebaseline audit failed:');
      for (const error of result.rebaselineErrors) {
        log(`  - ${error}`);
      }
      log(REBASELINE_REMEDIATION);
    }

    if (result.violations.length > 0) {
      log('size budget violations:');
      for (const message of formatViolationMessages(result.violations)) {
        log(`  - ${message}`);
      }
    }

    log(`size budget check failed with ${result.violations.length} violation(s)`);
    log(REBASELINE_REMEDIATION);
    process.exit(1);
  } catch (error) {
    log(error.message);
    process.exit(2);
  }
}

main();
