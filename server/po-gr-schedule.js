// PO GR Schedule Service
// PO 分批收货服务

const db = require('../config/database'); // 假设的数据库配置

// ============================================
// GR Schedule 管理
// ============================================

const GRSchedule = {
    tableName: 'tabPO GR Schedule',
    
    /**
     * PO 提交时创建 GR Schedule
     * 按 delivery_date 分组创建
     */
    async createFromPO(poData) {
        const { po_no, items } = poData;
        
        // 按 delivery_date 分组
        const groupedByDate = {};
        for (const item of items) {
            const date = item.delivery_date || 'unknown';
            if (!groupedByDate[date]) {
                groupedByDate[date] = [];
            }
            groupedByDate[date].push(item);
        }
        
        const schedules = [];
        
        for (const [date, dateItems] of Object.entries(groupedByDate)) {
            for (const item of dateItems) {
                const schedule = {
                    name: `${po_no}-${item.item_code}-${date}`.replace(/-/g, ''),
                    po_no: po_no,
                    po_item: item.name,
                    item_code: item.item_code,
                    item_name: item.item_name,
                    supplier: poData.supplier,
                    expected_date: date,
                    expected_qty: item.qty,
                    received_qty: 0,
                    uom: item.uom,
                    status: 'Pending'
                };
                
                await this.create(schedule);
                schedules.push(schedule);
            }
        }
        
        return schedules;
    },
    
    /**
     * 创建单条 Schedule
     */
    async create(data) {
        const sql = `
            INSERT INTO \`tabPO GR Schedule\` 
            (name, po_no, po_item, item_code, item_name, supplier, expected_date, expected_qty, received_qty, uom, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            expected_qty = VALUES(expected_qty), 
            modified = CURRENT_TIMESTAMP
        `;
        
        await db.query(sql, [
            data.name,
            data.po_no,
            data.po_item,
            data.item_code,
            data.item_name,
            data.supplier,
            data.expected_date,
            data.expected_qty,
            data.received_qty || 0,
            data.uom,
            data.status || 'Pending'
        ]);
        
        return data;
    },
    
    /**
     * 获取看板列表
     */
    async getBoard(filters = {}) {
        let sql = `
            SELECT 
                po_no,
                supplier,
                item_code,
                item_name,
                SUM(expected_qty) as total_expected,
                SUM(received_qty) as total_received,
                MIN(expected_date) as first_expected_date,
                MAX(expected_date) as last_expected_date,
                GROUP_CONCAT(DISTINCT status) as statuses
            FROM \`tabPO GR Schedule\`
            WHERE 1=1
        `;
        
        const params = [];
        
        if (filters.supplier) {
            sql += ' AND supplier = ?';
            params.push(filters.supplier);
        }
        
        if (filters.from_date) {
            sql += ' AND expected_date >= ?';
            params.push(filters.from_date);
        }
        
        if (filters.to_date) {
            sql += ' AND expected_date <= ?';
            params.push(filters.to_date);
        }
        
        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        
        sql += ' GROUP BY po_no, supplier, item_code, item_name ORDER BY expected_date ASC';
        
        const result = await db.query(sql, params);
        
        return result.map(row => ({
            po_no: row.po_no,
            supplier: row.supplier,
            item_code: row.item_code,
            item_name: row.item_name,
            total_expected: parseFloat(row.total_expected) || 0,
            total_received: parseFloat(row.total_received) || 0,
            pending_qty: (parseFloat(row.total_expected) || 0) - (parseFloat(row.total_received) || 0),
            first_expected_date: row.first_expected_date,
            last_expected_date: row.last_expected_date,
            status: row.statuses
        }));
    },
    
    /**
     * 获取单个 PO 的所有 Schedule
     */
    async getByPO(poNo) {
        const sql = 'SELECT * FROM `tabPO GR Schedule` WHERE po_no = ? ORDER BY expected_date';
        const result = await db.query(sql, [poNo]);
        return result;
    },
    
    /**
     * 更新已收货数量
     */
    async updateReceivedQty(scheduleName, receivedQty, grNo) {
        const sql = `
            UPDATE \`tabPO GR Schedule\`
            SET received_qty = received_qty + ?,
                gr_no = ?,
                status = CASE 
                    WHEN (received_qty + ?) >= expected_qty THEN 'Completed'
                    WHEN (received_qty + ?) > 0 THEN 'Partial'
                    ELSE status
                END,
                modified = CURRENT_TIMESTAMP
            WHERE name = ?
        `;
        
        await db.query(sql, [receivedQty, grNo, receivedQty, receivedQty, scheduleName]);
        return { success: true };
    },
    
    /**
     * 获取待收货的 Schedule
     */
    async getPending(filters = {}) {
        let sql = 'SELECT * FROM `tabPO GR Schedule` WHERE status != "Completed"';
        const params = [];
        
        if (filters.po_no) {
            sql += ' AND po_no = ?';
            params.push(filters.po_no);
        }
        
        if (filters.supplier) {
            sql += ' AND supplier = ?';
            params.push(filters.supplier);
        }
        
        sql += ' ORDER BY expected_date ASC';
        
        const result = await db.query(sql, params);
        return result;
    }
};

module.exports = { GRSchedule };
