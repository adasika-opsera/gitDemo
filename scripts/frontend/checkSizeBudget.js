'use strict';

const { getProductionEntryPointNames } = require('./getProductionEntryPoints');

const REBASELINE_REMEDIATION = 'To re-baseline an entry, update config/parity/webpack4-baseline.json '
  + 'and append a matching entry to config/parity/rebaseline-log.yml with reason and issue.';

/**
 * Compute percentage delta relative to baseline bytes.
 * Returns null when baseline is zero and current is non-zero.
 *
 * @param {number} baselineBytes
 * @param {number} deltaBytes
 * @returns {number|null}
 */
function formatDeltaPercent(baselineBytes, deltaBytes) {
  if (baselineBytes === 0) {
    return deltaBytes === 0 ? 0 : null;
  }

  return (deltaBytes / baselineBytes) * 100;
}

/**
 * Compare current per-entry byte totals against a frozen baseline (+0% tolerance).
 *
 * @param {Record<string, number>} baselineEntryByteTotals
 * @param {Record<string, number>} currentEntryByteTotals
 * @param {object} [options]
 * @param {string[]} [options.productionEntries]
 * @returns {{ pass: boolean, entries: object[], violations: object[], newEntries: object[] }}
 */
function compareEntryBudgets(baselineEntryByteTotals, currentEntryByteTotals, options = {}) {
  const productionEntries = options.productionEntries ?? getProductionEntryPointNames();
  const entries = [];
  const violations = [];
  const newEntries = [];

  for (const entry of productionEntries) {
    const baselineBytes = baselineEntryByteTotals[entry] ?? 0;
    const currentBytes = currentEntryByteTotals[entry] ?? 0;
    const deltaBytes = currentBytes - baselineBytes;
    const deltaPercent = formatDeltaPercent(baselineBytes, deltaBytes);

    let status = 'under_budget';
    if (baselineBytes > 0 && currentBytes === 0) {
      status = 'removed';
    } else if (currentBytes > baselineBytes) {
      status = 'over_budget';
    } else if (currentBytes === baselineBytes) {
      status = 'at_budget';
    }

    const row = {
      entry,
      baselineBytes,
      currentBytes,
      deltaBytes,
      deltaPercent,
      status,
    };

    entries.push(row);

    if (status === 'removed') {
      violations.push({
        kind: 'removed_entry',
        ...row,
        message: `Entry "${entry}" was removed from the build (baseline ${baselineBytes} B, current 0 B)`,
      });
    } else if (currentBytes > baselineBytes) {
      violations.push({
        kind: 'over_budget',
        ...row,
      });
    }
  }

  for (const entry of Object.keys(currentEntryByteTotals)) {
    if (productionEntries.includes(entry)) {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(baselineEntryByteTotals, entry)) {
      const currentBytes = currentEntryByteTotals[entry];

      if (currentBytes > 0) {
        const row = {
          entry,
          baselineBytes: null,
          currentBytes,
          deltaBytes: currentBytes,
          deltaPercent: null,
          status: 'new_entry',
        };

        newEntries.push(row);
        violations.push({
          kind: 'new_entry',
          ...row,
        });
      }
    }
  }

  return {
    pass: violations.length === 0,
    entries,
    violations,
    newEntries,
  };
}

/**
 * Ensure every baseline value that differs from the original snapshot has a log entry.
 *
 * @param {Record<string, number>} baselineEntryByteTotals
 * @param {{ originalEntryByteTotals: Record<string, number>, entries: object[] }} rebaselineLog
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRebaselineLog(baselineEntryByteTotals, rebaselineLog) {
  const errors = [];
  const originalEntryByteTotals = rebaselineLog.originalEntryByteTotals || {};
  const logEntries = Array.isArray(rebaselineLog.entries) ? rebaselineLog.entries : [];

  for (const [entry, currentBytes] of Object.entries(baselineEntryByteTotals)) {
    const originalBytes = originalEntryByteTotals[entry] ?? 0;

    if (currentBytes !== originalBytes) {
      const matchingEntry = logEntries.find(
        (logEntry) => logEntry.entry === entry && logEntry.newBytes === currentBytes,
      );

      if (!matchingEntry) {
        errors.push(
          `Entry "${entry}" baseline is ${currentBytes} bytes (original: ${originalBytes}) `
          + 'but no rebaseline log entry documents this change',
        );
      }
    }
  }

  for (const logEntry of logEntries) {
    const baselineBytes = baselineEntryByteTotals[logEntry.entry];

    if (baselineBytes !== logEntry.newBytes) {
      errors.push(
        `Rebaseline log entry for "${logEntry.entry}" specifies newBytes=${logEntry.newBytes} `
        + `but baseline has ${baselineBytes ?? 'no value'}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Render a human-readable size budget report.
 *
 * @param {object} result
 * @returns {string}
 */
function renderSizeBudgetReport(result) {
  const lines = [
    '# Bundle Size Budget Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Baseline source: ${result.baselineSource}`,
    `- Current source: ${result.currentSource}`,
    `- Entries checked: ${result.entries.length}`,
    `- Violations: ${result.violations.length}`,
    `- Status: ${result.pass ? 'PASS' : 'FAIL'}`,
    '',
    '## Per-Entry Comparison',
    '',
    '| Entry | Baseline (B) | Current (B) | Delta (B) | Delta (%) | Status |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const row of result.entries) {
    const deltaPercent = row.deltaPercent == null ? 'n/a' : `${row.deltaPercent.toFixed(2)}%`;
    lines.push(
      `| ${row.entry} | ${row.baselineBytes} | ${row.currentBytes} | ${row.deltaBytes >= 0 ? '+' : ''}${row.deltaBytes} | ${deltaPercent} | ${row.status} |`,
    );
  }

  if (result.newEntries.length > 0) {
    lines.push('', '## New Entry Points', '');

    for (const row of result.newEntries) {
      lines.push(`- **${row.entry}**: ${row.currentBytes} bytes (no baseline)`);
    }
  }

  if (result.violations.length > 0) {
    lines.push('', '## Violations', '');

    for (const violation of result.violations) {
      const baselineLabel = violation.baselineBytes == null ? 'n/a' : `${violation.baselineBytes}`;
      const deltaPercent = violation.deltaPercent == null
        ? 'n/a'
        : `${violation.deltaPercent.toFixed(2)}%`;

      lines.push(
        `- **${violation.entry}** (${violation.kind}): baseline=${baselineLabel} B, `
        + `current=${violation.currentBytes} B, delta=${violation.deltaBytes >= 0 ? '+' : ''}${violation.deltaBytes} B (${deltaPercent})`,
      );
    }
  }

  if (result.rebaselineErrors?.length) {
    lines.push('', '## Rebaseline Validation Errors', '');

    for (const error of result.rebaselineErrors) {
      lines.push(`- ${error}`);
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

/**
 * Format violation messages for stderr output on failure.
 *
 * @param {object[]} violations
 * @returns {string[]}
 */
function formatViolationMessages(violations) {
  return violations.map((violation) => {
    const baselineLabel = violation.baselineBytes == null ? 'n/a' : `${violation.baselineBytes}`;
    const deltaPercent = violation.deltaPercent == null
      ? 'n/a'
      : `${violation.deltaPercent.toFixed(2)}%`;

    return `${violation.entry}: baseline=${baselineLabel} B, current=${violation.currentBytes} B, `
      + `delta=${violation.deltaBytes >= 0 ? '+' : ''}${violation.deltaBytes} B (${deltaPercent})`;
  });
}

/**
 * Run the full size budget check.
 *
 * @param {object} options
 * @param {Record<string, number>} options.baselineEntryByteTotals
 * @param {Record<string, number>} options.currentEntryByteTotals
 * @param {{ originalEntryByteTotals: Record<string, number>, entries: object[] }} [options.rebaselineLog]
 * @param {string} [options.baselineSource]
 * @param {string} [options.currentSource]
 * @returns {object}
 */
function checkSizeBudget(options) {
  const {
    baselineEntryByteTotals,
    currentEntryByteTotals,
    rebaselineLog,
    baselineSource = 'baseline',
    currentSource = 'current build',
  } = options;

  const comparison = compareEntryBudgets(baselineEntryByteTotals, currentEntryByteTotals);

  let rebaselineValid = true;
  let rebaselineErrors = [];

  if (rebaselineLog) {
    const rebaselineResult = validateRebaselineLog(baselineEntryByteTotals, rebaselineLog);
    rebaselineValid = rebaselineResult.valid;
    rebaselineErrors = rebaselineResult.errors;
  }

  const pass = comparison.pass && rebaselineValid;

  const result = {
    pass,
    baselineSource,
    currentSource,
    entries: comparison.entries,
    violations: comparison.violations,
    newEntries: comparison.newEntries,
    rebaselineValid,
    rebaselineErrors,
    sizeBudgetReport: '',
    reportJson: {},
  };

  result.reportJson = {
    pass,
    baselineSource,
    currentSource,
    entries: comparison.entries,
    violations: comparison.violations,
    newEntries: comparison.newEntries,
    rebaselineValid,
    rebaselineErrors,
  };

  result.sizeBudgetReport = renderSizeBudgetReport(result);

  return result;
}

module.exports = {
  compareEntryBudgets,
  validateRebaselineLog,
  renderSizeBudgetReport,
  formatViolationMessages,
  checkSizeBudget,
  formatDeltaPercent,
  REBASELINE_REMEDIATION,
};
