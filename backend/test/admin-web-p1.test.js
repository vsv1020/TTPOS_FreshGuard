const fs = require('fs');
const path = require('path');
const vm = require('vm');

const adminWebDir = path.join(__dirname, '..', 'admin-web');
const commonJs = fs.readFileSync(path.join(adminWebDir, 'assets', 'common.js'), 'utf8');

function fakeDoc(navEls = []) {
  const classes = new Set();
  return {
    body: {
      classList: {
        add: (c) => classes.add(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c) => classes.has(c)
      }
    },
    querySelectorAll: (selector) => (selector === '[data-nav="admins"]' ? navEls : []),
    createElement: () => ({ textContent: '', innerHTML: '' })
  };
}

function loadCommon({ storage = {}, doc } = {}) {
  const document = doc || fakeDoc();
  const sandbox = {
    window: {},
    document,
    localStorage: {
      getItem: (key) => (key in storage ? storage[key] : null),
      setItem: (key, value) => {
        storage[key] = String(value);
      },
      removeItem: (key) => {
        delete storage[key];
      }
    },
    fetch: () => Promise.resolve(),
    URLSearchParams,
    clearTimeout,
    setTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(commonJs, sandbox);
  return { AdminCommon: sandbox.window.AdminCommon, storage, document };
}

describe('admin-web common.js role helpers', () => {
  test('resolveRoleFlags maps the three contract roles', () => {
    const { AdminCommon } = loadCommon();

    expect(AdminCommon.resolveRoleFlags('platform_admin')).toEqual({
      isViewer: false,
      isPlatformAdmin: true,
      canWrite: true
    });
    expect(AdminCommon.resolveRoleFlags('brand_admin')).toEqual({
      isViewer: false,
      isPlatformAdmin: false,
      canWrite: true
    });
    expect(AdminCommon.resolveRoleFlags('viewer')).toEqual({
      isViewer: true,
      isPlatformAdmin: false,
      canWrite: false
    });
  });

  test('resolveRoleFlags fails open for unknown/legacy roles (server enforces RBAC)', () => {
    const { AdminCommon } = loadCommon();
    expect(AdminCommon.resolveRoleFlags(null).isPlatformAdmin).toBe(true);
    expect(AdminCommon.resolveRoleFlags(undefined).canWrite).toBe(true);
    expect(AdminCommon.resolveRoleFlags('admin').isPlatformAdmin).toBe(true);
  });

  test('storeSession / getSession / clearSession round-trip', () => {
    const { AdminCommon } = loadCommon();
    AdminCommon.storeSession({ id: 7, email: 'a@b.c', role: 'brand_admin', brandId: 2 });
    expect(AdminCommon.getSession()).toEqual({ id: 7, email: 'a@b.c', role: 'brand_admin', brandId: 2 });
    AdminCommon.clearSession();
    expect(AdminCommon.getSession()).toBeNull();
  });

  test('applyRoleVisibility: viewer hides writes, Admins nav stays hidden', () => {
    const navLink = { hidden: true };
    const doc = fakeDoc([navLink]);
    const { AdminCommon, document } = loadCommon({
      storage: { fgAdminUser: JSON.stringify({ role: 'viewer' }) },
      doc
    });

    AdminCommon.applyRoleVisibility(document);
    expect(document.body.classList.contains('role-viewer')).toBe(true);
    expect(navLink.hidden).toBe(true);
  });

  test('applyRoleVisibility: platform_admin sees Admins nav and write controls', () => {
    const navLink = { hidden: true };
    const doc = fakeDoc([navLink]);
    const { AdminCommon, document } = loadCommon({
      storage: { fgAdminUser: JSON.stringify({ role: 'platform_admin' }) },
      doc
    });

    AdminCommon.applyRoleVisibility(document);
    expect(document.body.classList.contains('role-viewer')).toBe(false);
    expect(navLink.hidden).toBe(false);
  });

  test('applyRoleVisibility: brand_admin keeps writes but not Admins nav', () => {
    const navLink = { hidden: true };
    const doc = fakeDoc([navLink]);
    const { AdminCommon, document } = loadCommon({
      storage: { fgAdminUser: JSON.stringify({ role: 'brand_admin', brandId: 3 }) },
      doc
    });

    AdminCommon.applyRoleVisibility(document);
    expect(document.body.classList.contains('role-viewer')).toBe(false);
    expect(navLink.hidden).toBe(true);
  });
});

describe('admin-web common.js formatImportSummary', () => {
  test('summarizes inserted/updated and lists errors with line numbers', () => {
    const { AdminCommon } = loadCommon();
    const summary = AdminCommon.formatImportSummary({
      inserted: 3,
      updated: 1,
      errors: [
        { line: 2, message: 'name is required' },
        { line: 5, message: 'shelfLifeDays must be a number' }
      ]
    });

    expect(summary.text).toBe('Imported: 3 inserted, 1 updated, 2 error(s).');
    expect(summary.errorLines).toEqual([
      'Line 2: name is required',
      'Line 5: shelfLifeDays must be a number'
    ]);
    expect(summary.hasErrors).toBe(true);
  });

  test('handles a clean import and malformed responses', () => {
    const { AdminCommon } = loadCommon();
    expect(AdminCommon.formatImportSummary({ inserted: 10, updated: 0, errors: [] })).toEqual({
      text: 'Imported: 10 inserted, 0 updated, 0 error(s).',
      errorLines: [],
      hasErrors: false
    });
    expect(AdminCommon.formatImportSummary(null).hasErrors).toBe(false);
  });
});

describe('admin-web static pages', () => {
  const pages = [
    'dashboard.html',
    'binding.html',
    'products.html',
    'staff.html',
    'label-templates.html',
    'report.html',
    'audit-logs.html',
    'admins.html'
  ];

  test('every page exposes the Admins nav entry (hidden by default)', () => {
    for (const page of pages) {
      const html = fs.readFileSync(path.join(adminWebDir, page), 'utf8');
      expect(html).toContain('data-nav="admins"');
      expect(html).toMatch(/<a[^>]*href="\/admin\/admins"[^>]*hidden[^>]*>/);
    }
  });

  test('admins.html has the account management UI', () => {
    const html = fs.readFileSync(path.join(adminWebDir, 'admins.html'), 'utf8');
    for (const id of [
      'admin-form',
      'admin-email',
      'admin-password',
      'admin-role',
      'admin-brand',
      'admins-controls',
      'admins-table',
      'edit-admin-form',
      'edit-admin-role',
      'edit-admin-brand',
      'edit-admin-disabled'
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('platform_admin');
    expect(html).toContain('brand_admin');
    expect(html).toContain('viewer');
    expect(html).toContain('assets/admins.js');
  });

  test('admins.js targets the contract endpoints', () => {
    const js = fs.readFileSync(path.join(adminWebDir, 'assets', 'admins.js'), 'utf8');
    expect(js).toContain('/api/admin/admins');
    expect(js).toContain('reset-password');
    expect(js).toContain('newPassword');
    expect(js).toContain("method: 'PUT'");
  });

  test('products.html has CSV toolbar and cost price inputs', () => {
    const html = fs.readFileSync(path.join(adminWebDir, 'products.html'), 'utf8');
    for (const id of ['export-csv-btn', 'download-template-btn', 'import-csv-btn', 'import-csv-file', 'import-result']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="product-cost-price"');
    expect(html).toContain('id="edit-product-cost-price"');
  });

  test('products.js wires CSV export/template/import per contract', () => {
    const js = fs.readFileSync(path.join(adminWebDir, 'assets', 'products.js'), 'utf8');
    expect(js).toContain("format: 'csv'");
    expect(js).toContain('/api/admin/products/import-template.csv');
    expect(js).toContain('/api/admin/products/import');
    expect(js).toContain('JSON.stringify({ csv })');
    expect(js).toContain('costPrice');
  });

  test('styles.css hides write affordances in viewer mode', () => {
    const css = fs.readFileSync(path.join(adminWebDir, 'assets', 'styles.css'), 'utf8');
    expect(css).toContain('body.role-viewer [data-write]');
    expect(css).toContain('body.role-viewer button[data-action]');
  });

  test('login stores the session for role-aware UI', () => {
    const loginHtml = fs.readFileSync(path.join(adminWebDir, 'login.html'), 'utf8');
    const loginJs = fs.readFileSync(path.join(adminWebDir, 'assets', 'login.js'), 'utf8');
    expect(loginHtml).toContain('assets/common.js');
    expect(loginJs).toContain('storeSession');
  });
});
