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

  window.AdminCommon = {
    bindLogout,
    pretty,
    requestJson,
    setPageMessage
  };
})();
