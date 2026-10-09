import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rspack = require('@rspack/core');
const { getProductionEntryPoints } = require('../scripts/frontend/getProductionEntryPoints.js');
const { AssetManifestPlugin } = require('../scripts/frontend/AssetManifestPlugin.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Rspack production config (WO-021).
 *
 * Pinned to stable @rspack/core@2.1.10 / @rspack/cli@2.1.10 (no RC suffix per BR-03).
 * @rsdoctor/rspack-plugin is intentionally NOT wired into the default or opt-in
 * build path: the latest compatible published line at upgrade time was still
 * prerelease (2.0.0-alpha.x). Prefer gating the plugin out over pinning core
 * back to an RC. Reintroduce Rsdoctor only after a stable plugin release.
 *
 * ENABLE_RSPACK remains opt-in — this story does not flip the default build
 * (see WO-026). webpack 4 config is untouched so the rollback path stays intact.
 *
 * @type {import('@rspack/core').Configuration}
 */
export default {
  mode: isProduction ? 'production' : 'development',
  entry: getProductionEntryPoints(),
  output: {
    path: path.resolve(ROOT, 'dist/rspack'),
    // Keep contenthash filename pattern aligned with webpack 4 so the parity
    // harness compares hashed-name strategy without false positives after 2.1.x.
    filename: isProduction ? '[name].[contenthash:8].js' : '[name].js',
    chunkFilename: isProduction ? '[name].[contenthash:8].chunk.js' : '[name].chunk.js',
  },
  // Rspack 2.1.x still accepts webpack-compatible 'source-map'; retain for
  // sourcemap presence parity with webpack 4 (byte compare excludes maps).
  devtool: isProduction ? 'source-map' : false,
  plugins: [
    new rspack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    }),
    new AssetManifestPlugin(),
  ],
  stats: 'errors-warnings',
};
