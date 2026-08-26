#!/usr/bin/env node
'use strict';

/**
 * Architectural layer ratchet gate (WO-006).
 * Compares dependency-cruiser violations against a committed baseline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  checkLayerRatchet,
  formatFailureMessages,
  normalizeViolations,
} = require('./layerRatchet.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'config/architecture/layer-violations-baseline.json');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config/dependency_cruiser.js');
const REPORTS_DIR = path.join(ROOT, 'reports/architecture');

function log(message) {
  process.stderr.write(`[check_layer_ratchet] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    baseline: DEFAULT_BASELINE_PATH,
    config: DEFAULT_CONFIG_PATH,
    reportsDir: REPORTS_DIR,
    currentViolations: null,
    outputProgress: path.join(REPORTS_DIR, 'layer-ratchet-progress.json'),
    outputMarkdown: path.join(REPORTS_DIR, 'layer-ratchet-report.md'),
    timeoutMs: 120000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--baseline':
        args.baseline = next;
        index += 1;
        break;
      case '--config':
        args.config = next;
        index += 1;
        break;
      case '--reports-dir':
        args.reportsDir = next;
        index += 1;
        break;
      case '--current-violations':
        args.currentViolations = next;
        index += 1;
        break;
      case '--output-progress':
        args.outputProgress = next;
        index += 1;
        break;
      case '--output-markdown':
        args.outputMarkdown = next;
        index += 1;
        break;
      case '--timeout-ms':
        args.timeoutMs = Number(next);
        index += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runDependencyCruiser(configPath, timeoutMs) {
  const depcruiseBin = path.join(ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs');

  try {
    const output = execFileSync(
      process.execPath,
      [
        depcruiseBin,
        '--config',
        configPath,
        '--output-type',
        'json',
        'app/assets/javascripts',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const parsed = JSON.parse(output);
    return parsed.summary?.violations || [];
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') {
      const partialPath = path.join(REPORTS_DIR, 'layer-ratchet-partial.json');
      fs.mkdirSync(path.dirname(partialPath), { recursive: true });

      const partialPayload = {
        error: 'dependency-cruiser timed out',
        timeoutMs,
      };

      fs.writeFileSync(partialPath, `${JSON.stringify(partialPayload, null, 2)}\n`);
      throw new Error(`dependency-cruiser timed out after ${timeoutMs}ms; partial artifact at ${partialPath}`);
    }

    if (error.stdout) {
      try {
        const parsed = JSON.parse(error.stdout);
        return parsed.summary?.violations || [];
      } catch (parseError) {
        throw new Error(`dependency-cruiser failed: ${error.message}`);
      }
    }

    throw error;
  }
}

function writeReports(result, args) {
  fs.mkdirSync(args.reportsDir, { recursive: true });
  fs.writeFileSync(args.outputProgress, `${JSON.stringify(result.reportJson.progress, null, 2)}\n`);
  fs.writeFileSync(args.outputMarkdown, result.reportMarkdown);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let baseline;

  try {
    baseline = readJson(args.baseline);
  } catch (error) {
    log(`Baseline parse failed: ${error.message}`);
    process.exit(2);
  }

  let rawViolations;

  if (args.currentViolations) {
    const payload = readJson(args.currentViolations);
    rawViolations = payload.violations || payload;
  } else {
    log(`Running dependency-cruiser with ${args.config}`);
    rawViolations = runDependencyCruiser(args.config, args.timeoutMs);
  }

  const result = checkLayerRatchet({
    baseline,
    currentViolations: rawViolations,
  });

  writeReports(result, args);

  if (result.pass) {
    log(
      `PASS: ${result.progress.currentCount}/${result.progress.baselineCount} violations `
      + `(${result.progress.reductionPercent}% reduction, target ${result.progress.reductionTargetPercent}%)`,
    );
    process.exit(0);
  }

  for (const message of formatFailureMessages(result.failures)) {
    log(`FAIL: ${message}`);
  }

  process.exit(1);
}

main();
