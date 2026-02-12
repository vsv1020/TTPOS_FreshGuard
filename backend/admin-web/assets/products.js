const productForm = document.getElementById('product-form');
const printerForm = document.getElementById('printer-form');
const brandSelect = document.getElementById('product-brand');
const storeSelect = document.getElementById('printer-store');
const productsTable = document.getElementById('products-table');
const labelLanguageSelect = document.getElementById('product-label-language');
const primaryLanguageSelect = document.getElementById('product-primary-language');
const secondaryLanguageSelect = document.getElementById('product-secondary-language');
const printerSelectedHint = document.getElementById('printer-selected-hint');

let brands = [];
let stores = [];
const LANGUAGE_OPTIONS = ['en', 'es', 'fr', 'zh'];

function renderBrandSelect() {
  brandSelect.innerHTML = brands.map((brand) => `<option value="${brand.id}">${brand.name}</option>`).join('');
}

function renderStoreSelect() {
  storeSelect.innerHTML = stores
    .map((store) => `<option value="${store.id}">${store.brandName} / ${store.name}</option>`)
    .join('');
  syncPrinterFormWithSelectedStore();
}

function renderProducts(products) {
  productsTable.innerHTML = products
    .map(
      (product) => `<tr>
      <td>${product.brandName}</td>
      <td>${product.name}</td>
      <td>${product.sku || '-'}</td>
      <td>${product.shelfLifeDays}</td>
      <td>${product.labelLanguage}</td>
      <td>${product.primaryLanguage}</td>
      <td>${product.secondaryLanguage || '-'}</td>
    </tr>`
    )
    .join('');
}

function renderLanguageSelects() {
  primaryLanguageSelect.innerHTML = LANGUAGE_OPTIONS.map(
    (lang) => `<option value="${lang}">${lang}</option>`
  ).join('');

  secondaryLanguageSelect.innerHTML = [
    '<option value="">none</option>',
    ...LANGUAGE_OPTIONS.map((lang) => `<option value="${lang}">${lang}</option>`)
  ].join('');

  primaryLanguageSelect.value = 'en';
}

function syncSecondaryLanguageRequired() {
  const isBilingual = labelLanguageSelect.value === 'bilingual';
  secondaryLanguageSelect.required = isBilingual;
  secondaryLanguageSelect.disabled = !isBilingual;
  if (!isBilingual) {
    secondaryLanguageSelect.value = '';
  }
}

function parseNumberOrNull(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return null;
  }
  return Number(value);
}

function textOrNull(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function applyStorePrinterSettings(store) {
  document.getElementById('printer-name').value = store?.printerName || '';
  document.getElementById('printer-model').value = store?.printerModel || '';
  document.getElementById('printer-address').value = store?.printerAddress || '';
  document.getElementById('printer-port').value = store?.printerPort ?? '';
  document.getElementById('printer-dpi').value = store?.printerDpi ?? '';
  document.getElementById('label-width-mm').value = store?.labelWidthMm ?? '';

  if (!store) {
    printerSelectedHint.textContent = '';
    return;
  }

  const status = store.printerName
    ? `Loaded settings for ${store.brandName} / ${store.name}.`
    : `No printer settings yet for ${store.brandName} / ${store.name}.`;
  printerSelectedHint.textContent = status;
}

function syncPrinterFormWithSelectedStore() {
  const selectedId = Number(storeSelect.value);
  const store = stores.find((item) => item.id === selectedId);
  applyStorePrinterSettings(store);
}

async function loadAll() {
  const [brandRes, storeRes, productsRes] = await Promise.all([
    window.AdminCommon.requestJson('/api/admin/brands'),
    window.AdminCommon.requestJson('/api/admin/stores'),
    window.AdminCommon.requestJson('/api/admin/products')
  ]);

  brands = brandRes.brands;
  stores = storeRes.stores;

  renderBrandSelect();
  renderStoreSelect();
  renderProducts(productsRes.products);
}

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const payload = {
    brandId: Number(brandSelect.value),
    name: document.getElementById('product-name').value.trim(),
    sku: document.getElementById('product-sku').value.trim(),
    shelfLifeDays: Number(document.getElementById('product-shelf-life').value),
    labelLanguage: labelLanguageSelect.value,
    primaryLanguage: primaryLanguageSelect.value,
    secondaryLanguage: secondaryLanguageSelect.value
  };

  try {
    await window.AdminCommon.requestJson('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    productForm.reset();
    primaryLanguageSelect.value = 'en';
    secondaryLanguageSelect.value = '';
    syncSecondaryLanguageRequired();
    await loadAll();
    window.AdminCommon.setPageMessage('Product created.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

printerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const storeId = Number(storeSelect.value);
  const payload = {
    printerName: textOrNull(document.getElementById('printer-name').value),
    printerModel: textOrNull(document.getElementById('printer-model').value),
    printerAddress: textOrNull(document.getElementById('printer-address').value),
    printerPort: parseNumberOrNull(document.getElementById('printer-port').value),
    printerDpi: parseNumberOrNull(document.getElementById('printer-dpi').value),
    labelWidthMm: parseNumberOrNull(document.getElementById('label-width-mm').value)
  };

  try {
    await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/printer-settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    await loadAll();
    storeSelect.value = String(storeId);
    syncPrinterFormWithSelectedStore();
    window.AdminCommon.setPageMessage('Printer settings updated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

labelLanguageSelect.addEventListener('change', syncSecondaryLanguageRequired);
storeSelect.addEventListener('change', syncPrinterFormWithSelectedStore);

window.AdminCommon.bindLogout();
renderLanguageSelects();
syncSecondaryLanguageRequired();
loadAll().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
