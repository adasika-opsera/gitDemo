'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Map a file path to a ratcheted directory bucket.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function directoryFor(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  if (normalized.startsWith('app/models/')) {
    return 'app/models';
  }

  if (normalized.startsWith('app/services/')) {
    return 'app/services';
  }

  return null;
}

/**
 * Group RuboCop offenses by directory and cop name.
 *
 * @param {object} rubocopJson
 * @returns {Record<string, Record<string, number>>}
 */
function groupOffensesByDirectory(rubocopJson) {
  const grouped = {};

  for (const file of rubocopJson.files || []) {
    const directory = directoryFor(file.path);

    if (!directory) {
      continue;
    }

    if (!grouped[directory]) {
      grouped[directory] = {};
    }

    for (const offense of file.offenses || []) {
      const copName = offense.cop_name;
      grouped[directory][copName] = (grouped[directory][copName] || 0) + 1;
    }
  }

  return grouped;
}

/**
 * Parse the committed Ruby ratchet configuration.
 *
 * @param {object} config
 * @returns {{ directories: Record<string, Record<string, number>> }}
 */
function parseRubyRatchetConfig(config) {
  if (!config || typeof config.directories !== 'object') {
    throw new Error('Ruby ratchet config parse failed: expected { directories: {} }');
  }

  return {
    directories: config.directories,
  };
}

/**
 * Compare RuboCop offense counts against per-directory ratchet limits.
 *
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.rubocopJson
 * @returns {object}
 */
function checkRubyRatchet(options) {
  const { config, rubocopJson } = options;
  const parsedConfig = parseRubyRatchetConfig(config);
  const offensesByDirectory = groupOffensesByDirectory(rubocopJson);
  const failures = [];

  for (const [directory, copLimits] of Object.entries(parsedConfig.directories)) {
    const directoryOffenses = offensesByDirectory[directory] || {};

    for (const [copName, allowedCount] of Object.entries(copLimits)) {
      const currentCount = directoryOffenses[copName] || 0;

      if (currentCount > allowedCount) {
        failures.push({
          kind: 'ruby_ratchet_exceeded',
          directory,
          cop: copName,
          allowed: allowedCount,
          current: currentCount,
          message: `${directory}: ${copName} has ${currentCount} offenses (allowed ${allowedCount})`,
        });
      }
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    offensesByDirectory,
  };
}

/**
 * Load a YAML ratchet config file.
 *
 * @param {string} filePath
 * @param {(source: string) => object} yamlLoader
 * @returns {object}
 */
function loadRubyRatchetConfig(filePath, yamlLoader) {
  const source = fs.readFileSync(filePath, 'utf8');
  return yamlLoader(source);
}

module.exports = {
  directoryFor,
  groupOffensesByDirectory,
  parseRubyRatchetConfig,
  checkRubyRatchet,
  loadRubyRatchetConfig,
};
