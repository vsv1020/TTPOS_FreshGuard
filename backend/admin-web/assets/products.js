const productForm = document.getElementById('product-form');
const printerForm = document.getElementById('printer-form');
const brandSelect = document.getElementById('product-brand');
const storeSelect = document.getElementById('printer-store');
const productsTable = document.getElementById('products-table');
const labelLanguageSelect = document.getElementById('product-label-language');
const secondaryLanguageInput = document.getElementById('product-secondary-language');

let brands = [];
let stores = [];

function renderBrandSelect() {
  brandSelect.innerHTML = brands.map((brand) => `<option value="${brand.id}">${brand.name}</option>`).join('');
}

function renderStoreSelect() {
  storeSelect.innerHTML = stores
    .map((store) => `<option value="${store.id}">${store.brandName} / ${store.name}</option>`)
    .join('');
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

function syncSecondaryLanguageRequired() {
  secondaryLanguageInput.required = labelLanguageSelect.value === 'bilingual';
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
    primaryLanguage: document.getElementById('product-primary-language').value.trim(),
    secondaryLanguage: document.getElementById('product-secondary-language').value.trim()
  };

  try {
    await window.AdminCommon.requestJson('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    productForm.reset();
    document.getElementById('product-primary-language').value = 'en';
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
    printerName: document.getElementById('printer-name').value.trim(),
    printerModel: document.getElementById('printer-model').value.trim(),
    printerAddress: document.getElementById('printer-address').value.trim(),
    printerPort: Number(document.getElementById('printer-port').value) || null,
    printerDpi: Number(document.getElementById('printer-dpi').value) || null,
    labelWidthMm: Number(document.getElementById('label-width-mm').value) || null
  };

  try {
    await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/printer-settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    window.AdminCommon.setPageMessage('Printer settings updated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

labelLanguageSelect.addEventListener('change', syncSecondaryLanguageRequired);

window.AdminCommon.bindLogout();
syncSecondaryLanguageRequired();
loadAll().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
