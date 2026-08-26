#!/usr/bin/env node
'use strict';

/**
 * Generate the committed layer-violations baseline from dependency-cruiser output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  normalizeViolations,
  REDUCTION_TARGET_PERCENT,
} = require('./layerRatchet.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config/dependency_cruiser.js');
const DEFAULT_OUTPUT_PATH = path.join(ROOT, 'config/architecture/layer-violations-baseline.json');

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG_PATH,
    output: DEFAULT_OUTPUT_PATH,
    target: 'app/assets/javascripts',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--config':
        args.config = next;
        index += 1;
        break;
      case '--output':
        args.output = next;
        index += 1;
        break;
      case '--target':
        args.target = next;
        index += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const depcruiseBin = path.join(ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs');

  const output = execFileSync(
    process.execPath,
    [
      depcruiseBin,
      '--config',
      args.config,
      '--output-type',
      'json',
      args.target,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const parsed = JSON.parse(output);
  const violations = normalizeViolations(parsed.summary?.violations || []);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baselineCount: violations.length,
    reductionTargetPercent: REDUCTION_TARGET_PERCENT,
    violations: violations.map((violation) => ({
      rule: violation.rule,
      from: violation.from,
      to: violation.to,
      key: violation.key,
      stableKey: violation.stableKey,
      mirror: violation.mirror,
      message: violation.message,
    })),
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(`[record_layer_baseline] Wrote ${violations.length} violations to ${args.output}\n`);
}

main();
