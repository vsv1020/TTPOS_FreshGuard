const fs = require('fs');
const path = require('path');
const vm = require('vm');

const adminWebDir = path.join(__dirname, '..', 'admin-web');
const commonJs = fs.readFileSync(path.join(adminWebDir, 'assets', 'common.js'), 'utf8');

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

describe('admin-web common.js waste helpers', () => {
  test('formatPercent formats 0..1 rates and rejects non-numbers', () => {
    const AdminCommon = loadCommon();
    expect(AdminCommon.formatPercent(0.125)).toBe('12.5%');
    expect(AdminCommon.formatPercent(0)).toBe('0.0%');
    expect(AdminCommon.formatPercent(1)).toBe('100.0%');
    expect(AdminCommon.formatPercent(null)).toBe('-');
    expect(AdminCommon.formatPercent(undefined)).toBe('-');
    expect(AdminCommon.formatPercent('abc')).toBe('-');
  });

  test('prepareWasteView normalizes the summary and tolerates malformed input', () => {
    const AdminCommon = loadCommon();
    const view = AdminCommon.prepareWasteView({
      summary: { totalBatches: 100, discardedCount: 8, wasteRate: 0.08, discardAmount: 42.5, missingCostCount: 3 }
    });
    expect(view.summary).toEqual({
      totalBatches: 100,
      discardedCount: 8,
      wasteRate: 0.08,
      discardAmount: 42.5,
      missingCostCount: 3
    });
    expect(view.byStore).toEqual([]);
    expect(view.byProduct).toEqual([]);
    expect(view.byReason).toEqual([]);
    expect(view.trend).toEqual([]);

    const empty = AdminCommon.prepareWasteView(null);
    expect(empty.summary.totalBatches).toBe(0);
    expect(empty.byStore).toEqual([]);
  });

  test('prepareWasteView ranks stores worst-first and flags rates above the overall rate', () => {
    const AdminCommon = loadCommon();
    const view = AdminCommon.prepareWasteView({
      summary: { totalBatches: 30, discardedCount: 6, wasteRate: 0.2, discardAmount: 10 },
      byStore: [
        { storeId: 1, storeName: 'Low', totalBatches: 10, discardedCount: 1, wasteRate: 0.1, discardAmount: 1 },
        { storeId: 2, storeName: 'High', totalBatches: 10, discardedCount: 4, wasteRate: 0.4, discardAmount: 8 },
        { storeId: 3, storeName: 'Avg', totalBatches: 10, discardedCount: 2, wasteRate: 0.2, discardAmount: 1 }
      ]
    });

    expect(view.byStore.map((s) => s.storeName)).toEqual(['High', 'Avg', 'Low']);
    expect(view.byStore.map((s) => s.high)).toEqual([true, false, false]);
  });

  test('prepareWasteView keeps the top N products by discarded count', () => {
    const AdminCommon = loadCommon();
    const byProduct = Array.from({ length: 15 }, (_, i) => ({
      productId: i + 1,
      productName: `P${i + 1}`,
      discardedCount: i + 1,
      discardAmount: 0,
      wasteRate: 0.1
    }));
    const view = AdminCommon.prepareWasteView({ byProduct });

    expect(view.byProduct).toHaveLength(10);
    expect(view.byProduct[0].productName).toBe('P15');
    expect(view.byProduct[9].productName).toBe('P6');
  });

  test('prepareWasteView breaks product ties by discard amount', () => {
    const AdminCommon = loadCommon();
    const view = AdminCommon.prepareWasteView({
      byProduct: [
        { productName: 'Cheap', discardedCount: 2, discardAmount: 1 },
        { productName: 'Pricey', discardedCount: 2, discardAmount: 9 }
      ]
    });
    expect(view.byProduct.map((p) => p.productName)).toEqual(['Pricey', 'Cheap']);
  });

  test('prepareWasteView computes reason distribution percentages', () => {
    const AdminCommon = loadCommon();
    const view = AdminCommon.prepareWasteView({
      byReason: [
        { reason: 'expired', count: 3 },
        { reason: 'damaged', count: 1 }
      ]
    });

    expect(view.byReason[0]).toEqual({ reason: 'expired', count: 3, pct: 75 });
    expect(view.byReason[1]).toEqual({ reason: 'damaged', count: 1, pct: 25 });
  });

  test('prepareWasteView scales trend bars to the busiest day', () => {
    const AdminCommon = loadCommon();
    const view = AdminCommon.prepareWasteView({
      trend: [
        { date: '2026-06-01', discardedCount: 2, discardAmount: 4 },
        { date: '2026-06-02', discardedCount: 8, discardAmount: 16 },
        { date: '2026-06-03', discardedCount: 0, discardAmount: 0 }
      ]
    });

    expect(view.trend.map((t) => t.heightPct)).toEqual([25, 100, 0]);
    expect(view.trend[1]).toMatchObject({ date: '2026-06-02', discardedCount: 8, discardAmount: 16 });
  });
});

describe('admin-web waste dashboard page', () => {
  test('waste.html has the dashboard UI and role-aware nav', () => {
    const html = fs.readFileSync(path.join(adminWebDir, 'waste.html'), 'utf8');
    for (const id of [
      'waste-from',
      'waste-to',
      'waste-brand',
      'waste-store',
      'waste-refresh',
      'waste-total-batches',
      'waste-discarded-count',
      'waste-rate',
      'waste-discard-amount',
      'waste-missing-cost',
      'waste-by-store',
      'waste-by-product',
      'waste-by-reason',
      'waste-trend'
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('data-nav="admins"');
    expect(html).toContain('assets/waste.js');
    expect(html).toContain('assets/common.js');
  });

  test('waste.js targets the contract endpoint with all filters', () => {
    const js = fs.readFileSync(path.join(adminWebDir, 'assets', 'waste.js'), 'utf8');
    expect(js).toContain('/api/admin/reports/waste');
    expect(js).toContain("params.set('from'");
    expect(js).toContain("params.set('to'");
    expect(js).toContain("params.set('brandId'");
    expect(js).toContain("params.set('storeId'");
    expect(js).toContain('prepareWasteView');
    expect(js).toContain('missingCostCount');
  });

  test('every admin page links to the waste dashboard', () => {
    const pages = [
      'dashboard.html',
      'binding.html',
      'products.html',
      'staff.html',
      'label-templates.html',
      'report.html',
      'audit-logs.html',
      'admins.html',
      'waste.html'
    ];
    for (const page of pages) {
      const html = fs.readFileSync(path.join(adminWebDir, page), 'utf8');
      expect(html).toContain('href="/admin/waste"');
    }
  });
});
