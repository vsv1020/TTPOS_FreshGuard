(function bootstrapLabelPreview() {
  // P2-6: pure layout helpers for the visual label preview. No DOM/canvas
  // access here so the logic can be unit-tested in a vm sandbox; the canvas
  // drawing lives in label-templates.js.

  const SIZE_PRESETS = [
    { widthMm: 40, heightMm: 30 },
    { widthMm: 50, heightMm: 30 },
    { widthMm: 60, heightMm: 40 }
  ];

  function mmToPx(mm, dpi) {
    return Math.round(((Number(mm) || 0) / 25.4) * (Number(dpi) || 0));
  }

  // Replaces {{token}} placeholders; unknown tokens render as empty strings,
  // matching the server-side preview behavior.
  function substituteTokens(template, fields) {
    return String(template == null ? '' : template).replace(
      /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g,
      (_m, key) => (fields && fields[key] != null ? String(fields[key]) : '')
    );
  }

  // Builds a resolution-dependent layout for one label: pixel dimensions at
  // the given DPI plus one entry per body-template line.
  // Line types: 'barcode' ({{barcode}} lines render as mock black bars),
  // 'color' ({{color_label}} lines render as a bordered text mark — thermal
  // printers are monochrome, so color shows as text, not real color),
  // 'text' for everything else.
  function buildLayout({ widthMm, heightMm, dpi, bodyTemplate, fields }) {
    const w = Number(widthMm) || 60;
    const h = Number(heightMm) || 40;
    const d = Number(dpi) || 200;
    const widthPx = mmToPx(w, d);
    const heightPx = mmToPx(h, d);
    const marginPx = mmToPx(2, d);
    const fontPx = Math.max(8, mmToPx(3, d));
    const lineHeightPx = Math.round(fontPx * 1.45);

    const lines = String(bodyTemplate || '')
      .split('\n')
      .map((raw) => {
        let type = 'text';
        if (/\{\{\s*barcode\s*\}\}/.test(raw)) {
          type = 'barcode';
        } else if (/\{\{\s*(?:color_label|colorLabel)\s*\}\}/.test(raw)) {
          type = 'color';
        }
        return { type, text: substituteTokens(raw, fields).trim() };
      });

    return { widthMm: w, heightMm: h, dpi: d, widthPx, heightPx, marginPx, fontPx, lineHeightPx, lines };
  }

  const api = { SIZE_PRESETS, mmToPx, substituteTokens, buildLayout };

  if (typeof window !== 'undefined') {
    window.LabelPreview = api;
  }
})();
