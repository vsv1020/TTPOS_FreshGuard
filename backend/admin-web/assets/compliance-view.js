// P2-1: pure view helpers for the compliance report page (日管控·周排查·月调度).
// No DOM access — exposed as window.ComplianceView so it can be unit-tested
// in a vm sandbox (same pattern as label-preview.js).
(function () {
  const TYPES = [
    {
      value: 'daily',
      label: '日报 · 日管控',
      title: '食品安全日管控报告',
      dateLabel: '日期',
      dateParam: 'date',
      inputType: 'date'
    },
    {
      value: 'weekly',
      label: '周报 · 周排查',
      title: '食品安全周排查报告',
      dateLabel: '周起始（周一）',
      dateParam: 'weekStart',
      inputType: 'date'
    },
    {
      value: 'monthly',
      label: '月报 · 月调度',
      title: '食品安全月调度报告',
      dateLabel: '月份',
      dateParam: 'month',
      inputType: 'month'
    }
  ];

  function typeMeta(type) {
    return TYPES.find((t) => t.value === type) || null;
  }

  // Builds the GET URL for /api/admin/compliance/{daily|weekly|monthly}.
  // Returns null for unknown types.
  function buildComplianceUrl({ type, date, brandId, storeId } = {}) {
    const meta = typeMeta(type);
    if (!meta) {
      return null;
    }
    const params = new URLSearchParams();
    if (date) {
      params.set(meta.dateParam, String(date));
    }
    if (brandId) {
      params.set('brandId', String(brandId));
    }
    if (storeId) {
      params.set('storeId', String(storeId));
    }
    const qs = params.toString();
    return `/api/admin/compliance/${meta.value}${qs ? `?${qs}` : ''}`;
  }

  const STATUS_META = {
    ok: { label: '正常', className: 'status-ok' },
    warning: { label: '警告', className: 'status-warning' },
    fail: { label: '不合格', className: 'status-fail' }
  };

  function statusMeta(status) {
    return (
      STATUS_META[status] || {
        label: status == null ? '-' : String(status),
        className: 'status-unknown'
      }
    );
  }

  const SEVERITY_META = {
    high: { label: '高', className: 'severity-high' },
    medium: { label: '中', className: 'severity-medium' },
    low: { label: '低', className: 'severity-low' }
  };

  function severityMeta(severity) {
    return (
      SEVERITY_META[severity] || {
        label: severity == null ? '-' : String(severity),
        className: 'severity-unknown'
      }
    );
  }

  function isoDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Default date-input value per report type: daily → today, weekly → the
  // Monday of the current week, monthly → current YYYY-MM.
  function defaultDateFor(type, now) {
    // Duck-type instead of `instanceof Date`: callers may pass a Date from
    // another realm (e.g. tests loading this file in a vm context).
    const d = now && typeof now.getTime === 'function' ? new Date(now.getTime()) : new Date();
    if (type === 'monthly') {
      return isoDate(d).slice(0, 7);
    }
    if (type === 'weekly') {
      const daysSinceMonday = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - daysSinceMonday);
    }
    return isoDate(d);
  }

  window.ComplianceView = {
    TYPES,
    typeMeta,
    buildComplianceUrl,
    statusMeta,
    severityMeta,
    defaultDateFor
  };
})();
