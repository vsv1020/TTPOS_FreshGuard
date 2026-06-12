const {
  LABEL_LANGUAGE_SINGLE,
  LABEL_LANGUAGE_BILINGUAL,
  PRODUCT_COLOR_CODES,
  PRODUCT_COLOR_LABELS
} = require('./util');

function normalizeColorCode(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!PRODUCT_COLOR_CODES.includes(normalized)) {
    throw new Error('colorCode must be red, blue, green, or yellow');
  }
  return normalized;
}

function colorCodeLabel(colorCode) {
  return colorCode ? PRODUCT_COLOR_LABELS[colorCode] || null : null;
}

function normalizeLabelLanguage(labelLanguage) {
  const value = String(labelLanguage || LABEL_LANGUAGE_SINGLE).trim().toLowerCase();
  if (value !== LABEL_LANGUAGE_SINGLE && value !== LABEL_LANGUAGE_BILINGUAL) {
    throw new Error('labelLanguage must be single or bilingual');
  }
  return value;
}

function getProductLabelLanguages(product) {
  const languages = [String(product.primaryLanguage || 'en').trim().toLowerCase()].filter(Boolean);
  if (product.labelLanguage === LABEL_LANGUAGE_BILINGUAL && product.secondaryLanguage) {
    languages.push(String(product.secondaryLanguage).trim().toLowerCase());
  }
  return languages;
}

function renderLabelTemplate({
  template,
  productName,
  batchId,
  printedAt,
  expiresAt,
  storeName,
  languages,
  allergens,
  storageConditions,
  barcodeData,
  opened,
  colorLabel
}) {
  // Clear multi-line label layout closer to a real printed shelf-life label.
  // The leading keyed lines (Store / Product / Batch ID / Languages) are kept
  // verbatim so existing label consumers and tests continue to match.
  const lines = [];

  lines.push('=== FreshGuard Label ===');
  if (opened) {
    lines.push('** OPENED / 已开封 **');
  }
  lines.push(`Store: ${storeName}`);
  lines.push(`Product: ${productName}`);
  lines.push(`Batch ID: ${batchId}`);
  lines.push(`Template: ${template}`);
  lines.push(`Languages: ${languages.join(', ')}`);
  lines.push('------------------------');
  lines.push(`Printed At: ${printedAt}`);
  lines.push(`Expires At: ${expiresAt}`);

  const allergensText = String(allergens || '').trim();
  if (allergensText) {
    lines.push(`过敏原: ${allergensText}`);
  }
  const storageText = String(storageConditions || '').trim();
  if (storageText) {
    lines.push(`存储: ${storageText}`);
  }
  // P2-2: monochrome thermal label — the color shows as a text marker.
  if (colorLabel) {
    lines.push(`色标: ${colorLabel}`);
  }

  lines.push('------------------------');
  if (template === LABEL_LANGUAGE_BILINGUAL) {
    lines.push(`Primary Name [${languages[0]}]: ${productName}`);
    lines.push(`Secondary Name [${languages[1] || ''}]: ${productName}`);
  } else {
    lines.push(`Name [${languages[0] || 'en'}]: ${productName}`);
  }

  const barcodeText = String(barcodeData || '').trim();
  if (barcodeText) {
    lines.push('------------------------');
    lines.push(`Barcode: ${barcodeText}`);
  }

  return lines.join('\n');
}

function renderLabelFromTemplate(bodyTemplate, fields = {}) {
  // Replace {{placeholder}} tokens with the matching field value.
  // Missing values render as an empty string.
  return String(bodyTemplate || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = fields[key];
    return value == null ? '' : String(value);
  });
}

function getStorePrinterSettings(store) {
  return {
    printerName: store.printerName || null,
    printerModel: store.printerModel || null,
    printerAddress: store.printerAddress || null,
    printerPort: store.printerPort ?? null,
    printerDpi: store.printerDpi ?? null,
    labelWidthMm: store.labelWidthMm ?? null
  };
}

// Build the flat placeholder field map for a label object.
function buildLabelTemplateFields(label) {
  return {
    product_name: label.productName,
    expires_at: label.expiresAt,
    printed_at: label.printedAt,
    batch_id: label.batchId,
    store_name: label.storeName,
    barcode: label.barcodeData,
    allergens: label.allergens,
    storage: label.storageConditions,
    opened: label.opened ? 'OPENED' : '',
    // The admin template editor documents {{color_label}}/{{color_code}}
    // (snake_case, matching the other fields); {{colorLabel}} is kept as a
    // legacy alias for templates authored before the docs existed.
    colorLabel: label.colorLabel || '',
    color_label: label.colorLabel || '',
    color_code: label.colorCode || ''
  };
}

module.exports = {
  normalizeColorCode,
  colorCodeLabel,
  normalizeLabelLanguage,
  getProductLabelLanguages,
  renderLabelTemplate,
  renderLabelFromTemplate,
  getStorePrinterSettings,
  buildLabelTemplateFields
};
