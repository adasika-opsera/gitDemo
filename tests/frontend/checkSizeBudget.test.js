'use strict';

const fs = require('fs');
const path = require('path');
const {
  compareEntryBudgets,
  validateRebaselineLog,
  checkSizeBudget,
  formatViolationMessages,
  renderSizeBudgetReport,
} = require('../../scripts/frontend/checkSizeBudget');
const { loadRebaselineLog } = require('../../scripts/frontend/loadParityConfig');

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/frontend/budget');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

describe('loadRebaselineLog', () => {
  it('loads the committed rebaseline log with original snapshot', () => {
    const log = loadRebaselineLog();

    expect(log.originalEntryByteTotals).toEqual({
      admin: 959,
      main: 956,
      pages: 958,
      dev_tools: 0,
    });
    expect(log.entries).toEqual([]);
  });

  it('rejects rebaseline entries without reason and issue', () => {
    expect(() => loadRebaselineLog({
      originalEntryByteTotals: { main: 956 },
      entries: [{ entry: 'main', previousBytes: 956, newBytes: 1000 }],
    })).toThrow(/reason/);

    expect(() => loadRebaselineLog({
      originalEntryByteTotals: { main: 956 },
      entries: [{
        entry: 'main',
        previousBytes: 956,
        newBytes: 1000,
        reason: 'Vue 3 migration added helpers',
      }],
    })).toThrow(/issue/);
  });
});

describe('compareEntryBudgets', () => {
  const baseline = readFixture('baseline-entry-totals.json').entryByteTotals;

  it('passes when all entries are under budget', () => {
    const current = readFixture('current-under-budget.json').entryByteTotals;
    const result = compareEntryBudgets(baseline, current);

    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.entries.filter((row) => row.entry !== 'dev_tools').every((row) => row.status === 'under_budget')).toBe(true);
    expect(result.entries.find((row) => row.entry === 'dev_tools').status).toBe('at_budget');
  });

  it('passes when all entries are exactly at budget', () => {
    const current = readFixture('current-at-budget.json').entryByteTotals;
    const result = compareEntryBudgets(baseline, current);

    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.entries.every((row) => row.status === 'at_budget')).toBe(true);
  });

  it('fails when any entry exceeds its baseline', () => {
    const current = readFixture('current-over-budget.json').entryByteTotals;
    const result = compareEntryBudgets(baseline, current);

    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'over_budget',
      entry: 'admin',
      baselineBytes: 959,
      currentBytes: 1100,
      deltaBytes: 141,
    });
    expect(result.violations[0].deltaPercent).toBeCloseTo(14.7028, 3);
  });

  it('flags new entry points not present in the baseline', () => {
    const current = readFixture('current-new-entry.json').entryByteTotals;
    const result = compareEntryBudgets(baseline, current);

    expect(result.pass).toBe(false);
    expect(result.newEntries).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'new_entry',
      entry: 'onboarding',
      currentBytes: 512,
    });
  });

  it('fails when a baseline entry is removed from the build', () => {
    const current = readFixture('current-removed-entry.json').entryByteTotals;
    const result = compareEntryBudgets(baseline, current);

    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'removed_entry',
      entry: 'admin',
      baselineBytes: 959,
      currentBytes: 0,
      status: 'removed',
    });
  });
});

describe('validateRebaselineLog', () => {
  it('passes when baseline matches the original snapshot', () => {
    const baseline = readFixture('baseline-entry-totals.json').entryByteTotals;
    const log = loadRebaselineLog();

    expect(validateRebaselineLog(baseline, log)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('fails when baseline changed without a log entry', () => {
    const baseline = {
      ...readFixture('baseline-entry-totals.json').entryByteTotals,
      admin: 1100,
    };
    const log = loadRebaselineLog();

    const result = validateRebaselineLog(baseline, log);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/admin.*no rebaseline log entry/i);
  });

  it('passes when baseline change is documented in the log', () => {
    const baseline = {
      ...readFixture('baseline-entry-totals.json').entryByteTotals,
      admin: 1100,
    };
    const log = {
      originalEntryByteTotals: readFixture('baseline-entry-totals.json').entryByteTotals,
      entries: [{
        entry: 'admin',
        previousBytes: 959,
        newBytes: 1100,
        reason: 'Added accessibility helpers to admin shell',
        issue: 'WO-003-fixture',
      }],
    };

    expect(validateRebaselineLog(baseline, log)).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe('checkSizeBudget', () => {
  it('includes violation details in the report output', () => {
    const baseline = readFixture('baseline-entry-totals.json').entryByteTotals;
    const current = readFixture('current-over-budget.json').entryByteTotals;

    const result = checkSizeBudget({
      baselineEntryByteTotals: baseline,
      currentEntryByteTotals: current,
      rebaselineLog: loadRebaselineLog(),
      baselineSource: 'fixtures/baseline-entry-totals.json',
      currentSource: 'fixtures/current-over-budget.json',
    });

    expect(result.pass).toBe(false);
    expect(result.sizeBudgetReport).toContain('admin');
    expect(result.sizeBudgetReport).toContain('1100');
    expect(result.sizeBudgetReport).toContain('959');
    expect(formatViolationMessages(result.violations)[0]).toMatch(/baseline=959 B, current=1100 B, delta=\+141 B/);
  });

  it('fails when rebaseline audit does not match baseline file', () => {
    const baseline = {
      ...readFixture('baseline-entry-totals.json').entryByteTotals,
      pages: 1200,
    };
    const current = readFixture('current-at-budget.json').entryByteTotals;

    const result = checkSizeBudget({
      baselineEntryByteTotals: baseline,
      currentEntryByteTotals: current,
      rebaselineLog: loadRebaselineLog(),
    });

    expect(result.pass).toBe(false);
    expect(result.rebaselineValid).toBe(false);
    expect(renderSizeBudgetReport(result)).toContain('Rebaseline Validation Errors');
  });
});
