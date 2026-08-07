'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Webpack plugin that writes asset-manifest.json after compilation.
 * Used by the baseline recorder and production builds.
 */
class AssetManifestPlugin {
  apply(compiler) {
    compiler.hooks.done.tap('AssetManifestPlugin', (stats) => {
      if (stats.hasErrors()) {
        return;
      }

      const compilation = stats.compilation;
      const assets = [];
      const seenChunks = new Set();

      for (const [entryName, entrypoint] of compilation.entrypoints) {
        const files = entrypoint.getFiles();

        for (const fileName of files) {
          assets.push({
            name: fileName,
            entry: entryName,
          });
        }

        for (const chunk of entrypoint.chunks) {
          seenChunks.add(chunk.id);
        }
      }

      assets.sort((a, b) => {
        const entryCompare = a.entry.localeCompare(b.entry);
        if (entryCompare !== 0) {
          return entryCompare;
        }
        return a.name.localeCompare(b.name);
      });

      const manifest = {
        assets,
        chunkCount: seenChunks.size,
      };

      const outputPath = compilation.outputOptions.path;
      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(
        path.join(outputPath, 'asset-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    });
  }
}

module.exports = { AssetManifestPlugin };
