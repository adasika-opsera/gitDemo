'use strict';

/**
 * All production entry points tracked in the baseline manifest.
 * Includes dev-only entries that may emit zero assets.
 */
const PRODUCTION_ENTRY_POINT_NAMES = ['admin', 'dev_tools', 'main', 'pages'];

/**
 * Webpack compilation entry points (excludes dev-only stubs).
 */
const WEBPACK_ENTRY_POINTS = {
  main: './src/entries/main.js',
  pages: './src/entries/pages.js',
  admin: './src/entries/admin.js',
};

/**
 * Returns webpack compilation entries (excludes zero-asset dev-only entries).
 * @returns {Record<string, string>}
 */
function getProductionEntryPoints() {
  return { ...WEBPACK_ENTRY_POINTS };
}

/**
 * Returns sorted entry point names for deterministic baseline output.
 * Includes entries that may emit zero assets in production.
 * @returns {string[]}
 */
function getProductionEntryPointNames() {
  return [...PRODUCTION_ENTRY_POINT_NAMES];
}

module.exports = {
  getProductionEntryPoints,
  getProductionEntryPointNames,
  PRODUCTION_ENTRY_POINT_NAMES,
  WEBPACK_ENTRY_POINTS,
};
