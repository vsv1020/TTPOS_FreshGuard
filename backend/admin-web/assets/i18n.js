// Lightweight i18n for the admin web — zh (default) / en / th.
//
// Markup:
//   <span data-i18n="nav.dashboard">Dashboard</span>   -> textContent
//   <input data-i18n-ph="common.searchPlaceholder">      -> placeholder
//   <input data-i18n-title="audit.fromDate">              -> title attribute
//   <title data-i18n="title.dashboard">...</title>        -> document title
//
// Translations are a flat key -> { zh, en, th } map (T); STRINGS.<lang> is
// derived from it so every key necessarily exists in all three languages.
// JS strings: AdminI18n.t('common.save'). Language persists in localStorage.
(function () {
  const LANG_KEY = 'fgAdminLang';
  const LANGS = [
    { code: 'zh', label: '中文' },
    { code: 'en', label: 'English' },
    { code: 'th', label: 'ไทย' }
  ];

  const T = {
    "app.title": { zh: "FreshGuard 管理后台", en: "FreshGuard Admin", th: "FreshGuard ผู้ดูแลระบบ" },
    "common.logout": { zh: "退出登录", en: "Log Out", th: "ออกจากระบบ" },
    "common.language": { zh: "语言", en: "Language", th: "ภาษา" },
    "common.refresh": { zh: "刷新", en: "Refresh", th: "รีเฟรช" },
    "common.search": { zh: "搜索", en: "Search", th: "ค้นหา" },
    "common.searchPlaceholder": { zh: "搜索…", en: "Search…", th: "ค้นหา…" },
    "common.save": { zh: "保存", en: "Save", th: "บันทึก" },
    "common.create": { zh: "新建", en: "Create", th: "สร้าง" },
    "common.edit": { zh: "编辑", en: "Edit", th: "แก้ไข" },
    "common.delete": { zh: "删除", en: "Delete", th: "ลบ" },
    "common.cancel": { zh: "取消", en: "Cancel", th: "ยกเลิก" },
    "common.confirm": { zh: "确定", en: "Confirm", th: "ยืนยัน" },
    "common.prev": { zh: "上一页", en: "Prev", th: "ก่อนหน้า" },
    "common.next": { zh: "下一页", en: "Next", th: "ถัดไป" },
    "common.perPage": { zh: "条/页", en: "/ page", th: "/ หน้า" },
    "common.from": { zh: "起始", en: "From", th: "จาก" },
    "common.to": { zh: "截止", en: "To", th: "ถึง" },
    "common.brand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "common.store": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "common.actions": { zh: "操作", en: "Actions", th: "การดำเนินการ" },
    "common.all": { zh: "全部", en: "All", th: "ทั้งหมด" },
    "common.loading": { zh: "加载中…", en: "Loading…", th: "กำลังโหลด…" },
    "nav.dashboard": { zh: "仪表盘", en: "Dashboard", th: "แดชบอร์ด" },
    "nav.binding": { zh: "绑定", en: "Binding", th: "การผูกอุปกรณ์" },
    "nav.products": { zh: "商品", en: "Products", th: "สินค้า" },
    "nav.staff": { zh: "员工", en: "Staff", th: "พนักงาน" },
    "nav.labelTemplates": { zh: "标签模板", en: "Label Templates", th: "เทมเพลตฉลาก" },
    "nav.report": { zh: "报表", en: "Report", th: "รายงาน" },
    "nav.waste": { zh: "损耗", en: "Waste", th: "ของเสีย" },
    "nav.compliance": { zh: "合规", en: "Compliance", th: "การปฏิบัติตามกฎ" },
    "nav.audit": { zh: "审计", en: "Audit", th: "บันทึกการตรวจสอบ" },
    "nav.admins": { zh: "管理员", en: "Admins", th: "ผู้ดูแลระบบ" },
    "nav.erpSync": { zh: "ERP 对接", en: "ERP Sync", th: "เชื่อมต่อ ERP" },
    "title.dashboard": { zh: "FreshGuard 管理后台 · 仪表盘", en: "FreshGuard Admin · Dashboard", th: "FreshGuard ผู้ดูแลระบบ · แดชบอร์ด" },
    "title.binding": { zh: "FreshGuard 管理后台 · 绑定", en: "FreshGuard Admin · Binding", th: "FreshGuard ผู้ดูแลระบบ · การผูกอุปกรณ์" },
    "title.products": { zh: "FreshGuard 管理后台 · 商品", en: "FreshGuard Admin · Products", th: "FreshGuard ผู้ดูแลระบบ · สินค้า" },
    "title.staff": { zh: "FreshGuard 管理后台 · 员工", en: "FreshGuard Admin · Staff", th: "FreshGuard ผู้ดูแลระบบ · พนักงาน" },
    "title.labelTemplates": { zh: "FreshGuard 管理后台 · 标签模板", en: "FreshGuard Admin · Label Templates", th: "FreshGuard ผู้ดูแลระบบ · เทมเพลตฉลาก" },
    "title.report": { zh: "FreshGuard 管理后台 · 报表", en: "FreshGuard Admin · Report", th: "FreshGuard ผู้ดูแลระบบ · รายงาน" },
    "title.waste": { zh: "FreshGuard 管理后台 · 损耗", en: "FreshGuard Admin · Waste", th: "FreshGuard ผู้ดูแลระบบ · ของเสีย" },
    "title.compliance": { zh: "FreshGuard 管理后台 · 合规", en: "FreshGuard Admin · Compliance", th: "FreshGuard ผู้ดูแลระบบ · การปฏิบัติตามกฎ" },
    "title.audit": { zh: "FreshGuard 管理后台 · 审计", en: "FreshGuard Admin · Audit", th: "FreshGuard ผู้ดูแลระบบ · บันทึกการตรวจสอบ" },
    "title.admins": { zh: "FreshGuard 管理后台 · 管理员", en: "FreshGuard Admin · Admins", th: "FreshGuard ผู้ดูแลระบบ · ผู้ดูแลระบบ" },
    "title.erpSync": { zh: "FreshGuard 管理后台 · ERP 对接", en: "FreshGuard Admin · ERP Sync", th: "FreshGuard ผู้ดูแลระบบ · เชื่อมต่อ ERP" },
    "dashboard.filterFrom": { zh: "起始", en: "From", th: "จาก" },
    "dashboard.filterTo": { zh: "结束", en: "To", th: "ถึง" },
    "dashboard.filterBrand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "dashboard.filterStore": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "dashboard.refresh": { zh: "刷新", en: "Refresh", th: "รีเฟรช" },
    "dashboard.kpiToday": { zh: "今日到期", en: "Expiring Today", th: "หมดอายุวันนี้" },
    "dashboard.kpiUnhandled": { zh: "未处置过期", en: "Unhandled Expired", th: "หมดอายุที่ยังไม่จัดการ" },
    "dashboard.kpiRate": { zh: "近30天处置率", en: "Handling Rate (30d)", th: "อัตราการจัดการ (30 วัน)" },
    "dashboard.kpiStores": { zh: "门店数", en: "Stores", th: "จำนวนร้านค้า" },
    "dashboard.chartRanking": { zh: "门店未处置到期品排行", en: "Stores by Unhandled Expired Items", th: "อันดับร้านค้าตามสินค้าหมดอายุที่ยังไม่จัดการ" },
    "dashboard.chartLoss": { zh: "近30天损耗趋势", en: "Waste Trend (30d)", th: "แนวโน้มการสูญเสีย (30 วัน)" },
    "dashboard.chartScore": { zh: "巡检平均分趋势", en: "Average Inspection Score Trend", th: "แนวโน้มคะแนนเฉลี่ยการตรวจสอบ" },
    "dashboard.rankingTitle": { zh: "门店排名", en: "Store Ranking", th: "อันดับร้านค้า" },
    "dashboard.rankingHint": { zh: "点击列标题排序。红色单元格表示该项需要关注(处理率 < 80%、损耗率 > 10%、巡检均分 < 60、存在未关闭/逾期问题)。", en: "Click a column header to sort. Red cells indicate items needing attention (handling rate < 80%, waste rate > 10%, average inspection score < 60, or open/overdue issues).", th: "คลิกหัวคอลัมน์เพื่อเรียงลำดับ เซลล์สีแดงหมายถึงรายการที่ต้องให้ความสนใจ (อัตราการจัดการ < 80%, อัตราการสูญเสีย > 10%, คะแนนเฉลี่ยการตรวจสอบ < 60, หรือมีปัญหาที่ยังไม่ปิด/เกินกำหนด)" },
    "dashboard.colStore": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "dashboard.colHandleRate": { zh: "处理率", en: "Handling Rate", th: "อัตราการจัดการ" },
    "dashboard.colWasteRate": { zh: "损耗率", en: "Waste Rate", th: "อัตราการสูญเสีย" },
    "dashboard.colAvgScore": { zh: "巡检均分", en: "Avg Inspection Score", th: "คะแนนเฉลี่ยการตรวจสอบ" },
    "dashboard.colOpenIssues": { zh: "未关闭问题", en: "Open Issues", th: "ปัญหาที่ยังไม่ปิด" },
    "dashboard.colOverdueIssues": { zh: "逾期问题", en: "Overdue Issues", th: "ปัญหาเกินกำหนด" },
    "report.title": { zh: "按门店→产品的未处置过期", en: "Unhandled Expired by Store -> Product", th: "สินค้าหมดอายุที่ยังไม่จัดการ แยกตามร้านค้า -> สินค้า" },
    "report.hint": { zh: "数据按门店和产品分组。未处置过期数量是跟进的关键指标。", en: "Rows are grouped by store and product. Unhandled expired count is the key metric for follow-up.", th: "ข้อมูลจัดกลุ่มตามร้านค้าและสินค้า จำนวนสินค้าหมดอายุที่ยังไม่จัดการเป็นตัวชี้วัดสำคัญสำหรับการติดตาม" },
    "report.refresh": { zh: "刷新", en: "Refresh", th: "รีเฟรช" },
    "report.exportCsv": { zh: "导出 CSV", en: "Export CSV", th: "ส่งออก CSV" },
    "report.colStore": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "report.colProduct": { zh: "产品", en: "Product", th: "สินค้า" },
    "report.colUnhandled": { zh: "未处置过期", en: "Unhandled Expired", th: "หมดอายุที่ยังไม่จัดการ" },
    "report.colExpiredTotal": { zh: "过期总数", en: "Expired Total", th: "หมดอายุทั้งหมด" },
    "report.colHandled": { zh: "已处置", en: "Handled", th: "จัดการแล้ว" },
    "products.createProduct": { zh: "创建产品", en: "Create Product", th: "สร้างสินค้า" },
    "products.phProductName": { zh: "产品名称", en: "Product name", th: "ชื่อสินค้า" },
    "products.phSku": { zh: "SKU", en: "SKU", th: "SKU" },
    "products.phShelfLifeDays": { zh: "保质期天数", en: "Shelf life days", th: "อายุการเก็บ (วัน)" },
    "products.optSingle": { zh: "单语", en: "single", th: "ภาษาเดียว" },
    "products.optBilingual": { zh: "双语", en: "bilingual", th: "สองภาษา" },
    "products.hintBilingual": { zh: "双语标签需要选择第二语言。", en: "Bilingual labels require a secondary language.", th: "ฉลากสองภาษาต้องเลือกภาษาที่สอง" },
    "products.hintColorCode": { zh: "四色色标:红=畜肉禽类 / 蓝=水产 / 绿=果蔬 / 黄=熟食半成品(可不选)。", en: "Four-color code: Red = meat & poultry / Blue = seafood / Green = fruits & vegetables / Yellow = cooked & semi-prepared food (optional).", th: "รหัสสี 4 สี: แดง = เนื้อสัตว์และสัตว์ปีก / น้ำเงิน = อาหารทะเล / เขียว = ผักและผลไม้ / เหลือง = อาหารปรุงสุกและกึ่งสำเร็จรูป (ไม่บังคับ)" },
    "products.phAllergens": { zh: "过敏原(可选)", en: "Allergens (optional)", th: "สารก่อภูมิแพ้ (ไม่บังคับ)" },
    "products.phStorageConditions": { zh: "储存条件(可选)", en: "Storage conditions (optional)", th: "เงื่อนไขการจัดเก็บ (ไม่บังคับ)" },
    "products.phOpenedShelfLifeHours": { zh: "开封后保质期小时数(可选)", en: "Opened shelf life hours (optional)", th: "อายุการเก็บหลังเปิด (ชั่วโมง) (ไม่บังคับ)" },
    "products.phCostPrice": { zh: "成本价(可选)", en: "Cost price (optional)", th: "ราคาต้นทุน (ไม่บังคับ)" },
    "products.storePrinterSettings": { zh: "门店打印机设置", en: "Store Printer Settings", th: "ตั้งค่าเครื่องพิมพ์ของร้าน" },
    "products.phPrinterName": { zh: "打印机名称", en: "Printer name", th: "ชื่อเครื่องพิมพ์" },
    "products.phPrinterModel": { zh: "打印机型号", en: "Printer model", th: "รุ่นเครื่องพิมพ์" },
    "products.phPrinterAddress": { zh: "打印机地址(IP/BLE ID)", en: "Printer address (IP/BLE ID)", th: "ที่อยู่เครื่องพิมพ์ (IP/BLE ID)" },
    "products.phPrinterPort": { zh: "打印机端口", en: "Printer port", th: "พอร์ตเครื่องพิมพ์" },
    "products.phPrinterDpi": { zh: "打印机 DPI", en: "Printer DPI", th: "DPI เครื่องพิมพ์" },
    "products.phLabelWidthMm": { zh: "标签宽度(毫米)", en: "Label width (mm)", th: "ความกว้างฉลาก (มม.)" },
    "products.savePrinterSettings": { zh: "保存打印机设置", en: "Save Printer Settings", th: "บันทึกการตั้งค่าเครื่องพิมพ์" },
    "products.products": { zh: "产品", en: "Products", th: "สินค้า" },
    "products.exportCsv": { zh: "导出 CSV", en: "Export CSV", th: "ส่งออก CSV" },
    "products.downloadTemplate": { zh: "下载模板", en: "Download Template", th: "ดาวน์โหลดแม่แบบ" },
    "products.importCsv": { zh: "导入 CSV", en: "Import CSV", th: "นำเข้า CSV" },
    "products.hintCsvColorCode": { zh: "CSV 支持 colorCode 列(四色色标):red=畜肉禽类、blue=水产、green=果蔬、yellow=熟食半成品,留空为无。", en: "CSV supports a colorCode column (four-color code): red = meat & poultry, blue = seafood, green = fruits & vegetables, yellow = cooked & semi-prepared food; leave blank for none.", th: "CSV รองรับคอลัมน์ colorCode (รหัสสี 4 สี): red = เนื้อสัตว์และสัตว์ปีก, blue = อาหารทะเล, green = ผักและผลไม้, yellow = อาหารปรุงสุกและกึ่งสำเร็จรูป; เว้นว่างหากไม่มี" },
    "products.thBrand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "products.thName": { zh: "名称", en: "Name", th: "ชื่อ" },
    "products.thSku": { zh: "SKU", en: "SKU", th: "SKU" },
    "products.thColor": { zh: "色标", en: "Color", th: "สี" },
    "products.thShelfLifeDays": { zh: "保质期天数", en: "Shelf Life Days", th: "อายุการเก็บ (วัน)" },
    "products.thLabelLanguage": { zh: "标签语言", en: "Label Language", th: "ภาษาฉลาก" },
    "products.thPrimary": { zh: "主语言", en: "Primary", th: "ภาษาหลัก" },
    "products.thSecondary": { zh: "第二语言", en: "Secondary", th: "ภาษารอง" },
    "products.thAllergens": { zh: "过敏原", en: "Allergens", th: "สารก่อภูมิแพ้" },
    "products.thStorageConditions": { zh: "储存条件", en: "Storage Conditions", th: "เงื่อนไขการจัดเก็บ" },
    "products.thOpenedShelfLife": { zh: "开封后保质期(小时)", en: "Opened Shelf Life (h)", th: "อายุการเก็บหลังเปิด (ชม.)" },
    "products.thCostPrice": { zh: "成本价", en: "Cost Price", th: "ราคาต้นทุน" },
    "products.editProduct": { zh: "编辑产品", en: "Edit Product", th: "แก้ไขสินค้า" },
    "products.saveChanges": { zh: "保存更改", en: "Save Changes", th: "บันทึกการเปลี่ยนแปลง" },
    "products.cancel": { zh: "取消", en: "Cancel", th: "ยกเลิก" },
    "labelTemplates.createTitle": { zh: "新建模板", en: "Create Template", th: "สร้างเทมเพลต" },
    "labelTemplates.phName": { zh: "模板名称", en: "Template name", th: "ชื่อเทมเพลต" },
    "labelTemplates.phWidth": { zh: "宽度 mm(如 60)", en: "Width mm (e.g. 60)", th: "ความกว้าง มม. (เช่น 60)" },
    "labelTemplates.phHeight": { zh: "高度 mm(如 40)", en: "Height mm (e.g. 40)", th: "ความสูง มม. (เช่น 40)" },
    "labelTemplates.phDpi": { zh: "DPI(如 200)", en: "DPI (e.g. 200)", th: "DPI (เช่น 200)" },
    "labelTemplates.bodyTemplate": { zh: "正文模板", en: "Body template", th: "เทมเพลตเนื้อหา" },
    "labelTemplates.phBody": { zh: "如 {{product_name}}\n到期:{{expires_at}}", en: "e.g. {{product_name}}\nExpires: {{expires_at}}", th: "เช่น {{product_name}}\nหมดอายุ: {{expires_at}}" },
    "labelTemplates.setDefault": { zh: "设为该品牌默认模板", en: "Set as default for brand", th: "ตั้งเป็นค่าเริ่มต้นของแบรนด์" },
    "labelTemplates.createBtn": { zh: "新建模板", en: "Create Template", th: "สร้างเทมเพลต" },
    "labelTemplates.placeholdersTitle": { zh: "可用占位符", en: "Available Placeholders", th: "ตัวแปรที่ใช้ได้" },
    "labelTemplates.placeholdersHint": { zh: "将任意占位符复制到正文模板中。", en: "Copy any placeholder into your body template.", th: "คัดลอกตัวแปรใดก็ได้ไปไว้ในเทมเพลตเนื้อหาของคุณ" },
    "labelTemplates.thPlaceholder": { zh: "占位符", en: "Placeholder", th: "ตัวแปร" },
    "labelTemplates.thDescription": { zh: "说明", en: "Description", th: "คำอธิบาย" },
    "labelTemplates.phProductName": { zh: "商品名称", en: "Product name", th: "ชื่อสินค้า" },
    "labelTemplates.phExpiresAt": { zh: "到期日期/时间", en: "Expiry date/time", th: "วันที่/เวลาหมดอายุ" },
    "labelTemplates.phPrintedAt": { zh: "打印日期/时间", en: "Print date/time", th: "วันที่/เวลาที่พิมพ์" },
    "labelTemplates.phBatchId": { zh: "批次编号", en: "Batch ID number", th: "หมายเลขล็อต" },
    "labelTemplates.phStoreName": { zh: "门店名称", en: "Store name", th: "ชื่อร้าน" },
    "labelTemplates.phBarcode": { zh: "标签条码字符串", en: "Label barcode string", th: "สตริงบาร์โค้ดของฉลาก" },
    "labelTemplates.phAllergens": { zh: "过敏原信息", en: "Allergen info", th: "ข้อมูลสารก่อภูมิแพ้" },
    "labelTemplates.phStorage": { zh: "储存条件", en: "Storage conditions", th: "เงื่อนไขการจัดเก็บ" },
    "labelTemplates.phOpened": { zh: "开封后保质期(小时)", en: "Opened shelf life (hours)", th: "อายุการเก็บหลังเปิด (ชั่วโมง)" },
    "labelTemplates.phColorLabel": { zh: "色标文字标记(如 红·畜肉禽类)", en: "Color code text mark (e.g. 红·畜肉禽类)", th: "ป้ายข้อความรหัสสี (เช่น 红·畜肉禽类)" },
    "labelTemplates.phColorCode": { zh: "色标值(red/blue/green/yellow)", en: "Color code value (red/blue/green/yellow)", th: "ค่ารหัสสี (red/blue/green/yellow)" },
    "labelTemplates.previewTitle": { zh: "预览", en: "Preview", th: "ตัวอย่าง" },
    "labelTemplates.previewHint": { zh: "选择一行模板以启用实时预览。", en: "Select a template row to enable live preview.", th: "เลือกแถวเทมเพลตเพื่อเปิดใช้ตัวอย่างแบบเรียลไทม์" },
    "labelTemplates.previewSelectedBtn": { zh: "预览所选", en: "Preview Selected", th: "ดูตัวอย่างที่เลือก" },
    "labelTemplates.visualPreviewTitle": { zh: "可视化预览", en: "Visual Preview", th: "ตัวอย่างภาพ" },
    "labelTemplates.visualPreviewHint": { zh: "按标签尺寸(mm)与 DPI 1:1 渲染示例数据。随新建表单实时更新;点击某行的「选择」可改为预览该模板。条码以黑条模拟;虚线为 2mm 边距参考线(不打印)。", en: "1:1 canvas render at label size (mm) and DPI with sample data. Follows the create form as you type; click Select on a row to preview that template instead. Barcodes are mocked as black bars; dashed lines are 2mm margin guides (not printed).", th: "เรนเดอร์อัตราส่วน 1:1 ตามขนาดฉลาก (มม.) และ DPI ด้วยข้อมูลตัวอย่าง โดยอัปเดตตามฟอร์มสร้างขณะที่คุณพิมพ์ คลิก เลือก ที่แถวใดเพื่อดูตัวอย่างเทมเพลตนั้นแทน บาร์โค้ดจำลองเป็นแถบสีดำ เส้นประคือเส้นนำขอบ 2 มม. (ไม่พิมพ์)" },
    "labelTemplates.templatesTitle": { zh: "模板列表", en: "Templates", th: "เทมเพลต" },
    "labelTemplates.thId": { zh: "ID", en: "ID", th: "ID" },
    "labelTemplates.thBrand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "labelTemplates.thName": { zh: "名称", en: "Name", th: "ชื่อ" },
    "labelTemplates.thSize": { zh: "尺寸 (mm)", en: "Size (mm)", th: "ขนาด (มม.)" },
    "labelTemplates.thDpi": { zh: "DPI", en: "DPI", th: "DPI" },
    "labelTemplates.thDefault": { zh: "默认", en: "Default", th: "ค่าเริ่มต้น" },
    "labelTemplates.editTitle": { zh: "编辑模板", en: "Edit Template", th: "แก้ไขเทมเพลต" },
    "labelTemplates.phWidthShort": { zh: "宽度 mm", en: "Width mm", th: "ความกว้าง มม." },
    "labelTemplates.phHeightShort": { zh: "高度 mm", en: "Height mm", th: "ความสูง มม." },
    "labelTemplates.phDpiShort": { zh: "DPI", en: "DPI", th: "DPI" },
    "labelTemplates.livePreview": { zh: "实时预览", en: "Live preview", th: "ตัวอย่างแบบเรียลไทม์" },
    "labelTemplates.saveChangesBtn": { zh: "保存修改", en: "Save Changes", th: "บันทึกการเปลี่ยนแปลง" },
    "labelTemplates.cancelBtn": { zh: "取消", en: "Cancel", th: "ยกเลิก" },
    "audit.title": { zh: "审计日志", en: "Audit Logs", th: "บันทึกการตรวจสอบ" },
    "audit.phActor": { zh: "操作人(邮箱 / 员工 ID)", en: "Actor (email / staff id)", th: "ผู้ดำเนินการ (อีเมล / รหัสพนักงาน)" },
    "audit.allActions": { zh: "全部操作", en: "All actions", th: "การกระทำทั้งหมด" },
    "audit.fromDate": { zh: "起始日期", en: "From date", th: "วันที่เริ่มต้น" },
    "audit.toDate": { zh: "结束日期", en: "To date", th: "วันที่สิ้นสุด" },
    "audit.applyFilters": { zh: "应用筛选", en: "Apply Filters", th: "ใช้ตัวกรอง" },
    "audit.thTime": { zh: "时间", en: "Time", th: "เวลา" },
    "audit.thActorType": { zh: "操作人类型", en: "Actor Type", th: "ประเภทผู้ดำเนินการ" },
    "audit.thActor": { zh: "操作人", en: "Actor", th: "ผู้ดำเนินการ" },
    "audit.thAction": { zh: "操作", en: "Action", th: "การกระทำ" },
    "audit.thTarget": { zh: "目标", en: "Target", th: "เป้าหมาย" },
    "audit.thDetail": { zh: "详情", en: "Detail", th: "รายละเอียด" },
    "audit.thIp": { zh: "IP", en: "IP", th: "IP" },
    "waste.title": { zh: "损耗看板", en: "Waste Dashboard", th: "แดชบอร์ดการสูญเสีย" },
    "waste.intro": { zh: "损耗率 = 区间内报废批次 / 总批次。报废金额按商品成本价(cost_price)累加;无成本的批次按 0 计。", en: "Waste rate = discarded batches / total batches in range. Discard amount sums product cost_price; batches without a cost count as 0.", th: "อัตราการสูญเสีย = ล็อตที่ทิ้ง / ล็อตทั้งหมดในช่วงเวลา ยอดมูลค่าที่ทิ้งคำนวณจากราคาทุน (cost_price) ของสินค้า ล็อตที่ไม่มีราคาทุนนับเป็น 0" },
    "waste.from": { zh: "起始", en: "From", th: "ตั้งแต่" },
    "waste.to": { zh: "结束", en: "To", th: "ถึง" },
    "waste.brand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "waste.store": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "waste.refresh": { zh: "刷新", en: "Refresh", th: "รีเฟรช" },
    "waste.kpiTotalBatches": { zh: "总批次", en: "Total Batches", th: "ล็อตทั้งหมด" },
    "waste.kpiDiscarded": { zh: "报废数", en: "Discarded", th: "จำนวนที่ทิ้ง" },
    "waste.kpiWasteRate": { zh: "损耗率", en: "Waste Rate", th: "อัตราการสูญเสีย" },
    "waste.kpiDiscardAmount": { zh: "报废金额", en: "Discard Amount", th: "มูลค่าที่ทิ้ง" },
    "waste.rankingTitle": { zh: "门店损耗排行", en: "Store Waste Ranking", th: "อันดับการสูญเสียตามร้านค้า" },
    "waste.rankingHint": { zh: "按损耗率排序(最差在前)。高于整体损耗率的门店以红色高亮。", en: "Sorted by waste rate (worst first). Stores above the overall waste rate are highlighted in red.", th: "เรียงตามอัตราการสูญเสีย (แย่ที่สุดก่อน) ร้านค้าที่สูงกว่าอัตราการสูญเสียโดยรวมจะถูกเน้นเป็นสีแดง" },
    "waste.colStore": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "waste.colTotalBatches": { zh: "总批次", en: "Total Batches", th: "ล็อตทั้งหมด" },
    "waste.colDiscarded": { zh: "报废数", en: "Discarded", th: "จำนวนที่ทิ้ง" },
    "waste.colWasteRate": { zh: "损耗率", en: "Waste Rate", th: "อัตราการสูญเสีย" },
    "waste.colDiscardAmount": { zh: "报废金额", en: "Discard Amount", th: "มูลค่าที่ทิ้ง" },
    "waste.topProductsTitle": { zh: "损耗最高商品", en: "Top Waste Products", th: "สินค้าที่สูญเสียมากที่สุด" },
    "waste.colProduct": { zh: "商品", en: "Product", th: "สินค้า" },
    "waste.colAmount": { zh: "金额", en: "Amount", th: "มูลค่า" },
    "waste.reasonsTitle": { zh: "报废原因", en: "Discard Reasons", th: "เหตุผลในการทิ้ง" },
    "waste.trendTitle": { zh: "报废趋势", en: "Discard Trend", th: "แนวโน้มการทิ้ง" },
    "compliance.title": { zh: "合规报告(日管控 · 周排查 · 月调度)", en: "Compliance Report (Daily Control · Weekly Review · Monthly Scheduling)", th: "รายงานการปฏิบัติตามข้อกำหนด (ควบคุมรายวัน · ตรวจสอบรายสัปดาห์ · ทบทวนรายเดือน)" },
    "compliance.intro": { zh: "依据市场监管总局食品安全「日管控、周排查、月调度」制度实时生成,供监管检查使用。", en: "Generated in real time under the food safety system of \"daily control, weekly review, monthly scheduling\", for regulatory inspection.", th: "สร้างขึ้นแบบเรียลไทม์ตามระบบความปลอดภัยด้านอาหาร \"ควบคุมรายวัน ตรวจสอบรายสัปดาห์ ทบทวนรายเดือน\" เพื่อใช้ในการตรวจสอบของหน่วยงานกำกับดูแล" },
    "compliance.reportType": { zh: "报告类型", en: "Report Type", th: "ประเภทรายงาน" },
    "compliance.date": { zh: "日期", en: "Date", th: "วันที่" },
    "compliance.brand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "compliance.store": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "compliance.generate": { zh: "生成报告", en: "Generate Report", th: "สร้างรายงาน" },
    "compliance.print": { zh: "打印视图", en: "Print View", th: "มุมมองการพิมพ์" },
    "staff.selectStore": { zh: "选择门店", en: "Select Store", th: "เลือกร้านค้า" },
    "staff.addStaff": { zh: "添加员工", en: "Add Staff", th: "เพิ่มพนักงาน" },
    "staff.namePh": { zh: "员工姓名", en: "Staff name", th: "ชื่อพนักงาน" },
    "staff.pinPh": { zh: "PIN 码", en: "PIN", th: "รหัส PIN" },
    "staff.roleStaff": { zh: "员工", en: "staff", th: "พนักงาน" },
    "staff.roleManager": { zh: "店长", en: "manager", th: "ผู้จัดการ" },
    "staff.addStaffBtn": { zh: "添加员工", en: "Add Staff", th: "เพิ่มพนักงาน" },
    "staff.listTitle": { zh: "员工", en: "Staff", th: "พนักงาน" },
    "staff.thId": { zh: "ID", en: "ID", th: "รหัส" },
    "staff.thName": { zh: "姓名", en: "Name", th: "ชื่อ" },
    "staff.thRole": { zh: "角色", en: "Role", th: "บทบาท" },
    "staff.thActive": { zh: "启用", en: "Active", th: "ใช้งานอยู่" },
    "staff.editStaff": { zh: "编辑员工", en: "Edit Staff", th: "แก้ไขพนักงาน" },
    "staff.newPinPh": { zh: "新 PIN 码(留空则不修改)", en: "New PIN (leave blank to keep)", th: "รหัส PIN ใหม่ (เว้นว่างไว้หากไม่เปลี่ยน)" },
    "staff.active": { zh: "启用", en: "Active", th: "ใช้งานอยู่" },
    "staff.saveChanges": { zh: "保存修改", en: "Save Changes", th: "บันทึกการเปลี่ยนแปลง" },
    "staff.cancel": { zh: "取消", en: "Cancel", th: "ยกเลิก" },
    "binding.createBrand": { zh: "创建品牌", en: "Create Brand", th: "สร้างแบรนด์" },
    "binding.brandNamePh": { zh: "品牌名称", en: "Brand name", th: "ชื่อแบรนด์" },
    "binding.createBrandBtn": { zh: "创建品牌", en: "Create Brand", th: "สร้างแบรนด์" },
    "binding.createStore": { zh: "创建门店", en: "Create Store", th: "สร้างร้านค้า" },
    "binding.storeNamePh": { zh: "门店名称", en: "Store name", th: "ชื่อร้านค้า" },
    "binding.createStoreBtn": { zh: "创建门店", en: "Create Store", th: "สร้างร้านค้า" },
    "binding.generateCode": { zh: "生成绑定码", en: "Generate Binding Code", th: "สร้างรหัสผูกอุปกรณ์" },
    "binding.generateBtn": { zh: "生成绑定码", en: "Generate Code", th: "สร้างรหัส" },
    "binding.codeHint": { zh: "用于门店设备激活的一次性绑定码(无需员工登录)。", en: "One-time code for store device activation (no staff login).", th: "รหัสใช้ครั้งเดียวสำหรับเปิดใช้งานอุปกรณ์ของร้านค้า (ไม่ต้องเข้าสู่ระบบด้วยพนักงาน)" },
    "binding.reminderConfig": { zh: "品牌提醒配置", en: "Brand Reminder Config", th: "ตั้งค่าการแจ้งเตือนของแบรนด์" },
    "binding.thresholdPh": { zh: "临期预警阈值(天)", en: "Expiry warning threshold (days)", th: "เกณฑ์แจ้งเตือนใกล้หมดอายุ (วัน)" },
    "binding.saveReminderBtn": { zh: "保存提醒配置", en: "Save Reminder Config", th: "บันทึกการตั้งค่าการแจ้งเตือน" },
    "binding.promoRules": { zh: "临期促销规则", en: "Promo Rules", th: "กฎโปรโมชันสินค้าใกล้หมดอายุ" },
    "binding.brand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "binding.thLeadHours": { zh: "提前小时数", en: "Lead Hours", th: "จำนวนชั่วโมงล่วงหน้า" },
    "binding.thAction": { zh: "动作", en: "Action", th: "การดำเนินการ" },
    "binding.thDiscount": { zh: "折扣 %", en: "Discount %", th: "ส่วนลด %" },
    "binding.addRule": { zh: "添加规则", en: "Add Rule", th: "เพิ่มกฎ" },
    "binding.savePromoBtn": { zh: "保存促销规则", en: "Save Promo Rules", th: "บันทึกกฎโปรโมชัน" },
    "binding.promoHint": { zh: "规则按提前小时数降序应用,临期提醒命中剩余时间最近的一档(打折需填折扣 %,下架无需折扣)。", en: "Rules apply in descending order of lead hours; the expiry reminder matches the tier closest to the remaining time (discount requires a discount %, delisting needs none).", th: "กฎจะถูกใช้เรียงจากจำนวนชั่วโมงล่วงหน้ามากไปน้อย การแจ้งเตือนใกล้หมดอายุจะเลือกระดับที่ใกล้เวลาคงเหลือที่สุด (การลดราคาต้องระบุส่วนลด % ส่วนการนำออกไม่ต้องระบุ)" },
    "binding.codesTitle": { zh: "绑定码", en: "Binding Codes", th: "รหัสผูกอุปกรณ์" },
    "binding.thCode": { zh: "绑定码", en: "Code", th: "รหัส" },
    "binding.thBrand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "binding.thStore": { zh: "门店", en: "Store", th: "ร้านค้า" },
    "binding.thExpiresAt": { zh: "过期时间", en: "Expires At", th: "หมดอายุเมื่อ" },
    "binding.thUsedStatus": { zh: "使用状态", en: "Used Status", th: "สถานะการใช้งาน" },
    "binding.thUsedAt": { zh: "使用时间", en: "Used At", th: "ใช้งานเมื่อ" },
    "binding.thDevice": { zh: "设备", en: "Device", th: "อุปกรณ์" },
    "admins.createAdmin": { zh: "创建管理员", en: "Create Admin", th: "สร้างผู้ดูแลระบบ" },
    "admins.emailPh": { zh: "邮箱", en: "Email", th: "อีเมล" },
    "admins.passwordPh": { zh: "密码", en: "Password", th: "รหัสผ่าน" },
    "admins.noBrand": { zh: "无品牌(平台级)", en: "No brand (platform-wide)", th: "ไม่มีแบรนด์ (ระดับแพลตฟอร์ม)" },
    "admins.roleHint": { zh: "brand_admin 需指定品牌;viewer 为只读。", en: "brand_admin requires a brand; viewer is read-only.", th: "brand_admin ต้องระบุแบรนด์ ส่วน viewer เป็นแบบอ่านอย่างเดียว" },
    "admins.createAdminBtn": { zh: "创建管理员", en: "Create Admin", th: "สร้างผู้ดูแลระบบ" },
    "admins.listTitle": { zh: "管理员", en: "Admins", th: "ผู้ดูแลระบบ" },
    "admins.thId": { zh: "ID", en: "ID", th: "รหัส" },
    "admins.thEmail": { zh: "邮箱", en: "Email", th: "อีเมล" },
    "admins.thRole": { zh: "角色", en: "Role", th: "บทบาท" },
    "admins.thBrand": { zh: "品牌", en: "Brand", th: "แบรนด์" },
    "admins.thStatus": { zh: "状态", en: "Status", th: "สถานะ" },
    "admins.editAdmin": { zh: "编辑管理员", en: "Edit Admin", th: "แก้ไขผู้ดูแลระบบ" },
    "admins.disabled": { zh: "已禁用", en: "Disabled", th: "ปิดการใช้งาน" },
    "admins.saveChanges": { zh: "保存修改", en: "Save Changes", th: "บันทึกการเปลี่ยนแปลง" },
    "admins.cancel": { zh: "取消", en: "Cancel", th: "ยกเลิก" },
    "erp.connection": { zh: "连接配置", en: "Connection", th: "การเชื่อมต่อ" },
    "erp.baseUrl": { zh: "ERP 地址", en: "Base URL", th: "URL พื้นฐาน" },
    "erp.apiKey": { zh: "API Key", en: "API Key", th: "API Key" },
    "erp.apiSecret": { zh: "API Secret", en: "API Secret", th: "API Secret" },
    "erp.configured": { zh: "已配置", en: "configured", th: "ตั้งค่าแล้ว" },
    "erp.testConnection": { zh: "测试连接", en: "Test Connection", th: "ทดสอบการเชื่อมต่อ" },
    "erp.testOk": { zh: "连接成功", en: "Connection OK", th: "เชื่อมต่อสำเร็จ" },
    "erp.testFailed": { zh: "连接失败", en: "Connection failed", th: "การเชื่อมต่อล้มเหลว" },
    "erp.categories": { zh: "类目", en: "Categories", th: "หมวดหมู่" },
    "erp.loadCategories": { zh: "加载类目", en: "Load categories", th: "โหลดหมวดหมู่" },
    "erp.saveSelection": { zh: "保存所选", en: "Save selection", th: "บันทึกการเลือก" },
    "erp.preview": { zh: "预览", en: "Preview", th: "ดูตัวอย่าง" },
    "erp.syncNow": { zh: "立即同步", en: "Sync now", th: "ซิงค์ทันที" },
    "erp.lastSync": { zh: "最近同步", en: "Last sync", th: "ซิงค์ล่าสุด" },
    "erp.statusOk": { zh: "成功", en: "OK", th: "สำเร็จ" },
    "erp.statusError": { zh: "失败", en: "Error", th: "ผิดพลาด" },
    "erp.willInsert": { zh: "将新增", en: "Will insert", th: "จะเพิ่ม" },
    "erp.willUpdate": { zh: "将更新", en: "Will update", th: "จะอัปเดต" },
    "erp.willDeactivate": { zh: "将停用", en: "Will deactivate", th: "จะปิดใช้งาน" },
    "erp.conflicts": { zh: "冲突", en: "Conflicts", th: "ความขัดแย้ง" },
    "erp.skipped": { zh: "已跳过", en: "Skipped", th: "ข้ามไป" },
    "erp.defaultLabelLanguage": { zh: "默认标签语言", en: "Default label language", th: "ภาษาฉลากเริ่มต้น" },
    "erp.defaultPrimaryLanguage": { zh: "默认主语言", en: "Default primary language", th: "ภาษาหลักเริ่มต้น" },
    "erp.defaultSecondaryLanguage": { zh: "默认第二语言", en: "Default secondary language", th: "ภาษารองเริ่มต้น" },
    "erp.syncRunning": { zh: "同步正在进行中", en: "A sync is already running", th: "กำลังซิงค์อยู่แล้ว" }
  };

  const STRINGS = { zh: {}, en: {}, th: {} };
  Object.keys(T).forEach((k) => {
    STRINGS.zh[k] = T[k].zh;
    STRINGS.en[k] = T[k].en;
    STRINGS.th[k] = T[k].th;
  });

  function getLang() {
    try {
      const l = localStorage.getItem(LANG_KEY);
      if (l && STRINGS[l]) return l;
    } catch (_e) { /* ignore */ }
    return 'zh';
  }

  function setLang(lang) {
    if (!STRINGS[lang]) return;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_e) { /* ignore */ }
    apply(document);
  }

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
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title'), lang));
    });
  }

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

  window.AdminI18n = { LANGS, STRINGS, getLang, setLang, t, apply, mountSwitcher };
})();
