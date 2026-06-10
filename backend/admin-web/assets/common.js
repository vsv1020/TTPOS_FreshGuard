(function bootstrapAdminCommon() {
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
    bindLogout,
    createListControls,
    esc,
    pretty,
    requestJson,
    setPageMessage,
    unwrapList
  };
})();
