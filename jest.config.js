/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'scripts/frontend/**/*.js',
    '!scripts/frontend/AssetManifestPlugin.js',
  ],
};
