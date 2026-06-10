(function () {
  const esc = window.AdminCommon.esc;
  const req = window.AdminCommon.requestJson;

  // ── KPI Cards ──────────────────────────────────────────────────────────────

  function renderKpi(summary) {
    document.getElementById('kpi-today').textContent = esc(summary.todayExpiringCount);
    document.getElementById('kpi-unhandled').textContent = esc(summary.unhandledExpiredCount);

    const ratePct = Math.round((summary.handledRate || 0) * 100);
    document.getElementById('kpi-rate').textContent = esc(ratePct) + '%';

    document.getElementById('kpi-stores').textContent = esc(summary.stores);

    // Color coding
    const unhandledCard = document.getElementById('kpi-card-unhandled');
    unhandledCard.classList.toggle('danger', summary.unhandledExpiredCount > 0);

    const rateCard = document.getElementById('kpi-card-rate');
    rateCard.classList.remove('good', 'warn', 'danger');
    if (ratePct >= 80) {
      rateCard.classList.add('good');
    } else if (ratePct >= 50) {
      rateCard.classList.add('warn');
    } else {
      rateCard.classList.add('danger');
    }
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────

  const CHART_DEFAULTS = {
    font: { family: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", size: 12 },
    color: '#334155'
  };

  function applyDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = CHART_DEFAULTS.font.family;
    Chart.defaults.font.size = CHART_DEFAULTS.font.size;
    Chart.defaults.color = CHART_DEFAULTS.color;
  }

  // P2-5: charts are recreated on every filter refresh, so keep instances
  // around and destroy the previous one before drawing.
  const charts = {};

  function makeChart(canvasId, config) {
    if (charts[canvasId]) {
      charts[canvasId].destroy();
    }
    charts[canvasId] = new Chart(document.getElementById(canvasId), config);
  }

  // ── Ranking Bar Chart ──────────────────────────────────────────────────────

  function renderRanking(ranking) {
    const labels = ranking.map(function (r) { return esc(r.storeName); });
    const data   = ranking.map(function (r) { return Number(r.count); });

    makeChart('chart-ranking', {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '未处置到期品',
          data: data,
          backgroundColor: 'rgba(185, 28, 28, 0.75)',
          borderColor: 'rgba(185, 28, 28, 1)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { maxRotation: 35, minRotation: 0 },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  }

  // ── Loss Trend Line Chart ──────────────────────────────────────────────────

  function renderLossTrend(trend) {
    const labels  = trend.map(function (r) { return esc(r.date); });
    const expired = trend.map(function (r) { return Number(r.expired); });
    const handled = trend.map(function (r) { return Number(r.handled); });

    makeChart('chart-loss', {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '已过期',
            data: expired,
            borderColor: 'rgba(185, 28, 28, 0.9)',
            backgroundColor: 'rgba(185, 28, 28, 0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: '已处置',
            data: handled,
            borderColor: 'rgba(21, 128, 61, 0.9)',
            backgroundColor: 'rgba(21, 128, 61, 0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 10, maxRotation: 35 },
            grid: { color: 'rgba(0,0,0,0.04)' }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  }

  // ── Score Trend Line Chart ─────────────────────────────────────────────────

  function renderScoreTrend(trend) {
    const labels = trend.map(function (r) { return esc(r.date); });
    const scores = trend.map(function (r) {
      return r.avgScore != null ? Math.round(Number(r.avgScore) * 10) / 10 : null;
    });

    makeChart('chart-score', {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '平均分 (%)',
          data: scores,
          borderColor: 'rgba(37, 99, 235, 0.9)',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 10, maxRotation: 35 },
            grid: { color: 'rgba(0,0,0,0.04)' }
          },
          y: {
            beginAtZero: false,
            min: 0,
            max: 100,
            ticks: {
              callback: function (v) { return v + '%'; }
            }
          }
        }
      }
    });
  }

  // ── P2-5: Filters (date range + brand/store drill-down) ───────────────────

  const fromInput = document.getElementById('dash-from');
  const toInput = document.getElementById('dash-to');
  const brandSelect = document.getElementById('dash-brand');
  const storeSelect = document.getElementById('dash-store');
  const refreshBtn = document.getElementById('dash-refresh');

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

  function renderStoreOptions() {
    const brandId = brandSelect.value;
    const filtered = brandId
      ? stores.filter(function (store) { return String(store.brandId) === brandId; })
      : stores;
    storeSelect.innerHTML =
      '<option value="">All stores</option>' +
      filtered
        .map(function (store) {
          return `<option value="${esc(store.id)}">${esc(store.brandName)} / ${esc(store.name)}</option>`;
        })
        .join('');
  }

  async function loadFilters() {
    const [brandRes, storeRes] = await Promise.all([
      req('/api/admin/brands'),
      req('/api/admin/stores')
    ]);
    if (!brandRes || !storeRes) {
      return;
    }
    stores = storeRes.stores;
    brandSelect.innerHTML =
      '<option value="">All brands</option>' +
      brandRes.brands
        .map(function (brand) { return `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`; })
        .join('');
    renderStoreOptions();
  }

  function filterQuery({ includeStore = true } = {}) {
    const params = new URLSearchParams();
    if (fromInput.value) params.set('from', fromInput.value);
    if (toInput.value) params.set('to', toInput.value);
    if (brandSelect.value) params.set('brandId', brandSelect.value);
    if (includeStore && storeSelect.value) params.set('storeId', storeSelect.value);
    return params.toString();
  }

  // ── P2-5: Store Ranking table ──────────────────────────────────────────────

  const rankingTableBody = document.getElementById('store-ranking-table');
  const rankingHead = document.getElementById('ranking-head');
  const rankingSort = { key: 'wasteRate', dir: 'desc' };
  let rankingItems = [];

  function renderStoreRankingTable() {
    const fp = window.AdminCommon.formatPercent;
    const rows = window.AdminCommon.prepareStoreRanking(rankingItems, rankingSort);

    rankingHead.querySelectorAll('th.sortable').forEach(function (th) {
      const base = th.textContent.replace(/ [▲▼]$/, '');
      th.textContent =
        th.dataset.key === rankingSort.key
          ? base + (rankingSort.dir === 'asc' ? ' ▲' : ' ▼')
          : base;
    });

    if (rows.length === 0) {
      rankingTableBody.innerHTML = '<tr><td colspan="6">No data in this range.</td></tr>';
      return;
    }

    rankingTableBody.innerHTML = rows
      .map(function (r) {
        return `<tr>
        <td>${esc(r.storeName)}</td>
        <td class="${r.flags.handleRate ? 'bad' : ''}">${fp(r.handleRate)}</td>
        <td class="${r.flags.wasteRate ? 'bad' : ''}">${fp(r.wasteRate)}</td>
        <td class="${r.flags.avgInspectionScore ? 'bad' : ''}">${r.avgInspectionScore != null ? esc(r.avgInspectionScore.toFixed(1)) : '-'}</td>
        <td class="${r.flags.openIssues ? 'bad' : ''}">${esc(r.openIssues)}</td>
        <td class="${r.flags.overdueIssues ? 'bad' : ''}">${esc(r.overdueIssues)}</td>
      </tr>`;
      })
      .join('');
  }

  rankingHead.addEventListener('click', function (event) {
    const th = event.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.key;
    if (rankingSort.key === key) {
      rankingSort.dir = rankingSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      rankingSort.key = key;
      rankingSort.dir = key === 'storeName' ? 'asc' : 'desc';
    }
    renderStoreRankingTable();
  });

  // store-ranking 按契约只接受 from/to/brandId（brand admin 自动收窄）。
  // 单独捕获错误，后端尚未部署该端点时不影响其余图表。
  async function loadStoreRanking() {
    try {
      const res = await req(`/api/admin/dashboard/store-ranking?${filterQuery({ includeStore: false })}`);
      if (!res) return;
      rankingItems = Array.isArray(res.items) ? res.items : [];
      renderStoreRankingTable();
    } catch (err) {
      rankingItems = [];
      rankingTableBody.innerHTML = `<tr><td colspan="6">门店排名加载失败：${esc(err.message)}</td></tr>`;
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async function loadDashboard() {
    applyDefaults();

    const qs = filterQuery();
    const [summaryRes, rankingRes, lossRes, scoreRes] = await Promise.all([
      req(`/api/admin/dashboard/summary?${qs}`),
      req(`/api/admin/dashboard/ranking?${qs}`),
      req(`/api/admin/dashboard/loss-trend?${qs}`),
      req(`/api/admin/dashboard/score-trend?${qs}`)
    ]);

    if (!summaryRes || !rankingRes || !lossRes || !scoreRes) {
      return; // auth redirect handled by requestJson
    }

    renderKpi(summaryRes.summary);
    renderRanking(rankingRes.ranking);
    renderLossTrend(lossRes.trend);
    renderScoreTrend(scoreRes.trend);
  }

  function refreshAll() {
    loadDashboard().catch(function (err) {
      console.error('Dashboard load error:', err);
    });
    loadStoreRanking();
  }

  brandSelect.addEventListener('change', function () {
    renderStoreOptions();
    refreshAll();
  });
  storeSelect.addEventListener('change', refreshAll);
  refreshBtn.addEventListener('click', refreshAll);

  window.AdminCommon.bindLogout();
  setDefaultRange();
  loadFilters()
    .then(refreshAll)
    .catch(function (err) {
      console.error('Dashboard load error:', err);
    });
})();
