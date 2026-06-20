const { requestJson, setPageMessage, esc, unwrapList, getSession, resolveRoleFlags } = window.AdminCommon;
const t = (key) => window.AdminI18n.t(key);

const brandPanel = document.getElementById('erp-brand-panel');
const brandSelect = document.getElementById('erp-brand-select');

const connectionForm = document.getElementById('erp-connection-form');
const baseUrlInput = document.getElementById('erp-base-url');
const apiKeyInput = document.getElementById('erp-api-key');
const apiSecretInput = document.getElementById('erp-api-secret');
const labelLangSelect = document.getElementById('erp-label-lang');
const primaryLangSelect = document.getElementById('erp-primary-lang');
const secondaryLangSelect = document.getElementById('erp-secondary-lang');
const testBtn = document.getElementById('erp-test-btn');
const testResult = document.getElementById('erp-test-result');

const loadCategoriesBtn = document.getElementById('erp-load-categories-btn');
const categoryList = document.getElementById('erp-category-list');
const saveSelectionBtn = document.getElementById('erp-save-selection-btn');

const previewBtn = document.getElementById('erp-preview-btn');
const previewCounts = document.getElementById('erp-preview-counts');
const previewRows = document.getElementById('erp-preview-rows');
const previewSublist = document.getElementById('erp-preview-sublist');

const syncBtn = document.getElementById('erp-sync-btn');
const statusBox = document.getElementById('erp-status');

const session = getSession();
const flags = resolveRoleFlags(session && session.role);

let brands = [];
let brandId = null;
let selectedCategories = new Set();

function base() {
  return `/api/admin/erp/${encodeURIComponent(brandId)}`;
}

function setTestResult(message, kind) {
  testResult.textContent = message || '';
  testResult.classList.toggle('ok', kind === 'ok');
  testResult.classList.toggle('error', kind === 'error');
}

async function loadConfig() {
  const res = await requestJson(base());
  const cfg = res && res.connection;
  if (!cfg) {
    return;
  }
  baseUrlInput.value = cfg.baseUrl || '';
  apiKeyInput.value = cfg.apiKey || '';
  apiSecretInput.value = '';
  apiSecretInput.placeholder = cfg.has_secret ? t('erp.configured') : '';
  if (cfg.defaultLabelLanguage) {
    labelLangSelect.value = cfg.defaultLabelLanguage;
  }
  if (cfg.defaultPrimaryLanguage) {
    primaryLangSelect.value = cfg.defaultPrimaryLanguage;
  }
  secondaryLangSelect.value = cfg.defaultSecondaryLanguage || '';
}

async function loadStatus() {
  const res = await requestJson(`${base()}/status`);
  const status = res && res.status;
  if (!status) {
    return;
  }
  const isOk = status.lastSyncStatus === 'success' || status.lastSyncStatus === 'ok';
  const badgeClass = isOk ? 'ok' : 'error';
  const badgeText = isOk ? t('erp.statusOk') : t('erp.statusError');
  statusBox.innerHTML = `
    <div><strong>${esc(t('erp.lastSync'))}:</strong> ${esc(status.lastSyncAt || '-')}</div>
    <div>${status.lastSyncStatus ? `<span class="status-badge ${badgeClass}">${esc(badgeText)}</span>` : '-'}</div>
    <div>${esc(status.lastSyncDetail || '')}</div>
  `;
}

function renderCategories(itemGroups) {
  categoryList.innerHTML = itemGroups
    .map((group) => {
      const isGroup = Boolean(group.is_group);
      const checked = selectedCategories.has(group.name) ? 'checked' : '';
      const disabled = isGroup ? 'disabled' : '';
      return `<label class="${isGroup ? 'is-group' : ''}">
        <input type="checkbox" value="${esc(group.name)}" ${checked} ${disabled} />
        ${esc(group.name)}${group.parent_item_group ? ` <small>(${esc(group.parent_item_group)})</small>` : ''}
      </label>`;
    })
    .join('');
}

async function loadCategorySelection() {
  const res = await requestJson(`${base()}/categories`);
  if (!res) {
    return;
  }
  const selections = Array.isArray(res.selections) ? res.selections : [];
  selectedCategories = new Set(selections.filter((s) => s.enabled).map((s) => s.itemGroup));
}

async function loadAndRenderCategories() {
  setPageMessage('');
  try {
    await loadCategorySelection();
    const res = await requestJson(`${base()}/item-groups`);
    if (!res) {
      return;
    }
    const { items } = unwrapList(res, 'itemGroups');
    renderCategories(items);
  } catch (error) {
    setPageMessage(error.message, true);
  }
}

function renderPreview(result) {
  previewCounts.innerHTML = `
    <div class="erp-count"><span class="label">${esc(t('erp.willInsert'))}</span><span class="value">${esc(result.willInsert || 0)}</span></div>
    <div class="erp-count"><span class="label">${esc(t('erp.willUpdate'))}</span><span class="value">${esc(result.willUpdate || 0)}</span></div>
    <div class="erp-count"><span class="label">${esc(t('erp.willDeactivate'))}</span><span class="value">${esc(result.willDeactivate || 0)}</span></div>
  `;

  const rows = Array.isArray(result.rows) ? result.rows : [];
  previewRows.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.externalRef)}</td>
        <td>${esc(row.name)}</td>
        <td>${esc(row.action)}</td>
      </tr>`
    )
    .join('');

  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const parts = [];
  if (conflicts.length) {
    parts.push(`<li><strong>${esc(t('erp.conflicts'))}:</strong></li>`);
    conflicts.forEach((c) => parts.push(`<li>${esc(typeof c === 'string' ? c : JSON.stringify(c))}</li>`));
  }
  if (skipped.length) {
    parts.push(`<li><strong>${esc(t('erp.skipped'))}:</strong></li>`);
    skipped.forEach((s) => parts.push(`<li>${esc(typeof s === 'string' ? s : JSON.stringify(s))}</li>`));
  }
  previewSublist.innerHTML = parts.join('');
}

connectionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setPageMessage('');
  const payload = {
    baseUrl: baseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    defaultLabelLanguage: labelLangSelect.value,
    defaultPrimaryLanguage: primaryLangSelect.value,
    defaultSecondaryLanguage: secondaryLangSelect.value || null
  };
  if (apiSecretInput.value) {
    payload.apiSecret = apiSecretInput.value;
  }
  try {
    await requestJson(base(), { method: 'PUT', body: JSON.stringify(payload) });
    await loadConfig();
    setPageMessage(t('common.save'));
  } catch (error) {
    setPageMessage(error.message, true);
  }
});

testBtn.addEventListener('click', async () => {
  setTestResult('', null);
  try {
    await requestJson(`${base()}/test`, { method: 'POST' });
    setTestResult(t('erp.testOk'), 'ok');
  } catch (error) {
    setTestResult(`${t('erp.testFailed')}: ${error.message}`, 'error');
  }
});

loadCategoriesBtn.addEventListener('click', loadAndRenderCategories);

saveSelectionBtn.addEventListener('click', async () => {
  setPageMessage('');
  const names = [...categoryList.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
  try {
    await requestJson(`${base()}/categories`, {
      method: 'PUT',
      body: JSON.stringify({ itemGroups: names })
    });
    selectedCategories = new Set(names);
    setPageMessage(t('common.save'));
  } catch (error) {
    setPageMessage(error.message, true);
  }
});

previewBtn.addEventListener('click', async () => {
  setPageMessage('');
  try {
    const res = await requestJson(`${base()}/preview`, { method: 'POST' });
    if (res && res.preview) {
      renderPreview(res.preview);
    }
  } catch (error) {
    setPageMessage(error.message, true);
  }
});

syncBtn.addEventListener('click', async () => {
  setPageMessage('');
  try {
    const res = await fetch(`${base()}/sync`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.status === 401 || res.status === 403) {
      window.location.href = '/admin/login';
      return;
    }
    if (res.status === 409) {
      setPageMessage(t('erp.syncRunning'), true);
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    const result = body.result || {};
    const errors = Array.isArray(result.errors) ? result.errors : [];
    setPageMessage(
      `${t('erp.willInsert')}: ${result.inserted || 0}, ${t('erp.willUpdate')}: ${result.updated || 0}, ${t('erp.willDeactivate')}: ${result.deactivated || 0}, ${errors.length} error(s).`,
      errors.length > 0
    );
    await loadStatus();
  } catch (error) {
    setPageMessage(error.message, true);
  }
});

async function loadAll() {
  await loadConfig();
  await loadStatus();
}

async function init() {
  if (flags.isPlatformAdmin) {
    brandPanel.hidden = false;
    const brandRes = await requestJson('/api/admin/brands');
    if (!brandRes) {
      return;
    }
    brands = brandRes.brands || [];
    brandSelect.innerHTML = brands
      .map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`)
      .join('');
    if (brands.length) {
      brandId = brands[0].id;
      brandSelect.value = String(brandId);
      brandSelect.addEventListener('change', () => {
        brandId = brandSelect.value;
        categoryList.innerHTML = '';
        loadAll().catch((error) => setPageMessage(error.message, true));
      });
      await loadAll();
    }
  } else {
    brandId = session && session.brandId;
    await loadAll();
  }
}

window.AdminCommon.bindLogout();
init().catch((error) => setPageMessage(error.message, true));
