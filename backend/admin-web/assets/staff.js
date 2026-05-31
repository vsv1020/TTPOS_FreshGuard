const storeSelect = document.getElementById('store-select');
const staffForm = document.getElementById('staff-form');
const staffTable = document.getElementById('staff-table');

const editModal = document.getElementById('edit-modal');
const editStaffForm = document.getElementById('edit-staff-form');
const editCancelBtn = document.getElementById('edit-cancel-btn');

function renderStoreSelect(stores) {
  const esc = window.AdminCommon.esc;
  storeSelect.innerHTML = stores
    .map((s) => `<option value="${esc(s.id)}">${esc(s.brandName)} / ${esc(s.name)}</option>`)
    .join('');
}

function renderStaff(staffList) {
  const esc = window.AdminCommon.esc;
  staffTable.innerHTML = staffList
    .map(
      (st) => `<tr>
      <td>${esc(st.id)}</td>
      <td>${esc(st.name)}</td>
      <td>${esc(st.role)}</td>
      <td>${st.isActive ? 'yes' : 'no'}</td>
      <td style="white-space:nowrap;">
        <button type="button" data-action="edit" data-id="${esc(st.id)}" style="background:#0369a1;padding:6px 10px;font-size:0.82rem;">Edit</button>
        ${st.isActive
          ? `<button type="button" data-action="deactivate" data-id="${esc(st.id)}" style="background:#b91c1c;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Deactivate</button>`
          : `<button type="button" data-action="reactivate" data-id="${esc(st.id)}" style="background:#15803d;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Reactivate</button>`
        }
      </td>
    </tr>`
    )
    .join('');
}

function openEditModal(staff) {
  document.getElementById('edit-staff-id').value = staff.id;
  document.getElementById('edit-staff-name').value = staff.name || '';
  document.getElementById('edit-staff-pin').value = '';
  document.getElementById('edit-staff-role').value = staff.role || 'staff';
  document.getElementById('edit-staff-active').checked = Boolean(staff.isActive);
  editModal.style.display = 'flex';
}

function closeEditModal() {
  editModal.style.display = 'none';
  editStaffForm.reset();
}

async function loadStaff() {
  const storeId = storeSelect.value;
  if (!storeId) return;
  const data = await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/staff`);
  if (!data) return;
  renderStaff(data.staff || []);
}

async function loadStores() {
  const data = await window.AdminCommon.requestJson('/api/admin/stores');
  if (!data) return;
  renderStoreSelect(data.stores || []);
  if ((data.stores || []).length) {
    await loadStaff();
  }
}

staffForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');
  const storeId = storeSelect.value;
  try {
    await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/staff`, {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('staff-name').value.trim(),
        pin: document.getElementById('staff-pin').value,
        role: document.getElementById('staff-role').value
      })
    });
    staffForm.reset();
    await loadStaff();
    window.AdminCommon.setPageMessage('Staff added.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

editStaffForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.AdminCommon.setPageMessage('');
  const storeId = storeSelect.value;
  const staffId = document.getElementById('edit-staff-id').value;
  const pinValue = document.getElementById('edit-staff-pin').value;

  const payload = {
    name: document.getElementById('edit-staff-name').value.trim(),
    role: document.getElementById('edit-staff-role').value,
    isActive: document.getElementById('edit-staff-active').checked
  };
  if (pinValue) {
    payload.pin = pinValue;
  }

  try {
    await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/staff/${staffId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    closeEditModal();
    await loadStaff();
    window.AdminCommon.setPageMessage('Staff updated.');
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
});

staffTable.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;

  const staffId = btn.dataset.id;
  const action = btn.dataset.action;
  const storeId = storeSelect.value;

  if (action === 'edit') {
    const data = await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/staff`);
    if (!data) return;
    const member = (data.staff || []).find((s) => String(s.id) === String(staffId));
    if (member) openEditModal(member);
    return;
  }

  if (action === 'deactivate') {
    if (!confirm('Deactivate this staff member?')) return;
    window.AdminCommon.setPageMessage('');
    try {
      await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/staff/${staffId}`, {
        method: 'DELETE'
      });
      await loadStaff();
      window.AdminCommon.setPageMessage('Staff deactivated.');
    } catch (error) {
      window.AdminCommon.setPageMessage(error.message, true);
    }
    return;
  }

  if (action === 'reactivate') {
    window.AdminCommon.setPageMessage('');
    try {
      await window.AdminCommon.requestJson(`/api/admin/stores/${storeId}/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true })
      });
      await loadStaff();
      window.AdminCommon.setPageMessage('Staff reactivated.');
    } catch (error) {
      window.AdminCommon.setPageMessage(error.message, true);
    }
  }
});

storeSelect.addEventListener('change', () =>
  loadStaff().catch((error) => window.AdminCommon.setPageMessage(error.message, true))
);

editCancelBtn.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (event) => {
  if (event.target === editModal) closeEditModal();
});

window.AdminCommon.bindLogout();
loadStores().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
