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

  const previewCanvas = document.getElementById('preview-canvas');
  const previewZoom = document.getElementById('preview-zoom');
  const previewPresets = document.getElementById('preview-presets');
  const previewSourceHint = document.getElementById('preview-source-hint');
  const editPreviewCanvas = document.getElementById('edit-preview-canvas');

  let selectedId = null;
  let currentTemplates = [];
  // Visual preview follows the create form ('form') until a row is selected
  // ('template'); typing in the create form switches back to 'form'.
  let previewSource = { kind: 'form' };

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
    opened: '',
    color_code: 'red',
    color_label: '红·畜肉禽类',
    // Legacy alias: server-rendered labels also expose {{colorLabel}}.
    colorLabel: '红·畜肉禽类'
  };

  function numOrUndef(raw) {
    const v = String(raw || '').trim();
    return v ? Number(v) : undefined;
  }

  // ── Visual preview (P2-6) ─────────────────────────────────────────
  // Canvas render at 1:1 pixel size for the configured mm dimensions and DPI.
  // Layout math lives in assets/label-preview.js (window.LabelPreview).

  function drawBarcodeBars(ctx, x, y, width, height, text) {
    // Monochrome mock: deterministic bar pattern derived from the text.
    const unit = Math.max(1, Math.round(width / 120));
    const s = String(text || 'BARCODE');
    let cx = x;
    let i = 0;
    ctx.fillStyle = '#0f172a';
    while (cx < x + width - unit * 4) {
      const code = s.charCodeAt(i % s.length);
      const bar = ((code % 3) + 1) * unit;
      const gap = (((code >> 2) % 2) + 1) * unit;
      ctx.fillRect(cx, y, bar, height);
      cx += bar + gap;
      i += 1;
    }
  }

  function drawLabel(canvas, cfg) {
    const layout = window.LabelPreview.buildLayout({ ...cfg, fields: SAMPLE_FIELDS });
    const { widthPx: W, heightPx: H, marginPx: m, fontPx, lineHeightPx } = layout;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const font = `${fontPx}px ui-monospace, Menlo, monospace`;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // 2mm margin guides (dashed, reference only — not printed).
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(m + 0.5, m + 0.5, W - 2 * m - 1, H - 2 * m - 1);
    ctx.restore();

    ctx.textBaseline = 'top';
    ctx.font = font;
    let y = m + 2;
    const maxTextWidth = W - 2 * m - 4;

    for (const line of layout.lines) {
      if (line.type === 'barcode') {
        const barH = Math.max(lineHeightPx, Math.round(fontPx * 2));
        const smallPx = Math.max(7, Math.round(fontPx * 0.7));
        if (y + barH + smallPx > H - m) break;
        drawBarcodeBars(ctx, m + 2, y, maxTextWidth, barH, line.text);
        y += barH + 2;
        ctx.fillStyle = '#0f172a';
        ctx.font = `${smallPx}px ui-monospace, Menlo, monospace`;
        ctx.fillText(line.text, m + 2, y, maxTextWidth);
        ctx.font = font;
        y += Math.round(smallPx * 1.4);
      } else if (line.type === 'color') {
        // Thermal printers are monochrome: the color code shows as a
        // bordered text mark rather than a real color block.
        if (y + lineHeightPx + 2 > H - m) break;
        const tw = Math.min(ctx.measureText(line.text).width, maxTextWidth - 10);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0f172a';
        ctx.strokeRect(m + 2, y, tw + 12, lineHeightPx + 2);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(line.text, m + 8, y + Math.round((lineHeightPx + 2 - fontPx) / 2), maxTextWidth - 10);
        y += lineHeightPx + 6;
      } else {
        if (y + lineHeightPx > H - m) break;
        ctx.fillStyle = '#0f172a';
        ctx.fillText(line.text, m + 2, y, maxTextWidth);
        y += lineHeightPx;
      }
    }
  }

  function readCreateFormConfig() {
    return {
      widthMm: numOrUndef(document.getElementById('template-width').value),
      heightMm: numOrUndef(document.getElementById('template-height').value),
      dpi: numOrUndef(document.getElementById('template-dpi').value),
      bodyTemplate: document.getElementById('template-body').value
    };
  }

  function currentPreviewConfig() {
    if (previewSource.kind === 'template') {
      const t = currentTemplates.find((x) => String(x.id) === String(previewSource.id));
      if (t) {
        previewSourceHint.textContent = `Showing template #${t.id} (${t.name}).`;
        return { widthMm: t.widthMm, heightMm: t.heightMm, dpi: t.dpi, bodyTemplate: t.bodyTemplate };
      }
      previewSource = { kind: 'form' };
    }
    previewSourceHint.textContent = 'Showing the create form (live).';
    return readCreateFormConfig();
  }

  function redrawMainPreview() {
    if (!previewCanvas || !window.LabelPreview) return;
    drawLabel(previewCanvas, currentPreviewConfig());
    const zoom = Number(previewZoom.value) || 1;
    previewCanvas.style.width = `${Math.round(previewCanvas.width * zoom)}px`;
    previewCanvas.style.height = 'auto';
  }

  function redrawEditPreview() {
    if (!editPreviewCanvas || !window.LabelPreview) return;
    drawLabel(editPreviewCanvas, {
      widthMm: numOrUndef(document.getElementById('edit-template-width').value),
      heightMm: numOrUndef(document.getElementById('edit-template-height').value),
      dpi: numOrUndef(document.getElementById('edit-template-dpi').value),
      bodyTemplate: document.getElementById('edit-template-body').value
    });
  }

  // Size preset buttons (common thermal label sizes) fill the create form.
  window.LabelPreview.SIZE_PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${preset.widthMm}×${preset.heightMm}mm`;
    btn.style.cssText = 'background:#334155;padding:6px 10px;font-size:0.82rem;';
    btn.addEventListener('click', () => {
      document.getElementById('template-width').value = preset.widthMm;
      document.getElementById('template-height').value = preset.heightMm;
      previewSource = { kind: 'form' };
      redrawMainPreview();
    });
    previewPresets.insertBefore(btn, previewZoom);
  });

  previewZoom.addEventListener('change', redrawMainPreview);

  ['template-width', 'template-height', 'template-dpi', 'template-body'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      previewSource = { kind: 'form' };
      redrawMainPreview();
    });
  });

  ['edit-template-width', 'edit-template-height', 'edit-template-dpi', 'edit-template-body'].forEach((id) => {
    document.getElementById(id).addEventListener('input', redrawEditPreview);
  });

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
    if (previewSource.kind === 'template') {
      redrawMainPreview();
    }
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
    redrawEditPreview();
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
      previewSource = { kind: 'template', id };
      redrawMainPreview();
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
        if (previewSource.kind === 'template' && String(previewSource.id) === String(id)) {
          previewSource = { kind: 'form' };
          redrawMainPreview();
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
  redrawMainPreview();
  Promise.all([loadBrands(), loadTemplates()]).catch((err) => setPageMessage(err.message, true));
})();
