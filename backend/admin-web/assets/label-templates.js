(function () {
  const { requestJson, setPageMessage, esc, bindLogout, createListControls, unwrapList } = window.AdminCommon;

  const templateForm = document.getElementById('template-form');
  const brandSelect = document.getElementById('template-brand');
  const tableBody = document.getElementById('template-table');
  const previewBtn = document.getElementById('preview-btn');
  const previewOutput = document.getElementById('preview-output');

  const editModal = document.getElementById('edit-modal');
  const editForm = document.getElementById('edit-template-form');
  const editCancelBtn = document.getElementById('edit-cancel-btn');

  let selectedId = null;
  let currentTemplates = [];

  const templateListControls = createListControls({
    container: 'templates-controls',
    searchPlaceholder: 'Search templates (name / brand)...',
    onChange: () => loadTemplates().catch((err) => setPageMessage(err.message, true))
  });

  // Sample fields used for live preview
  const SAMPLE_FIELDS = {
    product_name: 'Sample Product',
    expires_at: '2026-06-10T12:00:00.000Z',
    printed_at: '2026-06-01T12:00:00.000Z',
    batch_id: 123,
    store_name: 'Sample Store',
    barcode: 'FG-1-1-123',
    allergens: 'milk, nuts',
    storage: 'keep refrigerated',
    opened: ''
  };

  function numOrUndef(raw) {
    const v = String(raw || '').trim();
    return v ? Number(v) : undefined;
  }

  // ── Data loading ──────────────────────────────────────────────────

  async function loadBrands() {
    const data = await requestJson('/api/admin/brands');
    if (!data) return;
    brandSelect.innerHTML = (data.brands || [])
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`)
      .join('');
  }

  async function loadTemplates() {
    const data = await requestJson(`/api/admin/label-templates?${templateListControls.queryString()}`);
    if (!data) return;
    const { items, total } = unwrapList(data, 'templates');
    currentTemplates = items;
    templateListControls.update({ total, count: items.length });
    const rows = items
      .map(
        (t) => `<tr data-id="${esc(t.id)}">
          <td>${esc(t.id)}</td>
          <td>${esc(t.brandName || t.brandId)}</td>
          <td>${esc(t.name)}</td>
          <td>${esc(t.widthMm)}x${esc(t.heightMm)}</td>
          <td>${esc(t.dpi)}</td>
          <td>${t.isDefault ? 'yes' : 'no'}</td>
          <td style="white-space:nowrap;">
            <button type="button" data-action="select" data-id="${esc(t.id)}" style="background:#0369a1;padding:6px 10px;font-size:0.82rem;">Select</button>
            <button type="button" data-action="edit" data-id="${esc(t.id)}" style="background:#0369a1;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Edit</button>
            <button type="button" data-action="set-default" data-id="${esc(t.id)}" style="background:#0f766e;padding:6px 10px;font-size:0.82rem;margin-left:4px;"${t.isDefault ? ' disabled' : ''}>Set Default</button>
            <button type="button" data-action="delete" data-id="${esc(t.id)}" style="background:#b91c1c;padding:6px 10px;font-size:0.82rem;margin-left:4px;">Delete</button>
          </td>
        </tr>`
      )
      .join('');
    tableBody.innerHTML = rows || '<tr><td colspan="7" style="color:#64748b;">No templates yet.</td></tr>';
  }

  // ── Create ────────────────────────────────────────────────────────

  templateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setPageMessage('');
    try {
      await requestJson('/api/admin/label-templates', {
        method: 'POST',
        body: JSON.stringify({
          brandId: Number(brandSelect.value),
          name: document.getElementById('template-name').value.trim(),
          widthMm: numOrUndef(document.getElementById('template-width').value),
          heightMm: numOrUndef(document.getElementById('template-height').value),
          dpi: numOrUndef(document.getElementById('template-dpi').value),
          bodyTemplate: document.getElementById('template-body').value,
          isDefault: document.getElementById('template-default').checked
        })
      });
      templateForm.reset();
      setPageMessage('Template created.');
      await loadTemplates();
    } catch (err) {
      setPageMessage(err.message, true);
    }
  });

  // ── Edit modal ────────────────────────────────────────────────────

  function openEditModal(t) {
    document.getElementById('edit-template-id').value = t.id;
    document.getElementById('edit-template-name').value = t.name || '';
    document.getElementById('edit-template-width').value = t.widthMm ?? '';
    document.getElementById('edit-template-height').value = t.heightMm ?? '';
    document.getElementById('edit-template-dpi').value = t.dpi ?? '';
    document.getElementById('edit-template-body').value = t.bodyTemplate || '';
    document.getElementById('edit-template-default').checked = Boolean(t.isDefault);
    editModal.style.display = 'flex';
  }

  function closeEditModal() {
    editModal.style.display = 'none';
    editForm.reset();
  }

  editCancelBtn.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setPageMessage('');
    const id = document.getElementById('edit-template-id').value;
    try {
      await requestJson(`/api/admin/label-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: document.getElementById('edit-template-name').value.trim(),
          widthMm: numOrUndef(document.getElementById('edit-template-width').value),
          heightMm: numOrUndef(document.getElementById('edit-template-height').value),
          dpi: numOrUndef(document.getElementById('edit-template-dpi').value),
          bodyTemplate: document.getElementById('edit-template-body').value,
          isDefault: document.getElementById('edit-template-default').checked
        })
      });
      closeEditModal();
      setPageMessage('Template updated.');
      await loadTemplates();
    } catch (err) {
      setPageMessage(err.message, true);
    }
  });

  // ── Table actions ─────────────────────────────────────────────────

  tableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;
    setPageMessage('');

    if (action === 'select') {
      selectedId = id;
      previewBtn.disabled = false;
      // Highlight selected row
      tableBody.querySelectorAll('tr').forEach((r) => r.removeAttribute('style'));
      btn.closest('tr').style.background = '#f0f9ff';
      setPageMessage(`Template ${id} selected for preview.`);
      return;
    }

    if (action === 'edit') {
      const t = currentTemplates.find((x) => String(x.id) === String(id));
      if (t) openEditModal(t);
      return;
    }

    if (action === 'set-default') {
      try {
        await requestJson(`/api/admin/label-templates/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isDefault: true })
        });
        setPageMessage(`Template ${id} set as default.`);
        await loadTemplates();
      } catch (err) {
        setPageMessage(err.message, true);
      }
      return;
    }

    if (action === 'delete') {
      if (!confirm('Delete this template? This cannot be undone.')) return;
      try {
        await requestJson(`/api/admin/label-templates/${id}`, { method: 'DELETE' });
        if (selectedId === id) {
          selectedId = null;
          previewBtn.disabled = true;
          previewOutput.textContent = '';
        }
        setPageMessage('Template deleted.');
        await loadTemplates();
      } catch (err) {
        setPageMessage(err.message, true);
      }
    }
  });

  // ── Preview ───────────────────────────────────────────────────────

  previewBtn.addEventListener('click', async () => {
    if (!selectedId) return;
    setPageMessage('');
    try {
      const data = await requestJson(`/api/admin/label-templates/${selectedId}/preview`, {
        method: 'POST',
        body: JSON.stringify({ fields: SAMPLE_FIELDS })
      });
      previewOutput.textContent = data ? (data.text || '') : '';
    } catch (err) {
      setPageMessage(err.message, true);
    }
  });

  // ── Init ──────────────────────────────────────────────────────────

  bindLogout();
  Promise.all([loadBrands(), loadTemplates()]).catch((err) => setPageMessage(err.message, true));
})();
