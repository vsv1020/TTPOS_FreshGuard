const fs = require('fs');
const path = require('path');
const vm = require('vm');

const adminWebDir = path.join(__dirname, '..', 'admin-web');
const commonJs = fs.readFileSync(path.join(adminWebDir, 'assets', 'common.js'), 'utf8');
const complianceViewJs = fs.readFileSync(
  path.join(adminWebDir, 'assets', 'compliance-view.js'),
  'utf8'
);

function fakeDoc() {
  const classes = new Set();
  return {
    body: {
      classList: {
        add: (c) => classes.add(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c) => classes.has(c)
      }
    },
    querySelectorAll: () => [],
    createElement: () => ({ textContent: '', innerHTML: '' })
  };
}

function loadCommon() {
  const sandbox = {
    window: {},
    document: fakeDoc(),
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    fetch: () => Promise.resolve(),
    URLSearchParams,
    clearTimeout,
    setTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(commonJs, sandbox);
  return sandbox.window.AdminCommon;
}

function loadComplianceView() {
  const sandbox = { window: {}, URLSearchParams };
  vm.createContext(sandbox);
  vm.runInContext(complianceViewJs, sandbox);
  return sandbox.window.ComplianceView;
}

describe('admin-web common.js prepareStoreRanking (P2-5)', () => {
  const items = [
    {
      storeId: 1,
      storeName: 'Alpha',
      handleRate: 0.95,
      wasteRate: 0.02,
      avgInspectionScore: 88,
      openIssues: 0,
      overdueIssues: 0
    },
    {
      storeId: 2,
      storeName: 'Bravo',
      handleRate: 0.5,
      wasteRate: 0.25,
      avgInspectionScore: 45,
      openIssues: 3,
      overdueIssues: 2
    },
    {
      storeId: 3,
      storeName: 'Charlie',
      handleRate: null,
      wasteRate: null,
      avgInspectionScore: null,
      openIssues: 0,
      overdueIssues: 0
    }
  ];

  test('default sort is wasteRate descending with nulls last', () => {
    const { prepareStoreRanking } = loadCommon();
    const rows = prepareStoreRanking(items);
    expect(rows.map((r) => r.storeId)).toEqual([2, 1, 3]);
  });

  test('sorts ascending and by string column', () => {
    const { prepareStoreRanking } = loadCommon();
    const byHandleAsc = prepareStoreRanking(items, { key: 'handleRate', dir: 'asc' });
    expect(byHandleAsc.map((r) => r.storeId)).toEqual([2, 1, 3]); // null last

    const byName = prepareStoreRanking(items, { key: 'storeName', dir: 'asc' });
    expect(byName.map((r) => r.storeName)).toEqual(['Alpha', 'Bravo', 'Charlie']);

    const byNameDesc = prepareStoreRanking(items, { key: 'storeName', dir: 'desc' });
    expect(byNameDesc.map((r) => r.storeName)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  test('flags bad cells per threshold (rate<0.8, waste>0.1, score<60, issues>0)', () => {
    const { prepareStoreRanking } = loadCommon();
    const rows = prepareStoreRanking(items, { key: 'storeName', dir: 'asc' });
    const [alpha, bravo, charlie] = rows;

    expect(alpha.flags).toEqual({
      handleRate: false,
      wasteRate: false,
      avgInspectionScore: false,
      openIssues: false,
      overdueIssues: false
    });
    expect(bravo.flags).toEqual({
      handleRate: true,
      wasteRate: true,
      avgInspectionScore: true,
      openIssues: true,
      overdueIssues: true
    });
    // Missing metrics are not flagged.
    expect(charlie.flags.handleRate).toBe(false);
    expect(charlie.flags.wasteRate).toBe(false);
    expect(charlie.flags.avgInspectionScore).toBe(false);
  });

  test('tolerates non-array input and string numbers', () => {
    const { prepareStoreRanking } = loadCommon();
    expect(prepareStoreRanking(null)).toEqual([]);
    const rows = prepareStoreRanking([
      { storeId: 9, storeName: 'S', handleRate: '0.5', wasteRate: '0.2', openIssues: '1', overdueIssues: '0' }
    ]);
    expect(rows[0].handleRate).toBe(0.5);
    expect(rows[0].flags.handleRate).toBe(true);
    expect(rows[0].flags.openIssues).toBe(true);
    expect(rows[0].flags.overdueIssues).toBe(false);
  });
});

describe('admin-web common.js validatePromoRules (P2-3)', () => {
  test('normalizes valid rules and sorts by hoursBeforeExpiry descending', () => {
    const { validatePromoRules } = loadCommon();
    const result = validatePromoRules([
      { hoursBeforeExpiry: '12', action: 'remove', discountPercent: '30' },
      { hoursBeforeExpiry: '48', action: 'discount', discountPercent: '20' }
    ]);
    expect(result.ok).toBe(true);
    expect(result.rules).toEqual([
      { hoursBeforeExpiry: 48, action: 'discount', discountPercent: 20 },
      { hoursBeforeExpiry: 12, action: 'remove' } // remove drops discountPercent
    ]);
  });

  test('accepts an empty rule list', () => {
    const { validatePromoRules } = loadCommon();
    expect(validatePromoRules([])).toEqual({ ok: true, rules: [] });
    expect(validatePromoRules(undefined)).toEqual({ ok: true, rules: [] });
  });

  test('rejects non-positive or missing hoursBeforeExpiry', () => {
    const { validatePromoRules } = loadCommon();
    expect(validatePromoRules([{ hoursBeforeExpiry: 0, action: 'remove' }]).ok).toBe(false);
    expect(validatePromoRules([{ hoursBeforeExpiry: '', action: 'remove' }]).ok).toBe(false);
    expect(validatePromoRules([{ hoursBeforeExpiry: 'abc', action: 'remove' }]).ok).toBe(false);
  });

  test('rejects unknown actions and bad discount percentages', () => {
    const { validatePromoRules } = loadCommon();
    expect(validatePromoRules([{ hoursBeforeExpiry: 24, action: 'sale' }]).ok).toBe(false);
    expect(
      validatePromoRules([{ hoursBeforeExpiry: 24, action: 'discount' }]).ok
    ).toBe(false);
    expect(
      validatePromoRules([{ hoursBeforeExpiry: 24, action: 'discount', discountPercent: 0 }]).ok
    ).toBe(false);
    expect(
      validatePromoRules([{ hoursBeforeExpiry: 24, action: 'discount', discountPercent: 100 }]).ok
    ).toBe(false);
  });

  test('error message points at the offending row', () => {
    const { validatePromoRules } = loadCommon();
    const result = validatePromoRules([
      { hoursBeforeExpiry: 24, action: 'remove' },
      { hoursBeforeExpiry: 12, action: 'discount', discountPercent: 200 }
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('第 2 行');
  });
});

describe('admin-web compliance-view.js (P2-1)', () => {
  test('TYPES covers daily/weekly/monthly with their date params', () => {
    const { TYPES } = loadComplianceView();
    expect(TYPES.map((t) => t.value)).toEqual(['daily', 'weekly', 'monthly']);
    expect(TYPES.map((t) => t.dateParam)).toEqual(['date', 'weekStart', 'month']);
    expect(TYPES.map((t) => t.inputType)).toEqual(['date', 'date', 'month']);
  });

  test('buildComplianceUrl maps date param per type and skips empty filters', () => {
    const { buildComplianceUrl } = loadComplianceView();
    expect(
      buildComplianceUrl({ type: 'daily', date: '2026-06-10', brandId: 1, storeId: 2 })
    ).toBe('/api/admin/compliance/daily?date=2026-06-10&brandId=1&storeId=2');
    expect(buildComplianceUrl({ type: 'weekly', date: '2026-06-08' })).toBe(
      '/api/admin/compliance/weekly?weekStart=2026-06-08'
    );
    expect(buildComplianceUrl({ type: 'monthly', date: '2026-06', brandId: '' })).toBe(
      '/api/admin/compliance/monthly?month=2026-06'
    );
    expect(buildComplianceUrl({ type: 'yearly', date: '2026' })).toBeNull();
  });

  test('statusMeta colors ok/warning/fail and tolerates unknown values', () => {
    const { statusMeta } = loadComplianceView();
    expect(statusMeta('ok')).toEqual({ label: '正常', className: 'status-ok' });
    expect(statusMeta('warning')).toEqual({ label: '警告', className: 'status-warning' });
    expect(statusMeta('fail')).toEqual({ label: '不合格', className: 'status-fail' });
    expect(statusMeta('odd')).toEqual({ label: 'odd', className: 'status-unknown' });
    expect(statusMeta(null).className).toBe('status-unknown');
  });

  test('severityMeta maps high/medium/low', () => {
    const { severityMeta } = loadComplianceView();
    expect(severityMeta('high')).toEqual({ label: '高', className: 'severity-high' });
    expect(severityMeta('medium')).toEqual({ label: '中', className: 'severity-medium' });
    expect(severityMeta('low')).toEqual({ label: '低', className: 'severity-low' });
    expect(severityMeta('?').className).toBe('severity-unknown');
  });

  test('defaultDateFor returns today / Monday of week / current month', () => {
    const { defaultDateFor } = loadComplianceView();
    const wed = new Date(2026, 5, 10); // 2026-06-10 is a Wednesday
    expect(defaultDateFor('daily', wed)).toBe('2026-06-10');
    expect(defaultDateFor('weekly', wed)).toBe('2026-06-08');
    expect(defaultDateFor('monthly', wed)).toBe('2026-06');

    const mon = new Date(2026, 5, 8);
    expect(defaultDateFor('weekly', mon)).toBe('2026-06-08');
    const sun = new Date(2026, 5, 14);
    expect(defaultDateFor('weekly', sun)).toBe('2026-06-08');
  });
});
