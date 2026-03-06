// PO GR Schedule API Routes
// PO 收货看板 API

const express = require('express');
const router = express.Router();
const { GRSchedule } = require('./po-gr-schedule');

// ============================================
// 看板 API
// ============================================

/**
 * GET /api/po-gr-schedule/board
 * 获取收货看板列表
 */
router.get('/board', async (req, res) => {
    try {
        const { supplier, from_date, to_date, status } = req.query;
        
        const schedules = await GRSchedule.getBoard({
            supplier,
            from_date,
            to_date,
            status
        });
        
        res.json({
            success: true,
            data: schedules
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/po-gr-schedule/po/:poNo
 * 获取单个 PO 的所有 Schedule
 */
router.get('/po/:poNo', async (req, res) => {
    try {
        const schedules = await GRSchedule.getByPO(req.params.poNo);
        
        res.json({
            success: true,
            data: schedules
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/po-gr-schedule/pending
 * 获取待收货列表
 */
router.get('/pending', async (req, res) => {
    try {
        const { supplier, po_no } = req.query;
        
        const schedules = await GRSchedule.getPending({
            supplier,
            po_no
        });
        
        res.json({
            success: true,
            data: schedules
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/po-gr-schedule/receive
 * 执行收货操作
 */
router.post('/receive', async (req, res) => {
    try {
        const { schedule_name, received_qty, gr_no } = req.body;
        
        if (!schedule_name || !received_qty || !gr_no) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数'
            });
        }
        
        await GRSchedule.updateReceivedQty(schedule_name, received_qty, gr_no);
        
        res.json({
            success: true,
            message: '收货成功'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/po-gr-schedule/create-from-po
 * 从 PO 创建 GR Schedule（由 ERPNext Hook 调用）
 */
router.post('/create-from-po', async (req, res) => {
    try {
        const { po_no, supplier, items } = req.body;
        
        if (!po_no || !items || !items.length) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数'
            });
        }
        
        const schedules = await GRSchedule.createFromPO({
            po_no,
            supplier,
            items
        });
        
        res.json({
            success: true,
            message: `创建了 ${schedules.length} 条 GR Schedule`,
            data: schedules
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
