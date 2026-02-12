const sessionEl = document.getElementById('session-json');
const usersEl = document.getElementById('users-json');
const logoutBtn = document.getElementById('logout-btn');

function pretty(data) {
  return JSON.stringify(data, null, 2);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.location.href = '/admin/login';
      return null;
    }

    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function loadDashboard() {
  try {
    const [me, users] = await Promise.all([fetchJson('/api/admin/me'), fetchJson('/api/admin/users')]);
    if (!me || !users) {
      return;
    }
    sessionEl.textContent = pretty(me);
    usersEl.textContent = pretty(users);
  } catch (error) {
    sessionEl.textContent = `Error: ${error.message}`;
    usersEl.textContent = `Error: ${error.message}`;
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include'
  });
  window.location.href = '/admin/login';
});

loadDashboard();
