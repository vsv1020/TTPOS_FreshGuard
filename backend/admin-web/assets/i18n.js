// Lightweight i18n for the admin web — zh (default) / en / th.
//
// Usage in markup:
//   <span data-i18n="nav.dashboard">Dashboard</span>   -> textContent
//   <input data-i18n-ph="common.searchPlaceholder">      -> placeholder
//   <title data-i18n="title.dashboard">...</title>        -> document title
//
// JS strings: AdminI18n.t('common.save').
// Language is persisted in localStorage and applied on load by common.js.
(function () {
  const LANG_KEY = 'fgAdminLang';
  const LANGS = [
    { code: 'zh', label: '中文' },
    { code: 'en', label: 'English' },
    { code: 'th', label: 'ไทย' }
  ];

  const STRINGS = {
    zh: {
      'app.title': 'FreshGuard 管理后台',
      'common.logout': '退出登录',
      'common.language': '语言',
      'common.refresh': '刷新',
      'common.search': '搜索',
      'common.searchPlaceholder': '搜索…',
      'common.save': '保存',
      'common.create': '新建',
      'common.edit': '编辑',
      'common.delete': '删除',
      'common.cancel': '取消',
      'common.confirm': '确定',
      'common.prev': '上一页',
      'common.next': '下一页',
      'common.perPage': '条/页',
      'common.from': '起始',
      'common.to': '截止',
      'common.brand': '品牌',
      'common.store': '门店',
      'common.actions': '操作',
      'common.all': '全部',
      'common.loading': '加载中…',

      'nav.dashboard': '仪表盘',
      'nav.binding': '绑定',
      'nav.products': '商品',
      'nav.staff': '员工',
      'nav.labelTemplates': '标签模板',
      'nav.report': '报表',
      'nav.waste': '损耗',
      'nav.compliance': '合规',
      'nav.audit': '审计',
      'nav.admins': '管理员',

      'title.dashboard': 'FreshGuard 管理后台 · 仪表盘',
      'title.binding': 'FreshGuard 管理后台 · 绑定',
      'title.products': 'FreshGuard 管理后台 · 商品',
      'title.staff': 'FreshGuard 管理后台 · 员工',
      'title.labelTemplates': 'FreshGuard 管理后台 · 标签模板',
      'title.report': 'FreshGuard 管理后台 · 报表',
      'title.waste': 'FreshGuard 管理后台 · 损耗',
      'title.compliance': 'FreshGuard 管理后台 · 合规',
      'title.audit': 'FreshGuard 管理后台 · 审计',
      'title.admins': 'FreshGuard 管理后台 · 管理员'
    },
    en: {
      'app.title': 'FreshGuard Admin',
      'common.logout': 'Log Out',
      'common.language': 'Language',
      'common.refresh': 'Refresh',
      'common.search': 'Search',
      'common.searchPlaceholder': 'Search…',
      'common.save': 'Save',
      'common.create': 'Create',
      'common.edit': 'Edit',
      'common.delete': 'Delete',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.prev': 'Prev',
      'common.next': 'Next',
      'common.perPage': '/ page',
      'common.from': 'From',
      'common.to': 'To',
      'common.brand': 'Brand',
      'common.store': 'Store',
      'common.actions': 'Actions',
      'common.all': 'All',
      'common.loading': 'Loading…',

      'nav.dashboard': 'Dashboard',
      'nav.binding': 'Binding',
      'nav.products': 'Products',
      'nav.staff': 'Staff',
      'nav.labelTemplates': 'Label Templates',
      'nav.report': 'Report',
      'nav.waste': 'Waste',
      'nav.compliance': 'Compliance',
      'nav.audit': 'Audit',
      'nav.admins': 'Admins',

      'title.dashboard': 'FreshGuard Admin · Dashboard',
      'title.binding': 'FreshGuard Admin · Binding',
      'title.products': 'FreshGuard Admin · Products',
      'title.staff': 'FreshGuard Admin · Staff',
      'title.labelTemplates': 'FreshGuard Admin · Label Templates',
      'title.report': 'FreshGuard Admin · Report',
      'title.waste': 'FreshGuard Admin · Waste',
      'title.compliance': 'FreshGuard Admin · Compliance',
      'title.audit': 'FreshGuard Admin · Audit',
      'title.admins': 'FreshGuard Admin · Admins'
    },
    th: {
      'app.title': 'FreshGuard ผู้ดูแลระบบ',
      'common.logout': 'ออกจากระบบ',
      'common.language': 'ภาษา',
      'common.refresh': 'รีเฟรช',
      'common.search': 'ค้นหา',
      'common.searchPlaceholder': 'ค้นหา…',
      'common.save': 'บันทึก',
      'common.create': 'สร้าง',
      'common.edit': 'แก้ไข',
      'common.delete': 'ลบ',
      'common.cancel': 'ยกเลิก',
      'common.confirm': 'ยืนยัน',
      'common.prev': 'ก่อนหน้า',
      'common.next': 'ถัดไป',
      'common.perPage': '/ หน้า',
      'common.from': 'จาก',
      'common.to': 'ถึง',
      'common.brand': 'แบรนด์',
      'common.store': 'ร้านค้า',
      'common.actions': 'การดำเนินการ',
      'common.all': 'ทั้งหมด',
      'common.loading': 'กำลังโหลด…',

      'nav.dashboard': 'แดชบอร์ด',
      'nav.binding': 'การผูกอุปกรณ์',
      'nav.products': 'สินค้า',
      'nav.staff': 'พนักงาน',
      'nav.labelTemplates': 'เทมเพลตฉลาก',
      'nav.report': 'รายงาน',
      'nav.waste': 'ของเสีย',
      'nav.compliance': 'การปฏิบัติตามกฎ',
      'nav.audit': 'บันทึกการตรวจสอบ',
      'nav.admins': 'ผู้ดูแลระบบ',

      'title.dashboard': 'FreshGuard ผู้ดูแลระบบ · แดชบอร์ด',
      'title.binding': 'FreshGuard ผู้ดูแลระบบ · การผูกอุปกรณ์',
      'title.products': 'FreshGuard ผู้ดูแลระบบ · สินค้า',
      'title.staff': 'FreshGuard ผู้ดูแลระบบ · พนักงาน',
      'title.labelTemplates': 'FreshGuard ผู้ดูแลระบบ · เทมเพลตฉลาก',
      'title.report': 'FreshGuard ผู้ดูแลระบบ · รายงาน',
      'title.waste': 'FreshGuard ผู้ดูแลระบบ · ของเสีย',
      'title.compliance': 'FreshGuard ผู้ดูแลระบบ · การปฏิบัติตามกฎ',
      'title.audit': 'FreshGuard ผู้ดูแลระบบ · บันทึกการตรวจสอบ',
      'title.admins': 'FreshGuard ผู้ดูแลระบบ · ผู้ดูแลระบบ'
    }
  };

  function getLang() {
    try {
      const l = localStorage.getItem(LANG_KEY);
      if (l && STRINGS[l]) return l;
    } catch (_e) {
      // ignore storage errors
    }
    return 'zh';
  }

  function setLang(lang) {
    if (!STRINGS[lang]) return;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (_e) {
      // ignore storage errors
    }
    apply(document);
  }

  // Resolve a key for a language, falling back to zh, then the key itself.
  function t(key, lang) {
    const L = lang || getLang();
    return (STRINGS[L] && STRINGS[L][key]) || STRINGS.zh[key] || key;
  }

  function apply(root) {
    const doc = root || document;
    const lang = getLang();
    if (doc.documentElement) {
      doc.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    }
    doc.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'), lang);
    });
    doc.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'), lang));
    });
  }

  // Injects a compact language <select> into the topbar (idempotent).
  function mountSwitcher(doc) {
    const target = doc || document;
    const bar = target.querySelector('.topbar');
    if (!bar || target.getElementById('lang-switcher')) return;

    const select = target.createElement('select');
    select.id = 'lang-switcher';
    select.setAttribute('aria-label', 'Language');
    LANGS.forEach((l) => {
      const opt = target.createElement('option');
      opt.value = l.code;
      opt.textContent = l.label;
      select.appendChild(opt);
    });
    select.value = getLang();
    select.addEventListener('change', () => setLang(select.value));

    const logout = target.getElementById('logout-btn');
    if (logout && logout.parentNode === bar) {
      bar.insertBefore(select, logout);
    } else {
      bar.appendChild(select);
    }
  }

  window.AdminI18n = {
    LANGS,
    STRINGS,
    getLang,
    setLang,
    t,
    apply,
    mountSwitcher
  };
})();
