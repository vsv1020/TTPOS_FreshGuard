(function bootstrapAdminCommon() {
  const SESSION_KEY = 'fgAdminUser';

  function storeSession(user) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user || {}));
    } catch (_error) {
      // Ignore storage failures; the UI fails open and the server enforces RBAC.
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  // Pure role -> UI capability mapping. Unknown/legacy roles fail open in the
  // UI (everything visible); the server still enforces RBAC with 403s.
  function resolveRoleFlags(role) {
    const isViewer = role === 'viewer';
    const isPlatformAdmin = !role || role === 'platform_admin' || role === 'admin';
    return { isViewer, isPlatformAdmin, canWrite: !isViewer };
  }

  // Unified role-aware visibility:
  // - viewer: body gets .role-viewer, which hides [data-write] containers and
  //   row action buttons (button[data-action]) via styles.css.
  // - non platform_admin: nav links marked data-nav="admins" stay hidden.
  function applyRoleVisibility(doc) {
    const target = doc || document;
    const session = getSession();
    const flags = resolveRoleFlags(session && session.role);

    if (flags.isViewer) {
      target.body.classList.add('role-viewer');
    }

    target.querySelectorAll('[data-nav="admins"]').forEach((el) => {
      el.hidden = !flags.isPlatformAdmin;
    });

    return flags;
  }

  // Pure helper for CSV import responses: { inserted, updated, errors:[{line,message}] }.
  function formatImportSummary(result) {
    const inserted = Number(result && result.inserted) || 0;
    const updated = Number(result && result.updated) || 0;
    const errors = result && Array.isArray(result.errors) ? result.errors : [];
    return {
      text: `Imported: ${inserted} inserted, ${updated} updated, ${errors.length} error(s).`,
      errorLines: errors.map((e) => `Line ${e.line}: ${e.message}`),
      hasErrors: errors.length > 0
    };
  }

  // Formats a 0..1 rate as a percentage string ("12.3%"); '-' when not a number.
  function formatPercent(rate) {
    const value = Number(rate);
    if (rate == null || rate === '' || !isFinite(value)) {
      return '-';
    }
    return `${(value * 100).toFixed(1)}%`;
  }

  // Pure view-model builder for GET /api/admin/reports/waste responses:
  // { summary, byStore, byProduct, byReason, trend }. Sorting and bar sizing
  // are computed here so they can be unit-tested without a DOM.
  function prepareWasteView(report, { topProducts = 10 } = {}) {
    const src = report || {};
    const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);

    const s = src.summary || {};
    const summary = {
      totalBatches: num(s.totalBatches),
      discardedCount: num(s.discardedCount),
      wasteRate: num(s.wasteRate),
      discardAmount: num(s.discardAmount),
      missingCostCount: num(s.missingCostCount)
    };

    // Stores ranked worst-first; rows above the overall waste rate are flagged
    // `high` (rendered red by the page).
    const byStore = (Array.isArray(src.byStore) ? [...src.byStore] : [])
      .sort((a, b) => num(b.wasteRate) - num(a.wasteRate))
      .map((row) => ({
        ...row,
        high: num(row.wasteRate) > 0 && num(row.wasteRate) > summary.wasteRate
      }));

    const byProduct = (Array.isArray(src.byProduct) ? [...src.byProduct] : [])
      .sort(
        (a, b) =>
          num(b.discardedCount) - num(a.discardedCount) ||
          num(b.discardAmount) - num(a.discardAmount)
      )
      .slice(0, topProducts);

    const reasons = Array.isArray(src.byReason) ? src.byReason : [];
    const reasonTotal = reasons.reduce((sum, r) => sum + num(r.count), 0);
    const byReason = [...reasons]
      .sort((a, b) => num(b.count) - num(a.count))
      .map((r) => ({
        reason: r.reason,
        count: num(r.count),
        pct: reasonTotal > 0 ? (num(r.count) / reasonTotal) * 100 : 0
      }));

    const trendRows = Array.isArray(src.trend) ? src.trend : [];
    const maxTrend = trendRows.reduce((max, t) => Math.max(max, num(t.discardedCount)), 0);
    const trend = trendRows.map((t) => ({
      date: t.date,
      discardedCount: num(t.discardedCount),
      discardAmount: num(t.discardAmount),
      heightPct: maxTrend > 0 ? (num(t.discardedCount) / maxTrend) * 100 : 0
    }));

    return { summary, byStore, byProduct, byReason, trend };
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (response.status === 401 || response.status === 403) {
      window.location.href = '/admin/login';
      return null;
    }

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || `Request failed (${response.status})`);
    }

    return body;
  }

  function pretty(data) {
    return JSON.stringify(data, null, 2);
  }

  function bindLogout(buttonId = 'logout-btn') {
    const button = document.getElementById(buttonId);
    if (!button) {
      return;
    }

    button.addEventListener('click', async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      clearSession();
      window.location.href = '/admin/login';
    });
  }

  function setPageMessage(message, isError = false) {
    const target = document.getElementById('page-message');
    if (!target) {
      return;
    }

    target.textContent = message || '';
    target.classList.toggle('error', Boolean(isError));
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // Parses the paginated envelope { items, total, limit, offset }.
  // Falls back to the legacy full-array response shape ({ <legacyKey>: [...] }).
  function unwrapList(data, legacyKey) {
    if (data && Array.isArray(data.items)) {
      return { items: data.items, total: Number(data.total) || data.items.length };
    }
    const items = data && Array.isArray(data[legacyKey]) ? data[legacyKey] : [];
    return { items, total: items.length };
  }

  // Reusable search box + page-size select + prev/next pager.
  // onChange is called whenever the query state changes; the caller reloads
  // its list using queryString() and then calls update({ total, count }).
  function createListControls({ container, onChange, pageSizes = [20, 50], searchPlaceholder = 'Search...', search = true }) {
    const root = typeof container === 'string' ? document.getElementById(container) : container;
    const state = { q: '', limit: pageSizes[0], offset: 0, total: 0 };

    root.classList.add('list-controls');

    let searchInput = null;
    if (search) {
      searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = searchPlaceholder;
      root.appendChild(searchInput);
    }

    const sizeSelect = document.createElement('select');
    sizeSelect.innerHTML = pageSizes.map((n) => `<option value="${n}">${n} / page</option>`).join('');
    root.appendChild(sizeSelect);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'pager-btn';
    prevBtn.textContent = 'Prev';

    const info = document.createElement('span');
    info.className = 'pager-info';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'pager-btn';
    nextBtn.textContent = 'Next';

    root.appendChild(prevBtn);
    root.appendChild(info);
    root.appendChild(nextBtn);

    let debounceTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.q = searchInput.value.trim();
          state.offset = 0;
          onChange();
        }, 300);
      });
    }

    sizeSelect.addEventListener('change', () => {
      state.limit = Number(sizeSelect.value);
      state.offset = 0;
      onChange();
    });

    prevBtn.addEventListener('click', () => {
      state.offset = Math.max(0, state.offset - state.limit);
      onChange();
    });

    nextBtn.addEventListener('click', () => {
      state.offset += state.limit;
      onChange();
    });

    function queryString(extra = {}) {
      const params = new URLSearchParams();
      params.set('limit', String(state.limit));
      params.set('offset', String(state.offset));
      if (state.q) {
        params.set('q', state.q);
      }
      Object.entries(extra).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });
      return params.toString();
    }

    function update({ total, count }) {
      state.total = Number(total) || 0;
      const start = count > 0 ? state.offset + 1 : 0;
      const end = state.offset + count;
      info.textContent = `${start}-${end} of ${state.total}`;
      prevBtn.disabled = state.offset <= 0;
      nextBtn.disabled = state.offset + state.limit >= state.total;
    }

    function resetOffset() {
      state.offset = 0;
    }

    update({ total: 0, count: 0 });

    return { state, queryString, update, resetOffset };
  }

  window.AdminCommon = {
    applyRoleVisibility,
    bindLogout,
    clearSession,
    createListControls,
    esc,
    formatImportSummary,
    formatPercent,
    getSession,
    prepareWasteView,
    pretty,
    requestJson,
    resolveRoleFlags,
    setPageMessage,
    storeSession,
    unwrapList
  };

  // Auto-apply role-aware visibility on every page that loads common.js
  // (scripts are included at the end of <body>, so the DOM is available).
  if (typeof document !== 'undefined' && document.body) {
    applyRoleVisibility(document);
  }
})();
