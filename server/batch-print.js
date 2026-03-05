// FreshGuard Batch Print Service
// 多品批量打印 - 同时打印多个商品标签

const http = require('http');

class BatchPrintService {
  constructor() {
    this.printerApi = process.env.PRINTER_API || 'http://localhost:9100';
  }
  
  /**
   * 批量打印标签
   * @param {Array} items - 商品列表 [{productName, barcode, expiryDate, quantity}]
   * @returns {Promise<Object>}
   */
  async printBatch(items) {
    const printJobs = items.map(item => ({
      type: 'label',
      data: {
        product_name: item.productName,
        barcode: item.barcode,
        expiry_date: item.expiryDate,
        quantity: item.quantity,
        print_time: new Date().toISOString()
      }
    }));
    
    // 逐个发送打印请求
    const results = [];
    for (const job of printJobs) {
      try {
        const result = await this.sendToPrinter(job);
        results.push({ success: true, ...result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    return {
      total: items.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }
  
  /**
   * 发送打印任务到打印机
   */
  async sendToPrinter(job) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(job);
      
      const options = {
        hostname: 'localhost',
        port: 9100,
        path: '/print',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };
      
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ jobId: Date.now() });
          }
        });
      });
      
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
  
  /**
   * 获取打印状态
   */
  async getPrintStatus(jobId) {
    // 实现获取打印状态逻辑
    return { jobId, status: 'completed' };
  }
}

/**
 * 从订单创建批量打印任务
 */
async function createBatchFromOrder(orderId) {
  const order = await getOrder(orderId);
  const items = order.items.map(item => ({
    productName: item.product_name,
    barcode: item.barcode,
    expiryDate: item.expiry_date || calculateDefaultExpiry(item.product_id),
    quantity: item.quantity
  }));
  
  const printService = new BatchPrintService();
  return await printService.printBatch(items);
}

// 辅助函数：计算默认到期日期
function calculateDefaultExpiry(productId) {
  const defaultShelfLife = 7; // 默认7天
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + defaultShelfLife);
  return expiry.toISOString().split('T')[0];
}

// 获取订单
async function getOrder(orderId) {
  // 从数据库获取订单
  const result = await db.query(`
    SELECT * FROM orders WHERE id = $1
  `, [orderId]);
  return result.rows[0];
}

module.exports = { BatchPrintService, createBatchFromOrder };
