const productForm = document.getElementById('product-form');
const printerForm = document.getElementById('printer-form');
const brandSelect = document.getElementById('product-brand');
const storeSelect = document.getElementById('printer-store');
const productsTable = document.getElementById('products-table');
const labelLanguageSelect = document.getElementById('product-label-language');
const primaryLanguageSelect = document.getElementById('product-primary-language');
const secondaryLanguageSelect = document.getElementById('product-secondary-language');
const printerSelectedHint = document.getElementById('printer-selected-hint');

const editModal = document.getElementById('edit-modal');
const editProductForm = document.getElementById('edit-product-form');
const editBrandSelect = document.getElementById('edit-product-brand');
const editLabelLanguageSelect = document.getElementById('edit-product-label-language');
const editPrimaryLanguageSelect = document.getElementById('edit-product-primary-language');
const editSecondaryLanguageSelect = document.getElementById('edit-product-secondary-language');
const editCancelBtn = document.getElementById('edit-cancel-btn');

let brands = [];
let stores = [];
let currentProducts = [];
const LANGUAGE_OPTIONS = ['en', 'es', 'fr', 'zh'];

const productListControls = window.AdminCommon.createListControls({
  container: 'products-controls',
  searchPlaceholder: 'Search products (name / SKU)...',
  onChange: () => loadProducts().catch((error) => window.AdminCommon.setPageMessage(error.message, true))
});

function renderBrandSelect() {
  const esc = window.AdminCommon.esc;
  const options = brands.map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`).join('');
  brandSelect.innerHTML = options;
  editBrandSelect.innerHTML = options;
}

function renderStoreSelect() {
  const esc = window.AdminCommon.esc;
  storeSelect.innerHTML = stores
    .map((store) => `<option value="${esc(store.id)}">${esc(store.brandName)} / ${esc(store.name)}</option>`)
    .join('');
  syncPrinterFormWithSelectedStore();
}

function renderProducts(products) {
  const esc = window.AdminCommon.esc;
  productsTable.innerHTML = products
    .map(
      (product) => `<tr>
      <td>${esc(product.brandName)}</td>
      <td>${esc(product.name)}</td>
      <td>${esc(product.sku || '-')}</td>
      <td>${esc(product.shelfLifeDays)}</td>
      <td>${esc(product.labelLanguage)}</td>
      <td>${esc(product.primaryLanguage)}</td>
      <td>${esc(product.secondaryLanguage || '-')}</td>
      <td>${esc(product.allergens || '-')}</td>
      <td>${esc(product.storageConditions || '-')}</td>
      <td>${esc(product.openedShelfLifeHours != null ? product.openedShelfLifeHours : '-')}</td>
      <td>${esc(product.costPrice != null ? product.costPrice : '-')}</td>
      <td style="white-space:nowrap;">
        <button type="button" data-action="edit" data-id="${esc(product.id)}" style="background:#0369a1;padding:6px 10px;font-size:0.82rem;">Edit</button>
        <button type="button" data-action="delete" data-id="${esc(product.id)}" style="background:#b91c1c;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Delete</button>
      </td>
    </tr>`
    )
    .join('');
}

function renderLanguageSelects() {
  const options = LANGUAGE_OPTIONS.map((lang) => `<option value="${lang}">${lang}</option>`).join('');
  const noneOption = '<option value="">none</option>';

  primaryLanguageSelect.innerHTML = options;
  secondaryLanguageSelect.innerHTML = noneOption + options;
  editPrimaryLanguageSelect.innerHTML = options;
  editSecondaryLanguageSelect.innerHTML = noneOption + options;

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

function syncEditSecondaryLanguageRequired() {
  const isBilingual = editLabelLanguageSelect.value === 'bilingual';
  editSecondaryLanguageSelect.required = isBilingual;
  editSecondaryLanguageSelect.disabled = !isBilingual;
  if (!isBilingual) {
    editSecondaryLanguageSelect.value = '';
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

function openEditModal(product) {
  document.getElementById('edit-product-id').value = product.id;
  editBrandSelect.value = String(product.brandId);
  document.getElementById('edit-product-name').value = product.name || '';
  document.getElementById('edit-product-sku').value = product.sku || '';
  document.getElementById('edit-product-shelf-life').value = product.shelfLifeDays ?? '';
  editLabelLanguageSelect.value = product.labelLanguage || 'single';
  editPrimaryLanguageSelect.value = product.primaryLanguage || 'en';

  syncEditSecondaryLanguageRequired();
  editSecondaryLanguageSelect.value = product.secondaryLanguage || '';

  document.getElementById('edit-product-allergens').value = product.allergens || '';
  document.getElementById('edit-product-storage-conditions').value = product.storageConditions || '';
  document.getElementById('edit-product-opened-shelf-life-hours').value =
    product.openedShelfLifeHours != null ? product.openedShelfLifeHours : '';
  document.getElementById('edit-product-cost-price').value =
    product.costPrice != null ? product.costPrice : '';

  editModal.style.display = 'flex';
}

function closeEditModal() {
  editModal.style.display = 'none';
  editProductForm.reset();
}

async function loadProducts() {
  const res = await window.AdminCommon.requestJson(`/api/admin/products?${productListControls.queryString()}`);
  if (!res) {
    return;
  }
  const { items, total } = window.AdminCommon.unwrapList(res, 'products');
  currentProducts = items;
  renderProducts(items);
  productListControls.update({ total, count: items.length });
}

async function loadAll() {
  const [brandRes, storeRes] = await Promise.all([
    window.AdminCommon.requestJson('/api/admin/brands'),
    window.AdminCommon.requestJson('/api/admin/stores')
  ]);

  if (!brandRes || !storeRes) {
    return;
  }

  brands = brandRes.brands;
  stores = storeRes.stores;

  renderBrandSelect();
  renderStoreSelect();
  await loadProducts();
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
    secondaryLanguage: secondaryLanguageSelect.value,
    allergens: textOrNull(document.getElementById('product-allergens').value),
    storageConditions: textOrNull(document.getElementById('product-storage-conditions').value),
    openedShelfLifeHours: parseNumberOrNull(document.getElementById('product-opened-shelf-life-hours').value),
    costPrice: parseNumberOrNull(document.getElementById('product-cost-price').value)
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
    await loadProducts();
    window.AdminCommon.setPageMessage('Product created.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

editProductForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const id = document.getElementById('edit-product-id').value;
  const payload = {
    brandId: Number(editBrandSelect.value),
    name: document.getElementById('edit-product-name').value.trim(),
    sku: document.getElementById('edit-product-sku').value.trim(),
    shelfLifeDays: Number(document.getElementById('edit-product-shelf-life').value),
    labelLanguage: editLabelLanguageSelect.value,
    primaryLanguage: editPrimaryLanguageSelect.value,
    secondaryLanguage: editSecondaryLanguageSelect.value,
    allergens: textOrNull(document.getElementById('edit-product-allergens').value),
    storageConditions: textOrNull(document.getElementById('edit-product-storage-conditions').value),
    openedShelfLifeHours: parseNumberOrNull(document.getElementById('edit-product-opened-shelf-life-hours').value),
    costPrice: parseNumberOrNull(document.getElementById('edit-product-cost-price').value)
  };

  try {
    await window.AdminCommon.requestJson(`/api/admin/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    closeEditModal();
    await loadProducts();
    window.AdminCommon.setPageMessage('Product updated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

productsTable.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) {
    return;
  }

  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') {
    const product = currentProducts.find((p) => String(p.id) === String(id));
    if (product) {
      openEditModal(product);
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm('Delete this product? This cannot be undone.')) {
      return;
    }
    window.AdminCommon.setPageMessage('');
    try {
      await window.AdminCommon.requestJson(`/api/admin/products/${id}`, { method: 'DELETE' });
      await loadProducts();
      window.AdminCommon.setPageMessage('Product deleted.');
    } catch (error) {
      window.AdminCommon.setPageMessage(error.message, true);
    }
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

const exportCsvBtn = document.getElementById('export-csv-btn');
const downloadTemplateBtn = document.getElementById('download-template-btn');
const importCsvBtn = document.getElementById('import-csv-btn');
const importCsvFile = document.getElementById('import-csv-file');
const importResult = document.getElementById('import-result');

async function downloadCsv(url, filename) {
  const response = await fetch(url, { credentials: 'include' });

  if (response.status === 401 || response.status === 403) {
    window.location.href = '/admin/login';
    return;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Download failed (${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

exportCsvBtn.addEventListener('click', async () => {
  window.AdminCommon.setPageMessage('');
  const params = new URLSearchParams({ format: 'csv' });
  if (productListControls.state.q) {
    params.set('q', productListControls.state.q);
  }
  try {
    await downloadCsv(`/api/admin/products?${params.toString()}`, 'products.csv');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

downloadTemplateBtn.addEventListener('click', async () => {
  window.AdminCommon.setPageMessage('');
  try {
    await downloadCsv('/api/admin/products/import-template.csv', 'products-import-template.csv');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

importCsvBtn.addEventListener('click', () => {
  importCsvFile.click();
});

importCsvFile.addEventListener('change', async () => {
  const file = importCsvFile.files && importCsvFile.files[0];
  if (!file) {
    return;
  }
  importCsvFile.value = '';
  window.AdminCommon.setPageMessage('');
  importResult.textContent = 'Importing...';

  try {
    const csv = await file.text();
    const result = await window.AdminCommon.requestJson('/api/admin/products/import', {
      method: 'POST',
      body: JSON.stringify({ csv })
    });
    if (!result) {
      return;
    }
    const summary = window.AdminCommon.formatImportSummary(result);
    importResult.textContent = [summary.text, ...summary.errorLines].join('\n');
    importResult.classList.toggle('error', summary.hasErrors);
    await loadProducts();
  } catch (error) {
    importResult.textContent = '';
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

editLabelLanguageSelect.addEventListener('change', syncEditSecondaryLanguageRequired);
editCancelBtn.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (event) => {
  if (event.target === editModal) {
    closeEditModal();
  }
});

labelLanguageSelect.addEventListener('change', syncSecondaryLanguageRequired);
storeSelect.addEventListener('change', syncPrinterFormWithSelectedStore);

window.AdminCommon.bindLogout();
renderLanguageSelects();
syncSecondaryLanguageRequired();
loadAll().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
