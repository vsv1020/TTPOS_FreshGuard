const brandForm = document.getElementById('brand-form');
const storeForm = document.getElementById('store-form');
const bindingForm = document.getElementById('binding-form');
const brandSelect = document.getElementById('store-brand');
const storeSelect = document.getElementById('binding-store');
const bindingTable = document.getElementById('binding-table');

let brands = [];
let stores = [];

function renderBrandSelect() {
  const esc = window.AdminCommon.esc;
  brandSelect.innerHTML = brands.map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`).join('');
}

function renderStoreSelect() {
  const esc = window.AdminCommon.esc;
  storeSelect.innerHTML = stores
    .map((store) => `<option value="${esc(store.id)}">${esc(store.brandName)} / ${esc(store.name)}</option>`)
    .join('');
}

function getBindingStatus(row) {
  if (row.usedAt) {
    return 'used';
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return 'expired';
  }
  return 'active';
}

function renderBindingTable(codes) {
  const esc = window.AdminCommon.esc;
  bindingTable.innerHTML = codes
    .map(
      (row) => `<tr>
      <td>${esc(row.code)}</td>
      <td>${esc(row.brandName)}</td>
      <td>${esc(row.storeName)}</td>
      <td>${esc(row.expiresAt || '-')}</td>
      <td>${esc(getBindingStatus(row))}</td>
      <td>${esc(row.usedAt || '-')}</td>
      <td>${esc(row.boundDeviceId || '-')}</td>
    </tr>`
    )
    .join('');
}

async function loadAll() {
  const [brandRes, storeRes, codeRes] = await Promise.all([
    window.AdminCommon.requestJson('/api/admin/brands'),
    window.AdminCommon.requestJson('/api/admin/stores'),
    window.AdminCommon.requestJson('/api/admin/binding-codes')
  ]);

  brands = brandRes.brands;
  stores = storeRes.stores;

  renderBrandSelect();
  renderStoreSelect();
  renderBindingTable(codeRes.bindingCodes);
}

brandForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');
  const name = document.getElementById('brand-name').value.trim();

  try {
    await window.AdminCommon.requestJson('/api/admin/brands', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    document.getElementById('brand-name').value = '';
    await loadAll();
    window.AdminCommon.setPageMessage('Brand created.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

storeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const brandId = Number(brandSelect.value);
  const name = document.getElementById('store-name').value.trim();

  try {
    await window.AdminCommon.requestJson('/api/admin/stores', {
      method: 'POST',
      body: JSON.stringify({ brandId, name })
    });
    document.getElementById('store-name').value = '';
    await loadAll();
    window.AdminCommon.setPageMessage('Store created.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

bindingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const storeId = Number(storeSelect.value);
  const expiresInHours = Number(document.getElementById('binding-hours').value);

  try {
    await window.AdminCommon.requestJson('/api/admin/binding-codes', {
      method: 'POST',
      body: JSON.stringify({ storeId, expiresInHours })
    });
    await loadAll();
    window.AdminCommon.setPageMessage('Binding code generated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

window.AdminCommon.bindLogout();
loadAll().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
