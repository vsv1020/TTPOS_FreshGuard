const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB_DIR = path.join(__dirname, '..', 'admin-web');
const i18nJs = fs.readFileSync(path.join(WEB_DIR, 'assets', 'i18n.js'), 'utf8');

const PAGES = [
  'dashboard', 'binding', 'products', 'staff', 'label-templates',
  'report', 'waste', 'compliance', 'audit-logs', 'admins', 'erp-sync'
];

function loadI18n() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(i18nJs, sandbox);
  return sandbox.window.AdminI18n;
}

function navBlock(page) {
  const html = fs.readFileSync(path.join(WEB_DIR, `${page}.html`), 'utf8');
  const m = html.match(/<nav class="topnav">[\s\S]*?<\/nav>/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

describe('admin-web navigation consistency', () => {
  test('every page renders the identical nav block', () => {
    const blocks = PAGES.map(navBlock);
    blocks.forEach((b) => expect(b).toBeTruthy());
    const unique = new Set(blocks);
    expect(unique.size).toBe(1);
  });

  test('the nav has all eleven links and none hardcodes class="active"', () => {
    const block = navBlock('dashboard');
    const keys = [
      'nav.dashboard', 'nav.binding', 'nav.products', 'nav.staff',
      'nav.labelTemplates', 'nav.report', 'nav.waste', 'nav.compliance',
      'nav.audit', 'nav.erpSync', 'nav.admins'
    ];
    keys.forEach((k) => expect(block).toContain(`data-i18n="${k}"`));
    // Active state is computed at runtime by markActiveNav, never baked in.
    expect(block).not.toContain('class="active"');
    // Admins stays platform-admin only.
    expect(block).toContain('data-nav="admins"');
  });
});

describe('admin-web i18n dictionary', () => {
  const AdminI18n = loadI18n();

  test('exposes zh / en / th', () => {
    expect(Object.keys(AdminI18n.STRINGS).sort()).toEqual(['en', 'th', 'zh']);
  });

  test('all three languages have the exact same key set', () => {
    const zh = Object.keys(AdminI18n.STRINGS.zh).sort();
    const en = Object.keys(AdminI18n.STRINGS.en).sort();
    const th = Object.keys(AdminI18n.STRINGS.th).sort();
    expect(en).toEqual(zh);
    expect(th).toEqual(zh);
  });

  test('no empty translations', () => {
    for (const lang of ['zh', 'en', 'th']) {
      for (const [, val] of Object.entries(AdminI18n.STRINGS[lang])) {
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    }
  });

  test('every nav.* key used in the markup exists in all languages', () => {
    const block = navBlock('dashboard');
    const used = [...block.matchAll(/data-i18n="(nav\.[a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(used.length).toBe(11);
    used.forEach((key) => {
      ['zh', 'en', 'th'].forEach((lang) => {
        expect(AdminI18n.STRINGS[lang][key]).toBeTruthy();
      });
    });
  });

  test('t() resolves per language and falls back to the key', () => {
    expect(AdminI18n.t('nav.dashboard', 'en')).toBe('Dashboard');
    expect(AdminI18n.t('nav.dashboard', 'zh')).toBe('仪表盘');
    expect(AdminI18n.t('nav.dashboard', 'th')).toBe('แดชบอร์ด');
    expect(AdminI18n.t('does.not.exist', 'en')).toBe('does.not.exist');
  });

  test('every data-i18n key used in any page exists in the dictionary', () => {
    const re = /data-i18n(?:-ph|-title)?="([^"]+)"/g;
    const missing = [];
    PAGES.concat(['login']).forEach((page) => {
      const fp = path.join(WEB_DIR, `${page}.html`);
      if (!fs.existsSync(fp)) return;
      const html = fs.readFileSync(fp, 'utf8');
      let m;
      while ((m = re.exec(html))) {
        if (!(m[1] in AdminI18n.STRINGS.zh)) missing.push(`${page}: ${m[1]}`);
      }
    });
    expect(missing).toEqual([]);
  });
});
