// P2-1: compliance report page (日管控·周排查·月调度). Pure helpers live in
// compliance-view.js (window.ComplianceView); this file only does DOM wiring.
(function () {
  const esc = window.AdminCommon.esc;
  const req = window.AdminCommon.requestJson;
  const CV = window.ComplianceView;

  const typeSelect = document.getElementById('comp-type');
  const dateLabel = document.getElementById('comp-date-label');
  const dateInput = document.getElementById('comp-date');
  const brandSelect = document.getElementById('comp-brand');
  const storeSelect = document.getElementById('comp-store');
  const generateBtn = document.getElementById('comp-generate');
  const printBtn = document.getElementById('comp-print');
  const reportEl = document.getElementById('comp-report');

  let stores = [];

  // ── Filters ────────────────────────────────────────────────────────────────

  typeSelect.innerHTML = CV.TYPES
    .map((t) => `<option value="${esc(t.value)}">${esc(t.label)}</option>`)
    .join('');

  function syncDateInput() {
    const meta = CV.typeMeta(typeSelect.value) || CV.TYPES[0];
    dateLabel.textContent = meta.dateLabel;
    dateInput.type = meta.inputType;
    dateInput.value = CV.defaultDateFor(meta.value, new Date());
  }

  function renderStoreOptions() {
    const brandId = brandSelect.value;
    const filtered = brandId
      ? stores.filter((store) => String(store.brandId) === brandId)
      : stores;
    storeSelect.innerHTML =
      '<option value="">全部门店</option>' +
      filtered
        .map((store) => `<option value="${esc(store.id)}">${esc(store.brandName)} / ${esc(store.name)}</option>`)
        .join('');
  }

  async function loadFilters() {
    const [brandRes, storeRes] = await Promise.all([
      req('/api/admin/brands'),
      req('/api/admin/stores')
    ]);
    if (!brandRes || !storeRes) {
      return;
    }
    stores = storeRes.stores;
    brandSelect.innerHTML =
      '<option value="">全部品牌</option>' +
      brandRes.brands
        .map((brand) => `<option value="${esc(brand.id)}">${esc(brand.name)}</option>`)
        .join('');
    renderStoreOptions();
  }

  // ── Report rendering ───────────────────────────────────────────────────────

  function scopeText(report) {
    const parts = [];
    if (report.brand && report.brand.name) {
      parts.push(report.brand.name);
    } else if (report.brandName) {
      parts.push(report.brandName);
    }
    if (report.store && report.store.name) {
      parts.push(report.store.name);
    } else if (report.storeName) {
      parts.push(report.storeName);
    }
    return parts.join(' / ') || '全部门店';
  }

  function reportDateText(report) {
    return report.date || report.weekStart || report.month || dateInput.value || '-';
  }

  function renderSections(sections) {
    return (Array.isArray(sections) ? sections : [])
      .map((section) => {
        const rows = (Array.isArray(section.items) ? section.items : [])
          .map((item) => {
            const sm = CV.statusMeta(item.status);
            return `<tr>
            <td>${esc(item.label)}</td>
            <td>${esc(item.value)}</td>
            <td><span class="status-badge ${sm.className}">${esc(sm.label)}</span></td>
          </tr>`;
          })
          .join('');
        return `<div class="report-section">
        <h3>${esc(section.title)}</h3>
        <table>
          <thead><tr><th>检查项</th><th>结果</th><th>状态</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">无数据</td></tr>'}</tbody>
        </table>
      </div>`;
      })
      .join('');
  }

  function renderRisks(risks) {
    const list = Array.isArray(risks) ? risks : [];
    if (list.length === 0) {
      return `<div class="report-section">
        <h3>风险隐患与整改建议</h3>
        <p class="hint">本期未发现风险隐患。</p>
      </div>`;
    }
    const rows = list
      .map((risk) => {
        const sm = CV.severityMeta(risk.severity);
        return `<tr>
        <td>${esc(risk.description)}</td>
        <td class="${sm.className}">${esc(sm.label)}</td>
        <td>${esc(risk.suggestion)}</td>
      </tr>`;
      })
      .join('');
    return `<div class="report-section">
      <h3>风险隐患与整改建议</h3>
      <table>
        <thead><tr><th>风险描述</th><th>等级</th><th>整改建议</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function renderReport(report) {
    const meta = CV.typeMeta(report.type) || CV.typeMeta(typeSelect.value) || CV.TYPES[0];
    const generatedAt = report.generatedAt ? new Date(report.generatedAt).toLocaleString('zh-CN') : '-';

    reportEl.innerHTML = `
      <div class="report-header">
        <h2>${esc(meta.title)}</h2>
        <p class="report-meta">${esc(meta.dateLabel)}：${esc(reportDateText(report))}　|　范围：${esc(scopeText(report))}</p>
        <p class="report-meta">生成时间：${esc(generatedAt)}</p>
      </div>
      ${renderSections(report.sections)}
      ${renderRisks(report.risks)}
      <div class="signature-row">
        <div class="signature-item">食品安全员（签字）：</div>
        <div class="signature-item">食品安全总监（签字）：</div>
        <div class="signature-item">负责人（签字）：</div>
        <div class="signature-item">日期：</div>
      </div>
      <p class="report-footer">本报告由 FreshGuard 依据「日管控、周排查、月调度」工作制度自动生成，数据来源于门店巡检、效期提醒与处置记录。</p>
    `;
    reportEl.hidden = false;
    printBtn.disabled = false;
  }

  async function generate() {
    window.AdminCommon.setPageMessage('');
    const url = CV.buildComplianceUrl({
      type: typeSelect.value,
      date: dateInput.value,
      brandId: brandSelect.value,
      storeId: storeSelect.value
    });
    if (!url) {
      window.AdminCommon.setPageMessage('未知的报告类型。', true);
      return;
    }

    try {
      generateBtn.disabled = true;
      const report = await req(url);
      if (!report) {
        return;
      }
      renderReport(report);
    } catch (error) {
      window.AdminCommon.setPageMessage(error.message, true);
    } finally {
      generateBtn.disabled = false;
    }
  }

  // ── Events / bootstrap ─────────────────────────────────────────────────────

  typeSelect.addEventListener('change', syncDateInput);
  brandSelect.addEventListener('change', renderStoreOptions);
  generateBtn.addEventListener('click', generate);
  printBtn.addEventListener('click', () => window.print());

  window.AdminCommon.bindLogout();
  syncDateInput();
  loadFilters().catch((error) => window.AdminCommon.setPageMessage(error.message, true));
})();
