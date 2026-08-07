#!/usr/bin/env node
'use strict';

/**
 * Runtime smoke suite for production entry points (WO-004).
 * Loads each entry in headless Chromium, captures console errors and
 * unhandled rejections, and emits comparable per-entry result JSON.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MOUNT_GLOBAL,
  buildSmokeTargetList,
  evaluateEntrySmoke,
  aggregateSmokeResults,
  compareSmokeResults,
  smokeDivergencesToParityDefects,
} = require('./smokeEntryPoints.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_REPORTS_DIR = path.join(ROOT, 'reports/parity');

function log(message) {
  process.stderr.write(`[smoke_entry_points] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    mode: 'run',
    assetRoot: process.env.ASSET_ROOT || null,
    manifest: null,
    bundler: process.env.BUNDLER || 'unknown',
    output: null,
    resultsA: null,
    resultsB: null,
    reportsDir: DEFAULT_REPORTS_DIR,
    parityDefectsPath: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--mode':
        args.mode = next;
        index += 1;
        break;
      case '--asset-root':
        args.assetRoot = next;
        index += 1;
        break;
      case '--manifest':
        args.manifest = next;
        index += 1;
        break;
      case '--bundler':
        args.bundler = next;
        index += 1;
        break;
      case '--output':
        args.output = next;
        index += 1;
        break;
      case '--results-a':
        args.resultsA = next;
        index += 1;
        break;
      case '--results-b':
        args.resultsB = next;
        index += 1;
        break;
      case '--reports-dir':
        args.reportsDir = next;
        index += 1;
        break;
      case '--parity-defects':
        args.parityDefectsPath = next;
        index += 1;
        break;
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`Usage: smoke_entry_points.mjs [options]

Modes:
  --mode run   Load entry points from built assets (default)
  --mode diff  Compare two smoke-results.json files

Run options:
  --asset-root <path>   Built asset directory (or ASSET_ROOT env var)
  --manifest <path>     asset-manifest.json (default: <asset-root>/asset-manifest.json)
  --bundler <name>      Bundler label for the result payload (default: unknown)
  --output <path>       Write smoke-results.json (default: reports/parity/smoke-results-<bundler>.json)

Diff options:
  --results-a <path>    First smoke-results.json
  --results-b <path>    Second smoke-results.json
  --reports-dir <path>  Output directory for divergence report
  --parity-defects <path> Optional parity-defects.json to merge runtime divergences into
`);
}

function readJsonFile(filePath, label) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} missing at expected path: ${absolutePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} unreadable at ${absolutePath}: ${error.message}`);
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  return 'application/octet-stream';
}

function createStaticServer(assetRoot) {
  const absoluteRoot = path.resolve(assetRoot);

  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      let relativePath = decodeURIComponent(requestUrl.pathname);

      if (relativePath.startsWith('/assets/')) {
        relativePath = relativePath.slice('/assets/'.length);
      } else if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }

      const filePath = path.resolve(absoluteRoot, relativePath);

      if (!filePath.startsWith(absoluteRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      response.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
      response.end(fs.readFileSync(filePath));
    } catch (error) {
      response.writeHead(500);
      response.end(error.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }
            closeResolve();
          });
        }),
      });
    });

    server.on('error', reject);
  });
}

function buildSmokeHtml(entry, scriptName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Smoke ${entry}</title>
</head>
<body>
  <div id="app" data-entry="${entry}"></div>
  <script>
    window.__SMOKE_CONSOLE_ERRORS__ = [];
    window.__SMOKE_UNHANDLED_REJECTIONS__ = [];
    window.__SMOKE_SCRIPT_LOADED__ = false;

    const originalConsoleError = console.error;
    console.error = (...args) => {
      window.__SMOKE_CONSOLE_ERRORS__.push(args.map(String).join(' '));
      originalConsoleError.apply(console, args);
    };

    window.addEventListener('unhandledrejection', (event) => {
      window.__SMOKE_UNHANDLED_REJECTIONS__.push(String(event.reason));
    });
  </script>
  <script src="/assets/${scriptName}" onload="window.__SMOKE_SCRIPT_LOADED__ = true"></script>
</body>
</html>`;
}

async function loadPuppeteer() {
  try {
    const puppeteer = await import('puppeteer');
    return puppeteer.default || puppeteer;
  } catch (error) {
    throw new Error(
      'puppeteer is required for runtime smoke tests. Install it with: npm install --save-dev puppeteer',
    );
  }
}

async function smokeEntryInBrowser(page, baseUrl, target) {
  const html = buildSmokeHtml(target.entry, target.script);
  const htmlUrl = `${baseUrl}/smoke/${target.entry}`;

  await page.setRequestInterception(true);
  page.removeAllListeners('request');

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.origin === baseUrl) {
      if (url.pathname === `/smoke/${target.entry}`) {
        request.respond({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: html,
        });
        return;
      }

      request.continue();
      return;
    }

    request.respond({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  const startedAt = Date.now();

  await page.goto(htmlUrl, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  await page.waitForFunction(
    () => window.__SMOKE_SCRIPT_LOADED__ === true,
    { timeout: 10000 },
  ).catch(() => {});

  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

  const probe = await page.evaluate((entryName, mountGlobal) => ({
    mounted: window[mountGlobal] === entryName,
    scriptLoaded: window.__SMOKE_SCRIPT_LOADED__ === true,
    consoleErrors: window.__SMOKE_CONSOLE_ERRORS__ || [],
    unhandledRejections: window.__SMOKE_UNHANDLED_REJECTIONS__ || [],
  }), target.entry, MOUNT_GLOBAL);

  const evaluation = evaluateEntrySmoke({
    runnable: true,
    scriptLoaded: probe.scriptLoaded,
    mounted: probe.mounted,
    consoleErrors: probe.consoleErrors,
    unhandledRejections: probe.unhandledRejections,
  });

  return {
    entry: target.entry,
    script: target.script,
    status: evaluation.status,
    failures: evaluation.failures,
    consoleErrors: probe.consoleErrors,
    unhandledRejections: probe.unhandledRejections,
    mounted: probe.mounted,
    scriptLoaded: probe.scriptLoaded,
    durationMs: Date.now() - startedAt,
  };
}

async function runSmokeSuite(args) {
  if (!args.assetRoot) {
    throw new Error('Missing required --asset-root argument or ASSET_ROOT environment variable');
  }

  const assetRoot = path.resolve(args.assetRoot);
  const manifestPath = path.resolve(args.manifest || path.join(assetRoot, 'asset-manifest.json'));
  const rawManifest = readJsonFile(manifestPath, 'Asset manifest');
  const targets = buildSmokeTargetList(rawManifest);
  const staticServer = await createStaticServer(assetRoot);
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const entries = [];

  try {
    const page = await browser.newPage();

    for (const target of targets) {
      if (!target.runnable) {
        entries.push({
          entry: target.entry,
          script: null,
          status: 'skipped',
          skipReason: target.skipReason,
          failures: [],
        });
        continue;
      }

      const result = await smokeEntryInBrowser(page, staticServer.baseUrl, target);
      entries.push(result);
    }
  } finally {
    await browser.close();
    await staticServer.close();
  }

  const payload = aggregateSmokeResults({
    bundler: args.bundler,
    assetRoot,
    entries,
  });

  const outputPath = path.resolve(
    args.output || path.join(args.reportsDir, `smoke-results-${args.bundler}.json`),
  );
  writeJsonFile(outputPath, payload);

  log(`smoke results: ${outputPath}`);
  log(`summary: ${payload.summary.passed} passed, ${payload.summary.failed} failed, ${payload.summary.skipped} skipped`);

  return { payload, outputPath };
}

function runDiffMode(args) {
  if (!args.resultsA || !args.resultsB) {
    throw new Error('Diff mode requires --results-a and --results-b');
  }

  const resultsA = readJsonFile(args.resultsA, 'Smoke results A');
  const resultsB = readJsonFile(args.resultsB, 'Smoke results B');
  const comparison = compareSmokeResults(resultsA, resultsB);
  const reportsDir = path.resolve(args.reportsDir);

  fs.mkdirSync(reportsDir, { recursive: true });

  const divergenceReportPath = path.join(reportsDir, 'smoke-divergence-report.json');
  writeJsonFile(divergenceReportPath, comparison);

  log(`smoke divergence report: ${divergenceReportPath}`);

  if (args.parityDefectsPath && fs.existsSync(path.resolve(args.parityDefectsPath))) {
    const parityDefects = readJsonFile(args.parityDefectsPath, 'Parity defects');
    const runtimeDefects = smokeDivergencesToParityDefects(comparison);
    parityDefects.defects = [...(parityDefects.defects || []), ...runtimeDefects];
    parityDefects.pass = Boolean(parityDefects.pass) && comparison.pass;
    parityDefects.summary = {
      ...(parityDefects.summary || {}),
      runtimeSmokeDivergenceCount: runtimeDefects.length,
    };

    writeJsonFile(path.resolve(args.parityDefectsPath), parityDefects);
    log(`merged runtime smoke divergences into ${path.resolve(args.parityDefectsPath)}`);
  }

  if (comparison.pass) {
    log('runtime smoke parity check passed');
    return 0;
  }

  log(`runtime smoke parity check failed with ${comparison.summary.divergenceCount} divergence(s)`);
  for (const divergence of comparison.divergences) {
    log(`  - ${divergence.message}`);
  }

  return 1;
}

async function main() {
  let args;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    log(error.message);
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  try {
    if (args.mode === 'diff') {
      process.exit(runDiffMode(args));
    }

    const { payload } = await runSmokeSuite(args);
    process.exit(payload.pass ? 0 : 1);
  } catch (error) {
    log(error.message);
    process.exit(2);
  }
}

main();
