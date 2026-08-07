'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const ALLOWLIST_PATH = path.join(ROOT, 'config/parity/allowlist.yml');
const BYTE_COMPARE_PATH = path.join(ROOT, 'config/parity/byte-compare.yml');
const REBASELINE_LOG_PATH = path.join(ROOT, 'config/parity/rebaseline-log.yml');

/**
 * @param {string} filePath
 * @returns {object}
 */
function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Parity config missing at expected path: ${filePath}`);
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Parity config at ${filePath} must be a YAML object`);
  }

  return parsed;
}

/**
 * Validate and normalise the parity allowlist.
 * Every entry must include asset, kind, reason, and issue.
 *
 * @param {object} [raw]
 * @returns {Array<{ asset: string, kind: string, reason: string, issue: string }>}
 */
function loadAllowlist(raw) {
  const config = raw ?? readYamlFile(ALLOWLIST_PATH);
  const entries = Array.isArray(config.entries) ? config.entries : [];

  const normalised = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const prefix = `allowlist entry ${index + 1}`;

    if (!entry || typeof entry !== 'object') {
      throw new Error(`${prefix}: must be an object`);
    }

    const { asset, kind, reason, issue } = entry;

    if (!asset || typeof asset !== 'string') {
      throw new Error(`${prefix}: "asset" must be a non-empty string`);
    }
    if (!kind || typeof kind !== 'string') {
      throw new Error(`${prefix}: "kind" must be a non-empty string`);
    }
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`${prefix}: "reason" is required`);
    }
    if (!issue || typeof issue !== 'string' || issue.trim() === '') {
      throw new Error(`${prefix}: "issue" reference is required`);
    }

    normalised.push({
      asset,
      kind,
      reason: reason.trim(),
      issue: issue.trim(),
    });
  }

  return normalised;
}

/**
 * Load byte-comparison asset subset configuration.
 *
 * @param {object} [raw]
 * @returns {{ assets: string[], excludePatterns: string[] }}
 */
function loadByteCompareConfig(raw) {
  const config = raw ?? readYamlFile(BYTE_COMPARE_PATH);
  const assets = Array.isArray(config.assets) ? config.assets.map(String) : [];
  const excludePatterns = Array.isArray(config.excludePatterns)
    ? config.excludePatterns.map(String)
    : ['\\.map$', '\\.(gz|br)$'];

  return { assets, excludePatterns };
}

/**
 * Validate and normalise the rebaseline audit log.
 * Every entry must include entry, previousBytes, newBytes, reason, and issue.
 *
 * @param {object} [raw]
 * @returns {{ originalEntryByteTotals: Record<string, number>, entries: object[] }}
 */
function loadRebaselineLog(raw) {
  const config = raw ?? readYamlFile(REBASELINE_LOG_PATH);
  const originalEntryByteTotals = config.originalEntryByteTotals && typeof config.originalEntryByteTotals === 'object'
    ? { ...config.originalEntryByteTotals }
    : {};
  const entries = Array.isArray(config.entries) ? config.entries : [];
  const normalised = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const prefix = `rebaseline entry ${index + 1}`;

    if (!entry || typeof entry !== 'object') {
      throw new Error(`${prefix}: must be an object`);
    }

    const {
      entry: entryName,
      previousBytes,
      newBytes,
      reason,
      issue,
    } = entry;

    if (!entryName || typeof entryName !== 'string') {
      throw new Error(`${prefix}: "entry" must be a non-empty string`);
    }
    if (typeof previousBytes !== 'number' || previousBytes < 0) {
      throw new Error(`${prefix}: "previousBytes" must be a non-negative number`);
    }
    if (typeof newBytes !== 'number' || newBytes < 0) {
      throw new Error(`${prefix}: "newBytes" must be a non-negative number`);
    }
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`${prefix}: "reason" is required`);
    }
    if (!issue || typeof issue !== 'string' || issue.trim() === '') {
      throw new Error(`${prefix}: "issue" reference is required`);
    }

    normalised.push({
      entry: entryName,
      previousBytes,
      newBytes,
      reason: reason.trim(),
      issue: issue.trim(),
    });
  }

  return {
    originalEntryByteTotals,
    entries: normalised,
  };
}

module.exports = {
  ALLOWLIST_PATH,
  BYTE_COMPARE_PATH,
  REBASELINE_LOG_PATH,
  readYamlFile,
  loadAllowlist,
  loadByteCompareConfig,
  loadRebaselineLog,
};
