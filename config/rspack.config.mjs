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

/** @type {import('@rspack/core').Configuration} */
export default {
  mode: isProduction ? 'production' : 'development',
  entry: getProductionEntryPoints(),
  output: {
    path: path.resolve(ROOT, 'dist/rspack'),
    filename: isProduction ? '[name].[contenthash:8].js' : '[name].js',
    chunkFilename: isProduction ? '[name].[contenthash:8].chunk.js' : '[name].chunk.js',
  },
  devtool: isProduction ? 'source-map' : false,
  plugins: [
    new rspack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    }),
    new AssetManifestPlugin(),
  ],
  stats: 'errors-warnings',
};
