const tableBody = document.getElementById('report-table');
const refreshButton = document.getElementById('refresh-report');
const exportCsvBtn = document.getElementById('export-csv-btn');

const reportListControls = window.AdminCommon.createListControls({
  container: 'report-controls',
  searchPlaceholder: 'Search store / product...',
  onChange: () => loadReport()
});

function renderRows(rows) {
  const sortedRows = [...rows].sort(
    (a, b) => Number(b.expiredUnhandledCount) - Number(a.expiredUnhandledCount)
  );

  const esc = window.AdminCommon.esc;
  tableBody.innerHTML = sortedRows
    .map(
      (row) => `<tr>
      <td>${esc(row.storeName)}</td>
      <td>${esc(row.productName)}</td>
      <td>${esc(row.expiredUnhandledCount)}</td>
      <td>${esc(row.expiredTotalCount)}</td>
      <td>${esc(row.expiredHandledCount)}</td>
    </tr>`
    )
    .join('');

  if (rows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5">No expired reminders yet.</td></tr>';
  }
}

async function loadReport() {
  try {
    window.AdminCommon.setPageMessage('');
    const report = await window.AdminCommon.requestJson(
      `/api/admin/reports/expired-handling?${reportListControls.queryString()}`
    );
    if (!report) {
      return;
    }
    const { items, total } = window.AdminCommon.unwrapList(report, 'rows');
    renderRows(items);
    reportListControls.update({ total, count: items.length });
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
}

async function exportCsv() {
  try {
    window.AdminCommon.setPageMessage('');
    const csvParams = new URLSearchParams({ format: 'csv' });
    if (reportListControls.state.q) {
      csvParams.set('q', reportListControls.state.q);
    }
    const response = await fetch(`/api/admin/reports/expired-handling?${csvParams.toString()}`, {
      credentials: 'include'
    });

    if (response.status === 401 || response.status === 403) {
      window.location.href = '/admin/login';
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Export failed (${response.status})`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'expired-handling.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
}

refreshButton.addEventListener('click', loadReport);
exportCsvBtn.addEventListener('click', exportCsv);

window.AdminCommon.bindLogout();
loadReport();
