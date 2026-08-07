#!/usr/bin/env node
'use strict';

/**
 * Validates config/parity/webpack4-baseline.json against the committed JSON schema.
 * Used in CI and locally after baseline regeneration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(ROOT, 'config/parity/webpack4-baseline.json');
const SCHEMA_PATH = path.join(ROOT, 'config/parity/baseline.schema.json');

function main() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`Baseline file not found: ${BASELINE_PATH}`);
    process.exit(1);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(baseline);

  if (!valid) {
    console.error('Baseline validation failed:');
    for (const error of validate.errors || []) {
      console.error(`  - ${error.instancePath || '/'} ${error.message}`);
    }
    process.exit(1);
  }

  console.log('Baseline validates against schema.');
}

main();
