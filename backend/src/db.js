// Aggregator module: db.js is now a thin facade over the lib/ and repos/
// modules. It re-exports exactly the same surface as before the split so that
// every existing caller (app.js, compliance.js, inspection-*.js, server.js,
// test/) keeps importing from './db' unchanged.

const {
  HANDLING_REASONS,
  LABEL_LANGUAGE_BILINGUAL,
  LABEL_LANGUAGE_SINGLE,
  PRODUCT_COLOR_CODES,
  PRODUCT_COLOR_LABELS
} = require('./lib/util');
const {
  renderLabelFromTemplate,
  renderLabelTemplate
} = require('./lib/labels');
const { createDb, closeDb } = require('./schema');
const {
  getUserByEmail,
  listAdminUsers,
  getAdminAccountById,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  resetAdminAccountPassword,
  ensureAdminUser
} = require('./repos/admin-accounts');
const {
  createBrand,
  listBrands,
  getBrandPromoRules,
  updateBrandPromoRules,
  getBrandReminderConfig,
  updateBrandReminderConfig
} = require('./repos/brands');
const {
  getStoreById,
  incrementStoreTokenVersion,
  listStores,
  createStore,
  updateStorePrinterSettings
} = require('./repos/stores');
const {
  consumeBindingCode,
  createBindingCode,
  listBindingCodes
} = require('./repos/binding-codes');
const {
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  listProducts,
  listStoreProducts,
  PRODUCT_CSV_FIELDS,
  importProductsCsv
} = require('./repos/products');
const {
  createBatchWithReminders,
  getStoreBatchByBarcode,
  renderStoreBatchLabel
} = require('./repos/batches');
const {
  listStoreReminders,
  handleReminder,
  openReminder,
  runReminderScan
} = require('./repos/reminders');
const {
  getStoreStaffById,
  createStoreStaff,
  listStoreStaff,
  updateStoreStaff,
  deactivateStoreStaff,
  verifyStoreStaffPin,
  getPinLockState,
  recordPinFailure,
  clearPinFailures
} = require('./repos/staff');
const {
  getLabelTemplateById,
  getDefaultLabelTemplate,
  createLabelTemplate,
  listLabelTemplates,
  updateLabelTemplate,
  deleteLabelTemplate
} = require('./repos/label-templates');
const {
  getDashboardSummary,
  getStoreExpiryRanking,
  getLossTrend,
  getInspectionScoreTrend,
  getStoreDashboardRanking
} = require('./repos/dashboard');
const {
  getWasteReport,
  listExpiredHandlingReport
} = require('./repos/reports');
const {
  recordAudit,
  listAuditLogs
} = require('./repos/audit');

module.exports = {
  HANDLING_REASONS,
  LABEL_LANGUAGE_BILINGUAL,
  LABEL_LANGUAGE_SINGLE,
  PRODUCT_COLOR_CODES,
  PRODUCT_COLOR_LABELS,
  PRODUCT_CSV_FIELDS,
  clearPinFailures,
  closeDb,
  consumeBindingCode,
  createAdminAccount,
  createBatchWithReminders,
  createBindingCode,
  createBrand,
  createDb,
  createLabelTemplate,
  createProduct,
  createStore,
  createStoreStaff,
  deactivateStoreStaff,
  deleteLabelTemplate,
  deleteProduct,
  ensureAdminUser,
  getAdminAccountById,
  getBrandPromoRules,
  getBrandReminderConfig,
  getDashboardSummary,
  getDefaultLabelTemplate,
  getInspectionScoreTrend,
  getLabelTemplateById,
  getLossTrend,
  getPinLockState,
  getProductById,
  getStoreBatchByBarcode,
  getStoreById,
  getStoreDashboardRanking,
  getStoreExpiryRanking,
  getStoreStaffById,
  getUserByEmail,
  getWasteReport,
  handleReminder,
  importProductsCsv,
  incrementStoreTokenVersion,
  listAdminAccounts,
  listAdminUsers,
  listAuditLogs,
  listBindingCodes,
  listBrands,
  listExpiredHandlingReport,
  listLabelTemplates,
  listProducts,
  listStores,
  listStoreProducts,
  listStoreReminders,
  listStoreStaff,
  openReminder,
  recordAudit,
  recordPinFailure,
  resetAdminAccountPassword,
  renderLabelFromTemplate,
  renderLabelTemplate,
  renderStoreBatchLabel,
  runReminderScan,
  updateAdminAccount,
  updateBrandPromoRules,
  updateBrandReminderConfig,
  updateLabelTemplate,
  updateProduct,
  updateStoreStaff,
  updateStorePrinterSettings,
  verifyStoreStaffPin
};
