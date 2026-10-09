// WO-022: webpack production build remains the coexistence rollback path; CI dual-build
// runs this config with ENABLE_RSPACK unset and WEBPACK_VENDOR_DLL unset.
'use strict';

const path = require('path');
const webpack = require('webpack');
const { getProductionEntryPoints } = require('../scripts/frontend/getProductionEntryPoints');
const { AssetManifestPlugin } = require('../scripts/frontend/AssetManifestPlugin');

const isProduction = process.env.NODE_ENV === 'production';
const isVendorDll = process.env.WEBPACK_VENDOR_DLL === 'true';

/**
 * Production webpack 4 configuration.
 * Vendor DLL builds are excluded from the production baseline (see WO-001 edge case).
 */
function createConfig() {
  if (isVendorDll) {
    return {
      mode: 'production',
      entry: { vendor_dll: './src/entries/vendor_dll.js' },
      output: {
        path: path.resolve(__dirname, '../dist/vendor-dll'),
        filename: '[name].dll.js',
      },
    };
  }

  const entryPoints = getProductionEntryPoints();

  return {
    mode: isProduction ? 'production' : 'development',
    entry: entryPoints,
    output: {
      path: path.resolve(__dirname, '../dist/webpack'),
      filename: isProduction ? '[name].[contenthash:8].js' : '[name].js',
      chunkFilename: isProduction ? '[name].[contenthash:8].chunk.js' : '[name].chunk.js',
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      }),
      new AssetManifestPlugin(),
    ],
    stats: 'errors-warnings',
  };
}

module.exports = createConfig();
