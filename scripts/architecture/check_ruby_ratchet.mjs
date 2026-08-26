#!/usr/bin/env node
'use strict';

/**
 * Ruby per-directory RuboCop ratchet gate (WO-006).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const { checkRubyRatchet } = require('./rubyRatchet.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config/architecture/ruby-ratchet.yml');
const REPORTS_DIR = path.join(ROOT, 'reports/architecture');

function log(message) {
  process.stderr.write(`[check_ruby_ratchet] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG_PATH,
    rubocopJson: null,
    reportsDir: REPORTS_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--config':
        args.config = next;
        index += 1;
        break;
      case '--rubocop-json':
        args.rubocopJson = next;
        index += 1;
        break;
      case '--reports-dir':
        args.reportsDir = next;
        index += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function runRubocop() {
  try {
    const output = execFileSync(
      'bundle',
      ['exec', 'rubocop', 'app/models', 'app/services', '--format', 'json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    return JSON.parse(output);
  } catch (error) {
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch (parseError) {
        throw new Error(`RuboCop failed: ${error.stderr || error.message}`);
      }
    }

    throw new Error(`RuboCop failed: ${error.stderr || error.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = yaml.load(fs.readFileSync(args.config, 'utf8'));
  const rubocopJson = args.rubocopJson
    ? JSON.parse(fs.readFileSync(args.rubocopJson, 'utf8'))
    : runRubocop();

  const result = checkRubyRatchet({ config, rubocopJson });

  fs.mkdirSync(args.reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(args.reportsDir, 'ruby-ratchet-report.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  if (result.pass) {
    log('PASS: Ruby per-directory ratchet within limits');
    process.exit(0);
  }

  for (const failure of result.failures) {
    log(`FAIL: ${failure.message}`);
  }

  process.exit(1);
}

main();
