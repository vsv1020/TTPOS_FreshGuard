const sessionEl = document.getElementById('session-json');
const usersEl = document.getElementById('users-json');
const statsBox = document.getElementById('stats-box');

async function loadDashboard() {
  try {
    const [me, users, brands, stores, products] = await Promise.all([
      window.AdminCommon.requestJson('/api/admin/me'),
      window.AdminCommon.requestJson('/api/admin/users'),
      window.AdminCommon.requestJson('/api/admin/brands'),
      window.AdminCommon.requestJson('/api/admin/stores'),
      window.AdminCommon.requestJson('/api/admin/products')
    ]);

    if (!me || !users || !brands || !stores || !products) {
      return;
    }

    sessionEl.textContent = window.AdminCommon.pretty(me);
    usersEl.textContent = window.AdminCommon.pretty(users);
    statsBox.innerHTML = `
      <div><strong>Brands:</strong> ${brands.brands.length}</div>
      <div><strong>Stores:</strong> ${stores.stores.length}</div>
      <div><strong>Products:</strong> ${products.products.length}</div>
    `;
  } catch (error) {
    sessionEl.textContent = `Error: ${error.message}`;
    usersEl.textContent = `Error: ${error.message}`;
    statsBox.textContent = `Error: ${error.message}`;
  }
}

window.AdminCommon.bindLogout();
loadDashboard();
