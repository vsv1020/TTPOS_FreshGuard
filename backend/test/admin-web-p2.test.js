const fs = require('fs');
const path = require('path');
const vm = require('vm');

const adminWebDir = path.join(__dirname, '..', 'admin-web');
const commonJs = fs.readFileSync(path.join(adminWebDir, 'assets', 'common.js'), 'utf8');
const labelPreviewJs = fs.readFileSync(path.join(adminWebDir, 'assets', 'label-preview.js'), 'utf8');

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

function loadLabelPreview() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(labelPreviewJs, sandbox);
  return sandbox.window.LabelPreview;
}

describe('admin-web common.js product color helpers (P2-2)', () => {
  test('PRODUCT_COLORS covers the four kitchen color codes', () => {
    const { PRODUCT_COLORS } = loadCommon();
    expect(PRODUCT_COLORS.map((c) => c.code)).toEqual(['red', 'blue', 'green', 'yellow']);
    PRODUCT_COLORS.forEach((c) => {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.label.length).toBeGreaterThan(0);
    });
  });

  test('colorCodeMeta resolves known codes and rejects unknown ones', () => {
    const { colorCodeMeta } = loadCommon();
    expect(colorCodeMeta('red').label).toContain('畜肉');
    expect(colorCodeMeta('blue').label).toContain('水产');
    expect(colorCodeMeta('green').label).toContain('果蔬');
    expect(colorCodeMeta('yellow').label).toContain('熟食');
    expect(colorCodeMeta('purple')).toBeNull();
    expect(colorCodeMeta(null)).toBeNull();
    expect(colorCodeMeta('')).toBeNull();
  });
});

describe('admin-web label-preview.js layout helpers (P2-6)', () => {
  test('mmToPx converts using 25.4mm per inch', () => {
    const { mmToPx } = loadLabelPreview();
    expect(mmToPx(25.4, 200)).toBe(200);
    expect(mmToPx(60, 200)).toBe(472);
    expect(mmToPx(0, 200)).toBe(0);
    expect(mmToPx(undefined, 200)).toBe(0);
  });

  test('substituteTokens replaces known tokens and blanks unknown ones', () => {
    const { substituteTokens } = loadLabelPreview();
    const fields = { product_name: 'Milk', batch_id: 7 };
    expect(substituteTokens('{{product_name}} #{{batch_id}}', fields)).toBe('Milk #7');
    expect(substituteTokens('{{ product_name }}', fields)).toBe('Milk');
    expect(substituteTokens('x {{nope}} y', fields)).toBe('x  y');
    expect(substituteTokens(null, fields)).toBe('');
  });

  test('buildLayout computes pixel dims and classifies line types', () => {
    const { buildLayout } = loadLabelPreview();
    const layout = buildLayout({
      widthMm: 50.8,
      heightMm: 25.4,
      dpi: 100,
      bodyTemplate: '{{product_name}}\n{{barcode}}\nColor: {{color_label}}',
      fields: { product_name: 'Milk', barcode: 'FG-1', color_label: '红·畜肉禽类' }
    });

    expect(layout.widthPx).toBe(200);
    expect(layout.heightPx).toBe(100);
    expect(layout.marginPx).toBe(8);
    expect(layout.fontPx).toBeGreaterThanOrEqual(8);
    expect(layout.lineHeightPx).toBeGreaterThan(layout.fontPx);
    expect(layout.lines).toEqual([
      { type: 'text', text: 'Milk' },
      { type: 'barcode', text: 'FG-1' },
      { type: 'color', text: 'Color: 红·畜肉禽类' }
    ]);
  });

  test('buildLayout falls back to 60x40mm @200dpi defaults', () => {
    const { buildLayout } = loadLabelPreview();
    const layout = buildLayout({ bodyTemplate: '' });
    expect(layout.widthMm).toBe(60);
    expect(layout.heightMm).toBe(40);
    expect(layout.dpi).toBe(200);
    expect(layout.widthPx).toBe(472);
    expect(layout.heightPx).toBe(315);
    expect(layout.lines).toEqual([{ type: 'text', text: '' }]);
  });

  test('SIZE_PRESETS exposes the common thermal label sizes', () => {
    const { SIZE_PRESETS } = loadLabelPreview();
    expect(SIZE_PRESETS).toEqual([
      { widthMm: 40, heightMm: 30 },
      { widthMm: 50, heightMm: 30 },
      { widthMm: 60, heightMm: 40 }
    ]);
  });
});
