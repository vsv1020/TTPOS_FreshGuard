(function () {
  const { requestJson, setPageMessage, esc, bindLogout, createListControls, unwrapList } = window.AdminCommon;

  const filterForm = document.getElementById('audit-filter-form');
  const actorInput = document.getElementById('audit-actor');
  const actionSelect = document.getElementById('audit-action');
  const fromInput = document.getElementById('audit-from');
  const toInput = document.getElementById('audit-to');
  const tableBody = document.getElementById('audit-table');

  // Known audit actions recorded by the backend.
  const ACTIONS = [
    'login',
    'print',
    'product.create',
    'product.update',
    'product.delete',
    'staff.create',
    'staff.update',
    'staff.deactivate',
    'label-template.create',
    'label-template.update',
    'label-template.delete',
    'reminder.handle',
    'reminder.open',
    'inspection.submit',
    'inspection.self_check.submit'
  ];

  actionSelect.innerHTML =
    '<option value="">All actions</option>' +
    ACTIONS.map((action) => `<option value="${esc(action)}">${esc(action)}</option>`).join('');

  const listControls = createListControls({
    container: 'audit-controls',
    search: false,
    onChange: () => loadLogs().catch((err) => setPageMessage(err.message, true))
  });

  function currentFilters() {
    return {
      actor: actorInput.value.trim(),
      action: actionSelect.value,
      from: fromInput.value,
      to: toInput.value
    };
  }

  function renderRows(logs) {
    if (!logs.length) {
      tableBody.innerHTML = '<tr><td colspan="7" style="color:#64748b;">No audit logs found.</td></tr>';
      return;
    }

    tableBody.innerHTML = logs
      .map((log) => {
        const target = log.targetType
          ? `${esc(log.targetType)}${log.targetId != null ? ` #${esc(log.targetId)}` : ''}`
          : '-';
        return `<tr>
          <td>${esc(log.createdAt)}</td>
          <td>${esc(log.actorType)}</td>
          <td>${esc(log.actorId)}</td>
          <td>${esc(log.action)}</td>
          <td>${target}</td>
          <td>${esc(log.detail || '-')}</td>
          <td>${esc(log.ip || '-')}</td>
        </tr>`;
      })
      .join('');
  }

  async function loadLogs() {
    setPageMessage('');
    const res = await requestJson(`/api/admin/audit-logs?${listControls.queryString(currentFilters())}`);
    if (!res) {
      return;
    }
    const { items, total } = unwrapList(res, 'logs');
    renderRows(items);
    listControls.update({ total, count: items.length });
  }

  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    listControls.resetOffset();
    loadLogs().catch((err) => setPageMessage(err.message, true));
  });

  bindLogout();
  loadLogs().catch((err) => setPageMessage(err.message, true));
})();
