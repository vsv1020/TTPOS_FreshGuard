// FreshGuard Push Notification Service
// Backend: Node.js + node-cron + Firebase FCM

const cron = require('node-cron');
const admin = require('firebase-admin');

// 初始化 Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// 数据库模型
const Reminder = {
  tableName: 'reminders',
  
  // 创建提醒记录
  async create(batchId, storeId, deviceToken) {
    return await db.query(`
      INSERT INTO reminders (batch_id, store_id, device_token, status, scheduled_at)
      VALUES ($1, $2, $3, 'pending', NOW())
      RETURNING *
    `, [batchId, storeId, deviceToken]);
  },
  
  // 标记已推送
  async markSent(id) {
    return await db.query(`
      UPDATE reminders 
      SET status = 'sent', notified_at = NOW()
      WHERE id = $1
    `, [id]);
  },
  
  // 检查是否已推送
  async hasNotified(batchId, storeId) {
    const result = await db.query(`
      SELECT id FROM reminders 
      WHERE batch_id = $1 AND store_id = $2 AND status = 'sent'
    `, [batchId, storeId]);
    return result.rows.length > 0;
  }
};

// 扫描即将到期的批次
async function scanExpiringBatches() {
  const config = await getPushConfig();
  const hoursAhead = config.hours_before || 24;
  
  // 查询即将到期的批次
  const batches = await db.query(`
    SELECT b.*, s.device_token, s.name as store_name
    FROM batch b
    JOIN store s ON s.id = b.store_id
    WHERE b.expiry_date <= NOW() + INTERVAL '${hoursAhead} hours'
    AND b.status != 'processed'
    AND s.device_token IS NOT NULL
  `);
  
  for (const batch of batches.rows) {
    // 检查是否已推送
    const alreadyNotified = await Reminder.hasNotified(batch.id, batch.store_id);
    if (alreadyNotified) continue;
    
    // 计算剩余小时数
    const hoursLeft = Math.floor(
      (new Date(batch.expiry_date) - new Date()) / (1000 * 60 * 60)
    );
    
    // 发送推送
    await sendPush(batch.device_token, batch.product_name, hoursLeft);
    
    // 记录推送
    await Reminder.create(batch.id, batch.store_id, batch.device_token);
  }
}

// 发送 FCM 推送
async function sendPush(token, productName, hoursLeft) {
  const message = {
    notification: {
      title: 'FreshGuard 提醒',
      body: `${productName} 还有 ${hoursLeft} 小时到期，请及时处理`
    },
    data: {
      type: 'expiry_warning',
      batch_id: '',
      click_action: 'OPEN_EXPIRY_PAGE'
    },
    token: token
  };
  
  try {
    await admin.messaging().send(message);
    console.log(`Push sent: ${productName}`);
  } catch (error) {
    console.error('Push failed:', error);
  }
}

// 获取推送配置
async function getPushConfig() {
  const result = await db.query(`
    SELECT key, value FROM app_config WHERE category = 'push_notification'
  `);
  
  const config = { enabled: true, hours_before: 24 };
  for (const row of result.rows) {
    if (row.key === 'enabled') config.enabled = row.value === 'true';
    if (row.key === 'hours_before') config.hours_before = parseInt(row.value);
  }
  return config;
}

// 每小时运行一次
cron.schedule('0 * * * *', async () => {
  const config = await getPushConfig();
  if (!config.enabled) return;
  
  console.log('Running expiry scan...');
  await scanExpiringBatches();
});

module.exports = { scanExpiringBatches, sendPush };
