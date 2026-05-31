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

  // ── Ranking Bar Chart ──────────────────────────────────────────────────────

  function renderRanking(ranking) {
    const labels = ranking.map(function (r) { return esc(r.storeName); });
    const data   = ranking.map(function (r) { return Number(r.count); });

    new Chart(document.getElementById('chart-ranking'), {
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

    new Chart(document.getElementById('chart-loss'), {
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

    new Chart(document.getElementById('chart-score'), {
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

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async function loadDashboard() {
    applyDefaults();

    const [summaryRes, rankingRes, lossRes, scoreRes] = await Promise.all([
      req('/api/admin/dashboard/summary'),
      req('/api/admin/dashboard/ranking'),
      req('/api/admin/dashboard/loss-trend'),
      req('/api/admin/dashboard/score-trend')
    ]);

    if (!summaryRes || !rankingRes || !lossRes || !scoreRes) {
      return; // auth redirect handled by requestJson
    }

    renderKpi(summaryRes.summary);
    renderRanking(rankingRes.ranking);
    renderLossTrend(lossRes.trend);
    renderScoreTrend(scoreRes.trend);
  }

  window.AdminCommon.bindLogout();
  loadDashboard().catch(function (err) {
    console.error('Dashboard load error:', err);
  });
})();
