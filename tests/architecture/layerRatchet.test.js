'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildStableViolationKey,
  buildViolationKey,
  checkLayerRatchet,
  diffLayerViolations,
  formatFailureMessages,
  normalizeViolations,
  parseBaseline,
  buildProgressReport,
} = require('../../scripts/architecture/layerRatchet');
const { checkRubyRatchet } = require('../../scripts/architecture/rubyRatchet');

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/architecture');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

describe('layerRatchet', () => {
  const baseline = readFixture('layer-baseline.json');

  it('passes when current violations match the baseline', () => {
    const current = readFixture('layer-current-unchanged.json');
    const result = checkLayerRatchet({ baseline, currentViolations: current.violations });

    expect(result.pass).toBe(true);
    expect(result.progress.currentCount).toBe(3);
    expect(result.progress.baselineCount).toBe(3);
    expect(result.diff.netNew).toEqual([]);
  });

  it('fails when a net-new violation is introduced', () => {
    const current = readFixture('layer-current-net-new.json');
    const result = checkLayerRatchet({ baseline, currentViolations: current.violations });

    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      kind: 'net_new',
      from: 'app/assets/javascripts/work_items/utils.js',
      to: 'app/assets/javascripts/work_items/filter/filter_tokens.js',
    });
    expect(result.failures[0].remediation).toMatch(/service adapter/i);
  });

  it('fails when a baseline entry is removed without fixing the code', () => {
    const trimmedBaseline = readFixture('layer-baseline-trimmed.json');
    const current = readFixture('layer-current-unchanged.json');
    const result = checkLayerRatchet({
      baseline: trimmedBaseline,
      currentViolations: current.violations,
    });

    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      kind: 'net_new',
      from: 'app/assets/javascripts/work_items/list/utils.js',
      to: 'app/assets/javascripts/work_items/model/work_item.js',
    });
  });

  it('accepts resolved violations as reduction progress', () => {
    const current = readFixture('layer-current-resolved.json');
    const result = checkLayerRatchet({ baseline, currentViolations: current.violations });

    expect(result.pass).toBe(true);
    expect(result.progress.currentCount).toBe(2);
    expect(result.progress.resolvedCount).toBe(1);
    expect(result.progress.reductionPercent).toBeCloseTo(33.33, 1);
  });

  it('treats fixed-in-code violations left in the baseline as progress, not errors', () => {
    const current = readFixture('layer-current-resolved.json');
    const result = checkLayerRatchet({ baseline, currentViolations: current.violations });

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.diff.resolved).toHaveLength(1);
    expect(result.diff.phantomBaseline).toEqual([]);
  });

  it('does not treat renamed util modules as net-new when stable keys match', () => {
    const current = readFixture('layer-current-renamed.json');
    const result = checkLayerRatchet({ baseline, currentViolations: current.violations });

    expect(result.pass).toBe(true);
    expect(result.diff.netNew).toEqual([]);
    expect(result.diff.unchanged).toHaveLength(3);
  });

  it('fails closed when the baseline file is invalid', () => {
    expect(() => parseBaseline({})).toThrow(/Baseline parse failed/);
  });

  it('builds stable keys that ignore mirror prefixes separately', () => {
    const eeViolation = {
      rule: { name: 'no-util-to-filter' },
      from: 'app/assets/javascripts/ee/work_items/list/utils.js',
      to: 'app/assets/javascripts/work_items/filter/sort_options.js',
    };

    expect(buildStableViolationKey(eeViolation)).toContain('ee:util|');
  });

  it('formats failure messages with remediation guidance', () => {
    const current = readFixture('layer-current-net-new.json');
    const result = checkLayerRatchet({ baseline, currentViolations: current.violations });
    const messages = formatFailureMessages(result.failures);

    expect(messages[0]).toMatch(/Net-new layer violation/);
    expect(messages[0]).toMatch(/service adapter/i);
  });

  it('reports progress against the 25% reduction target', () => {
    const progress = buildProgressReport({
      baselineCount: 10,
      currentCount: 7,
      resolvedCount: 3,
      reductionTargetPercent: 25,
    });

    expect(progress.reductionPercent).toBe(30);
    expect(progress.targetCount).toBe(8);
    expect(progress.targetMet).toBe(true);
  });
});

describe('rubyRatchet', () => {
  const config = {
    directories: {
      'app/models': {
        'Style/Documentation': 2,
      },
      'app/services': {
        'Style/Documentation': 1,
      },
    },
  };

  it('passes when offense counts are within per-directory limits', () => {
    const rubocopJson = readFixture('rubocop-baseline.json');
    const result = checkRubyRatchet({ config, rubocopJson });

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when a directory exceeds its allowed offense count', () => {
    const rubocopJson = readFixture('rubocop-over-limit.json');
    const result = checkRubyRatchet({ config, rubocopJson });

    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatchObject({
      directory: 'app/models',
      cop: 'Style/Documentation',
      allowed: 2,
      current: 3,
    });
  });
});
