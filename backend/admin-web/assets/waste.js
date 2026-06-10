const fromInput = document.getElementById('waste-from');
const toInput = document.getElementById('waste-to');
const brandSelect = document.getElementById('waste-brand');
const storeSelect = document.getElementById('waste-store');
const refreshBtn = document.getElementById('waste-refresh');
const missingCostHint = document.getElementById('waste-missing-cost');
const byStoreTable = document.getElementById('waste-by-store');
const byProductTable = document.getElementById('waste-by-product');
const byReasonEl = document.getElementById('waste-by-reason');
const trendEl = document.getElementById('waste-trend');

let stores = [];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function setDefaultRange() {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  toInput.value = isoDate(now);
  fromInput.value = isoDate(from);
}

function money(value) {
  return (Number(value) || 0).toFixed(2);
}

function renderStoreOptions() {
  const esc = window.AdminCommon.esc;
  const brandId = brandSelect.value;
  const filtered = brandId
    ? stores.filter((store) => String(store.brandId) === brandId)
    : stores;
  storeSelect.innerHTML =
    '<option value="">All stores</option>' +
    filtered
      .map((store) => `<option value="${esc(store.id)}">${esc(store.brandName)} / ${esc(store.name)}</option>`)
      .join('');
}

async function loadFilters() {
  const esc = window.AdminCommon.esc;
  const [brandRes, storeRes] = await Promise.all([
    window.AdminCommon.requestJson('/api/admin/brands'),
    window.AdminCommon.requestJson('/api/admin/stores')
  ]);

  if (!brandRes || !storeRes) {
    return;
  }

  stores = storeRes.stores;
  brandSelect.innerHTML =
    '<option value="">All brands</option>' +
    brandRes.brands.map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`).join('');
  renderStoreOptions();
}

function renderSummary(summary) {
  document.getElementById('waste-total-batches').textContent = summary.totalBatches;
  document.getElementById('waste-discarded-count').textContent = summary.discardedCount;
  document.getElementById('waste-rate').textContent = window.AdminCommon.formatPercent(summary.wasteRate);
  document.getElementById('waste-discard-amount').textContent = money(summary.discardAmount);

  if (summary.missingCostCount > 0) {
    missingCostHint.hidden = false;
    missingCostHint.textContent = `${summary.missingCostCount} discarded batch(es) have no product cost_price and count as 0 in the discard amount.`;
  } else {
    missingCostHint.hidden = true;
    missingCostHint.textContent = '';
  }
}

function renderByStore(rows) {
  const esc = window.AdminCommon.esc;
  if (rows.length === 0) {
    byStoreTable.innerHTML = '<tr><td colspan="5">No data in this range.</td></tr>';
    return;
  }
  byStoreTable.innerHTML = rows
    .map(
      (row) => `<tr${row.high ? ' class="waste-high"' : ''}>
      <td>${esc(row.storeName)}</td>
      <td>${esc(row.totalBatches)}</td>
      <td>${esc(row.discardedCount)}</td>
      <td>${esc(window.AdminCommon.formatPercent(row.wasteRate))}</td>
      <td>${esc(money(row.discardAmount))}</td>
    </tr>`
    )
    .join('');
}

function renderByProduct(rows) {
  const esc = window.AdminCommon.esc;
  if (rows.length === 0) {
    byProductTable.innerHTML = '<tr><td colspan="4">No data in this range.</td></tr>';
    return;
  }
  byProductTable.innerHTML = rows
    .map(
      (row) => `<tr>
      <td>${esc(row.productName)}</td>
      <td>${esc(row.discardedCount)}</td>
      <td>${esc(window.AdminCommon.formatPercent(row.wasteRate))}</td>
      <td>${esc(money(row.discardAmount))}</td>
    </tr>`
    )
    .join('');
}

function renderByReason(rows) {
  const esc = window.AdminCommon.esc;
  if (rows.length === 0) {
    byReasonEl.innerHTML = '<p class="empty-note">No discards in this range.</p>';
    return;
  }
  byReasonEl.innerHTML = rows
    .map(
      (row) => `<div class="bar-row">
      <span class="bar-label" title="${esc(row.reason)}">${esc(row.reason || '(unspecified)')}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${row.pct.toFixed(1)}%;display:block;"></span></span>
      <span class="bar-count">${esc(row.count)}</span>
    </div>`
    )
    .join('');
}

function renderTrend(rows) {
  const esc = window.AdminCommon.esc;
  if (rows.length === 0) {
    trendEl.innerHTML = '<p class="empty-note">No discards in this range.</p>';
    return;
  }
  const bars = rows
    .map(
      (row) => `<div class="trend-col" title="${esc(row.date)}: ${esc(row.discardedCount)} discarded, amount ${esc(money(row.discardAmount))}">
      <div class="trend-bar" style="height:${Math.max(row.heightPct, 2).toFixed(1)}%;"></div>
    </div>`
    )
    .join('');
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  trendEl.innerHTML = `<div class="trend-chart">${bars}</div>
    <div class="trend-axis"><span>${esc(first)}</span><span>${esc(last)}</span></div>`;
}

async function loadReport() {
  try {
    window.AdminCommon.setPageMessage('');

    const params = new URLSearchParams();
    if (fromInput.value) {
      params.set('from', fromInput.value);
    }
    if (toInput.value) {
      params.set('to', toInput.value);
    }
    if (brandSelect.value) {
      params.set('brandId', brandSelect.value);
    }
    if (storeSelect.value) {
      params.set('storeId', storeSelect.value);
    }

    const report = await window.AdminCommon.requestJson(`/api/admin/reports/waste?${params.toString()}`);
    if (!report) {
      return;
    }

    const view = window.AdminCommon.prepareWasteView(report);
    renderSummary(view.summary);
    renderByStore(view.byStore);
    renderByProduct(view.byProduct);
    renderByReason(view.byReason);
    renderTrend(view.trend);
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
}

brandSelect.addEventListener('change', () => {
  renderStoreOptions();
  loadReport();
});
storeSelect.addEventListener('change', loadReport);
refreshBtn.addEventListener('click', loadReport);

window.AdminCommon.bindLogout();
setDefaultRange();
loadFilters()
  .then(loadReport)
  .catch((error) => window.AdminCommon.setPageMessage(error.message, true));
