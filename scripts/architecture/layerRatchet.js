'use strict';

const path = require('node:path');

const REDUCTION_TARGET_PERCENT = 25;

const LAYER_PATTERNS = [
  { layer: 'config', pattern: /\/config\// },
  { layer: 'model', pattern: /\/model\// },
  { layer: 'filter', pattern: /\/filter\// },
  { layer: 'service', pattern: /\/services\// },
  { layer: 'controller', pattern: /\/controllers\// },
  { layer: 'util', pattern: /\/utils(?:\/|\.|_)/ },
];

const MIRROR_PREFIXES = ['ee/', 'ce/'];

/**
 * Normalize module paths for stable comparison across platforms.
 *
 * @param {string} modulePath
 * @returns {string}
 */
function normalizeModulePath(modulePath) {
  return modulePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Strip EE/CE mirror prefixes while keeping both variants addressable.
 *
 * @param {string} modulePath
 * @returns {{ normalizedPath: string, mirror: string|null }}
 */
function stripMirrorPrefix(modulePath) {
  const normalizedPath = normalizeModulePath(modulePath);

  for (const mirror of ['ee', 'ce']) {
    const marker = `/${mirror}/`;

    if (normalizedPath.includes(marker)) {
      return {
        normalizedPath,
        mirror,
      };
    }
  }

  return {
    normalizedPath,
    mirror: null,
  };
}

/**
 * Classify a module path into an architectural layer.
 *
 * @param {string} modulePath
 * @returns {string}
 */
function classifyLayer(modulePath) {
  const { normalizedPath } = stripMirrorPrefix(modulePath);

  for (const { layer, pattern } of LAYER_PATTERNS) {
    if (pattern.test(`/${normalizedPath}`)) {
      return layer;
    }
  }

  return 'unknown';
}

/**
 * Extract the dependency-cruiser rule name from a violation record.
 *
 * @param {object} violation
 * @returns {string}
 */
function getRuleName(violation) {
  if (typeof violation.rule === 'string') {
    return violation.rule;
  }

  if (violation.rule?.name) {
    return violation.rule.name;
  }

  return violation.ruleName || 'unknown-rule';
}

/**
 * Build an exact violation key used for baseline membership checks.
 *
 * @param {object} violation
 * @returns {string}
 */
function buildViolationKey(violation) {
  const rule = getRuleName(violation);
  const from = normalizeModulePath(violation.from);
  const to = normalizeModulePath(violation.to);

  return `${rule}|${from}|${to}`;
}

/**
 * Build a stable dependency-pair key that survives file renames.
 *
 * @param {object} violation
 * @returns {string}
 */
function buildStableViolationKey(violation) {
  const rule = getRuleName(violation);
  const fromInfo = stripMirrorPrefix(violation.from);
  const toInfo = stripMirrorPrefix(violation.to);
  const fromLayer = classifyLayer(fromInfo.normalizedPath);
  const toLayer = classifyLayer(toInfo.normalizedPath);
  const toLeaf = path.basename(toInfo.normalizedPath, path.extname(toInfo.normalizedPath));
  const fromMirror = fromInfo.mirror ?? 'core';
  const toMirror = toInfo.mirror ?? 'core';

  return `${rule}|${fromMirror}:${fromLayer}|${toMirror}:${toLayer}:${toLeaf}`;
}

/**
 * Normalize dependency-cruiser output into ratchet violation records.
 *
 * @param {object[]} rawViolations
 * @returns {object[]}
 */
function normalizeViolations(rawViolations) {
  return rawViolations.map((violation) => ({
    rule: getRuleName(violation),
    from: normalizeModulePath(violation.from),
    to: normalizeModulePath(violation.to),
    key: buildViolationKey(violation),
    stableKey: buildStableViolationKey(violation),
    mirror: stripMirrorPrefix(violation.from).mirror,
    message: violation.comment
      || `${violation.from} must not depend on ${violation.to}`,
  }));
}

/**
 * Parse a committed baseline file.
 *
 * @param {object} baseline
 * @returns {{ violations: object[], baselineCount: number, reductionTargetPercent: number }}
 */
function parseBaseline(baseline) {
  if (!baseline || !Array.isArray(baseline.violations)) {
    throw new Error('Baseline parse failed: expected { violations: [] }');
  }

  const violations = baseline.violations.map((entry) => ({
    rule: entry.rule,
    from: normalizeModulePath(entry.from),
    to: normalizeModulePath(entry.to),
    key: entry.key || `${entry.rule}|${normalizeModulePath(entry.from)}|${normalizeModulePath(entry.to)}`,
    stableKey: entry.stableKey
      || buildStableViolationKey({ rule: { name: entry.rule }, from: entry.from, to: entry.to }),
    mirror: entry.mirror ?? null,
    message: entry.message || `${entry.from} must not depend on ${entry.to}`,
  }));

  return {
    violations,
    baselineCount: baseline.baselineCount ?? violations.length,
    reductionTargetPercent: baseline.reductionTargetPercent ?? REDUCTION_TARGET_PERCENT,
  };
}

/**
 * Determine whether a current violation matches any baseline entry.
 *
 * @param {object} violation
 * @param {object[]} baselineViolations
 * @returns {boolean}
 */
function isBaselinedViolation(violation, baselineViolations) {
  return baselineViolations.some(
    (baselineViolation) => baselineViolation.key === violation.key
      || baselineViolation.stableKey === violation.stableKey,
  );
}

/**
 * Determine whether a baseline entry still exists in the current violation set.
 *
 * @param {object} baselineViolation
 * @param {object[]} currentViolations
 * @returns {boolean}
 */
function baselineViolationStillPresent(baselineViolation, currentViolations) {
  return currentViolations.some(
    (currentViolation) => currentViolation.key === baselineViolation.key
      || currentViolation.stableKey === baselineViolation.stableKey,
  );
}

/**
 * Diff current violations against a committed baseline.
 *
 * @param {object[]} baselineViolations
 * @param {object[]} currentViolations
 * @returns {object}
 */
function diffLayerViolations(baselineViolations, currentViolations) {
  const netNew = currentViolations.filter(
    (violation) => !isBaselinedViolation(violation, baselineViolations),
  );

  const resolved = baselineViolations.filter(
    (baselineViolation) => !baselineViolationStillPresent(baselineViolation, currentViolations),
  );

  const unchanged = currentViolations.filter(
    (violation) => isBaselinedViolation(violation, baselineViolations),
  );

  const phantomBaseline = baselineViolations.filter(
    (baselineViolation) => baselineViolationStillPresent(baselineViolation, currentViolations)
      && !currentViolations.some((currentViolation) => currentViolation.key === baselineViolation.key),
  );

  return {
    netNew,
    resolved,
    unchanged,
    phantomBaseline,
  };
}

/**
 * Compute progress against the committed reduction target.
 *
 * @param {object} options
 * @param {number} options.baselineCount
 * @param {number} options.currentCount
 * @param {number} options.resolvedCount
 * @param {number} options.reductionTargetPercent
 * @returns {object}
 */
function buildProgressReport(options) {
  const {
    baselineCount,
    currentCount,
    resolvedCount,
    reductionTargetPercent,
  } = options;

  const reductionCount = baselineCount - currentCount;
  const reductionPercent = baselineCount === 0
    ? 100
    : (reductionCount / baselineCount) * 100;
  const targetCount = Math.ceil(baselineCount * (1 - (reductionTargetPercent / 100)));
  const targetMet = currentCount <= targetCount;

  return {
    baselineCount,
    currentCount,
    resolvedCount,
    reductionCount,
    reductionPercent: Number(reductionPercent.toFixed(2)),
    reductionTargetPercent,
    targetCount,
    targetMet,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Suggest the inversion pattern for a forbidden edge.
 *
 * @param {object} violation
 * @returns {string}
 */
function suggestRemediation(violation) {
  const fromLayer = classifyLayer(violation.from);
  const toLayer = classifyLayer(violation.to);

  return `Move the ${toLayer}-layer dependency out of ${violation.from} `
    + `by introducing a ${fromLayer === 'util' ? 'service' : 'boundary'} adapter `
    + `so ${fromLayer} no longer imports ${toLayer} (${violation.to}).`;
}

/**
 * Run the full layer ratchet check.
 *
 * @param {object} options
 * @param {object} options.baseline
 * @param {object[]} options.currentViolations
 * @returns {object}
 */
function checkLayerRatchet(options) {
  const { baseline, currentViolations } = options;
  const parsedBaseline = parseBaseline(baseline);
  const normalizedCurrent = normalizeViolations(currentViolations);
  const diff = diffLayerViolations(parsedBaseline.violations, normalizedCurrent);
  const progress = buildProgressReport({
    baselineCount: parsedBaseline.baselineCount,
    currentCount: normalizedCurrent.length,
    resolvedCount: diff.resolved.length,
    reductionTargetPercent: parsedBaseline.reductionTargetPercent,
  });

  const netNewFailures = diff.netNew.map((violation) => ({
    ...violation,
    kind: 'net_new',
    message: `Net-new layer violation: ${violation.from} -> ${violation.to}`,
    remediation: suggestRemediation(violation),
  }));

  const failures = netNewFailures;
  const pass = failures.length === 0;

  return {
    pass,
    failures,
    diff,
    progress,
    currentViolations: normalizedCurrent,
    baselineViolations: parsedBaseline.violations,
    reportMarkdown: renderLayerRatchetReport({
      pass,
      failures,
      diff,
      progress,
    }),
    reportJson: {
      pass,
      failures,
      diff,
      progress,
    },
  };
}

/**
 * Render a markdown progress artifact for CI.
 *
 * @param {object} result
 * @returns {string}
 */
function renderLayerRatchetReport(result) {
  const lines = [
    '# Architectural Layer Ratchet Report',
    '',
    `Generated: ${result.progress.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Status: ${result.pass ? 'PASS' : 'FAIL'}`,
    `- Baseline violations: ${result.progress.baselineCount}`,
    `- Current violations: ${result.progress.currentCount}`,
    `- Resolved since baseline: ${result.progress.resolvedCount}`,
    `- Reduction: ${result.progress.reductionCount} (${result.progress.reductionPercent}%)`,
    `- Target: ${result.progress.reductionTargetPercent}% reduction (<= ${result.progress.targetCount} violations)`,
    `- Target met: ${result.progress.targetMet ? 'yes' : 'no'}`,
    '',
  ];

  if (result.failures.length > 0) {
    lines.push('## Failures', '');

    for (const failure of result.failures) {
      lines.push(`- **${failure.kind}** ${failure.from} -> ${failure.to} (${failure.rule})`);

      if (failure.remediation) {
        lines.push(`  - Remediation: ${failure.remediation}`);
      }
    }

    lines.push('');
  }

  if (result.diff.resolved.length > 0) {
    lines.push('## Resolved Violations', '');

    for (const violation of result.diff.resolved) {
      lines.push(`- ${violation.from} -> ${violation.to} (${violation.rule})`);
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Format failure messages for stderr output.
 *
 * @param {object[]} failures
 * @returns {string[]}
 */
function formatFailureMessages(failures) {
  return failures.map((failure) => {
    if (failure.remediation) {
      return `${failure.message}. ${failure.remediation}`;
    }

    return failure.message;
  });
}

module.exports = {
  REDUCTION_TARGET_PERCENT,
  normalizeModulePath,
  stripMirrorPrefix,
  classifyLayer,
  getRuleName,
  buildViolationKey,
  buildStableViolationKey,
  normalizeViolations,
  parseBaseline,
  isBaselinedViolation,
  baselineViolationStillPresent,
  diffLayerViolations,
  buildProgressReport,
  suggestRemediation,
  checkLayerRatchet,
  renderLayerRatchetReport,
  formatFailureMessages,
};
