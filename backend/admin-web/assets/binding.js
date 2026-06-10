const brandForm = document.getElementById('brand-form');
const storeForm = document.getElementById('store-form');
const bindingForm = document.getElementById('binding-form');
const brandSelect = document.getElementById('store-brand');
const storeSelect = document.getElementById('binding-store');
const bindingTable = document.getElementById('binding-table');
const reminderConfigForm = document.getElementById('reminder-config-form');
const reminderBrandSelect = document.getElementById('reminder-config-brand');
const reminderThresholdInput = document.getElementById('reminder-threshold-days');
const reminderConfigHint = document.getElementById('reminder-config-hint');

let brands = [];
let stores = [];

const bindingListControls = window.AdminCommon.createListControls({
  container: 'binding-controls',
  searchPlaceholder: 'Search codes (code / brand / store)...',
  onChange: () => loadBindingCodes().catch((error) => window.AdminCommon.setPageMessage(error.message, true))
});

function renderBrandSelect() {
  const esc = window.AdminCommon.esc;
  const options = brands.map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`).join('');
  brandSelect.innerHTML = options;
  const previous = reminderBrandSelect.value;
  reminderBrandSelect.innerHTML = options;
  if (previous && brands.some((brand) => String(brand.id) === previous)) {
    reminderBrandSelect.value = previous;
  }
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

async function loadBindingCodes() {
  const res = await window.AdminCommon.requestJson(`/api/admin/binding-codes?${bindingListControls.queryString()}`);
  if (!res) {
    return;
  }
  const { items, total } = window.AdminCommon.unwrapList(res, 'bindingCodes');
  renderBindingTable(items);
  bindingListControls.update({ total, count: items.length });
}

async function loadReminderConfig() {
  const brandId = Number(reminderBrandSelect.value);
  if (!brandId) {
    reminderThresholdInput.value = '';
    reminderConfigHint.textContent = '';
    return;
  }

  try {
    const data = await window.AdminCommon.requestJson(`/api/admin/brands/${brandId}/reminder-config`);
    if (!data) {
      return;
    }
    const config = data.reminderConfig || data.config || data;
    reminderThresholdInput.value = config.thresholdDays != null ? config.thresholdDays : '';
    reminderConfigHint.textContent = 'Days before expiry that batches show up as expiring reminders.';
  } catch (error) {
    reminderThresholdInput.value = '';
    reminderConfigHint.textContent = `Could not load reminder config: ${error.message}`;
  }
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
  await Promise.all([loadBindingCodes(), loadReminderConfig()]);
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
    await loadBindingCodes();
    window.AdminCommon.setPageMessage('Binding code generated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

reminderConfigForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const brandId = Number(reminderBrandSelect.value);
  const thresholdDays = Number(reminderThresholdInput.value);

  try {
    await window.AdminCommon.requestJson(`/api/admin/brands/${brandId}/reminder-config`, {
      method: 'PUT',
      body: JSON.stringify({ thresholdDays })
    });
    window.AdminCommon.setPageMessage('Reminder config saved.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

reminderBrandSelect.addEventListener('change', () => {
  loadReminderConfig().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
});

window.AdminCommon.bindLogout();
loadAll().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
