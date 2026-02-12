const tableBody = document.getElementById('report-table');
const refreshButton = document.getElementById('refresh-report');

function renderRows(rows) {
  const sortedRows = [...rows].sort(
    (a, b) => Number(b.expiredUnhandledCount) - Number(a.expiredUnhandledCount)
  );

  tableBody.innerHTML = sortedRows
    .map(
      (row) => `<tr>
      <td>${row.storeName}</td>
      <td>${row.productName}</td>
      <td>${row.expiredUnhandledCount}</td>
      <td>${row.expiredTotalCount}</td>
      <td>${row.expiredHandledCount}</td>
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
    const report = await window.AdminCommon.requestJson('/api/admin/reports/expired-handling');
    if (!report) {
      return;
    }
    renderRows(report.rows);
  } catch (error) {
    window.AdminCommon.setPageMessage(error.message, true);
  }
}

refreshButton.addEventListener('click', loadReport);

window.AdminCommon.bindLogout();
loadReport();
