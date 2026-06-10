const adminForm = document.getElementById('admin-form');
const roleSelect = document.getElementById('admin-role');
const brandSelect = document.getElementById('admin-brand');
const adminsTable = document.getElementById('admins-table');

const editModal = document.getElementById('edit-modal');
const editAdminForm = document.getElementById('edit-admin-form');
const editRoleSelect = document.getElementById('edit-admin-role');
const editBrandSelect = document.getElementById('edit-admin-brand');
const editCancelBtn = document.getElementById('edit-cancel-btn');

let brands = [];
let currentAdmins = [];

// This page is platform_admin only; bounce known non-platform roles up front.
// The server still rejects every request from non-platform admins.
const session = window.AdminCommon.getSession();
if (session && session.role && !window.AdminCommon.resolveRoleFlags(session.role).isPlatformAdmin) {
  window.location.href = '/admin/dashboard';
}

const adminListControls = window.AdminCommon.createListControls({
  container: 'admins-controls',
  searchPlaceholder: 'Search admins (email)...',
  onChange: () => loadAdmins().catch((error) => window.AdminCommon.setPageMessage(error.message, true))
});

function brandName(brandId) {
  if (brandId == null) {
    return '-';
  }
  const brand = brands.find((b) => String(b.id) === String(brandId));
  return brand ? brand.name : `#${brandId}`;
}

function renderBrandSelects() {
  const esc = window.AdminCommon.esc;
  const options =
    '<option value="">No brand (platform-wide)</option>' +
    brands.map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`).join('');
  brandSelect.innerHTML = options;
  editBrandSelect.innerHTML = options;
}

function syncBrandRequired() {
  brandSelect.required = roleSelect.value === 'brand_admin';
}

function syncEditBrandRequired() {
  editBrandSelect.required = editRoleSelect.value === 'brand_admin';
}

function renderAdmins(admins) {
  const esc = window.AdminCommon.esc;
  adminsTable.innerHTML = admins
    .map(
      (admin) => `<tr>
      <td>${esc(admin.id)}</td>
      <td>${esc(admin.email)}</td>
      <td>${esc(admin.role)}</td>
      <td>${esc(brandName(admin.brandId))}</td>
      <td>${admin.disabled ? 'disabled' : 'active'}</td>
      <td style="white-space:nowrap;">
        <button type="button" data-action="edit" data-id="${esc(admin.id)}" style="background:#0369a1;padding:6px 10px;font-size:0.82rem;">Edit</button>
        <button type="button" data-action="reset-password" data-id="${esc(admin.id)}" style="background:#0f766e;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Reset Password</button>
        ${admin.disabled
          ? `<button type="button" data-action="enable" data-id="${esc(admin.id)}" style="background:#15803d;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Enable</button>`
          : `<button type="button" data-action="disable" data-id="${esc(admin.id)}" style="background:#b91c1c;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Disable</button>`
        }
      </td>
    </tr>`
    )
    .join('');
}

function openEditModal(admin) {
  document.getElementById('edit-admin-id').value = admin.id;
  document.getElementById('edit-admin-email').textContent = admin.email || '';
  editRoleSelect.value = admin.role || 'viewer';
  editBrandSelect.value = admin.brandId != null ? String(admin.brandId) : '';
  document.getElementById('edit-admin-disabled').checked = Boolean(admin.disabled);
  syncEditBrandRequired();
  editModal.style.display = 'flex';
}

function closeEditModal() {
  editModal.style.display = 'none';
  editAdminForm.reset();
}

async function loadAdmins() {
  const res = await window.AdminCommon.requestJson(`/api/admin/admins?${adminListControls.queryString()}`);
  if (!res) {
    return;
  }
  const { items, total } = window.AdminCommon.unwrapList(res, 'admins');
  currentAdmins = items;
  renderAdmins(items);
  adminListControls.update({ total, count: items.length });
}

async function loadAll() {
  const brandRes = await window.AdminCommon.requestJson('/api/admin/brands');
  if (!brandRes) {
    return;
  }
  brands = brandRes.brands || [];
  renderBrandSelects();
  await loadAdmins();
}

adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const payload = {
    email: document.getElementById('admin-email').value.trim(),
    password: document.getElementById('admin-password').value,
    role: roleSelect.value
  };
  if (brandSelect.value) {
    payload.brandId = Number(brandSelect.value);
  }

  try {
    await window.AdminCommon.requestJson('/api/admin/admins', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    adminForm.reset();
    syncBrandRequired();
    adminListControls.resetOffset();
    await loadAdmins();
    window.AdminCommon.setPageMessage('Admin created.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

editAdminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');

  const id = document.getElementById('edit-admin-id').value;
  const payload = {
    role: editRoleSelect.value,
    brandId: editBrandSelect.value ? Number(editBrandSelect.value) : null,
    disabled: document.getElementById('edit-admin-disabled').checked
  };

  try {
    await window.AdminCommon.requestJson(`/api/admin/admins/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    closeEditModal();
    await loadAdmins();
    window.AdminCommon.setPageMessage('Admin updated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

adminsTable.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) {
    return;
  }

  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const admin = currentAdmins.find((a) => String(a.id) === String(id));

  if (action === 'edit') {
    if (admin) {
      openEditModal(admin);
    }
    return;
  }

  if (action === 'reset-password') {
    const newPassword = prompt(`New password for ${admin ? admin.email : `#${id}`}:`);
    if (!newPassword) {
      return;
    }
    window.AdminCommon.setPageMessage('');
    try {
      await window.AdminCommon.requestJson(`/api/admin/admins/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });
      window.AdminCommon.setPageMessage('Password reset.');
    } catch (error) {
      window.AdminCommon.setPageMessage(error.message, true);
    }
    return;
  }

  if (action === 'disable' || action === 'enable') {
    const disabled = action === 'disable';
    if (disabled && !confirm('Disable this admin? They will no longer be able to log in.')) {
      return;
    }
    window.AdminCommon.setPageMessage('');
    try {
      await window.AdminCommon.requestJson(`/api/admin/admins/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ disabled })
      });
      await loadAdmins();
      window.AdminCommon.setPageMessage(disabled ? 'Admin disabled.' : 'Admin enabled.');
    } catch (error) {
      window.AdminCommon.setPageMessage(error.message, true);
    }
  }
});

roleSelect.addEventListener('change', syncBrandRequired);
editRoleSelect.addEventListener('change', syncEditBrandRequired);
editCancelBtn.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (event) => {
  if (event.target === editModal) {
    closeEditModal();
  }
});

window.AdminCommon.bindLogout();
syncBrandRequired();
loadAll().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
