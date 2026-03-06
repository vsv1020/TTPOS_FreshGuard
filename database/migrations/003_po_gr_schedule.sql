-- PO GR Schedule Table
-- For tracking PO receiving schedule by delivery_date

CREATE TABLE IF NOT EXISTS `tabPO GR Schedule` (
    name VARCHAR(255) PRIMARY KEY,
    po_no VARCHAR(255),
    po_item VARCHAR(255),
    item_code VARCHAR(255),
    item_name VARCHAR(255),
    supplier VARCHAR(255),
    expected_date DATE,
    expected_qty DECIMAL(10,3),
    received_qty DECIMAL(10,3) DEFAULT 0,
    uom VARCHAR(50),
    gr_no VARCHAR(255),
    gr_item VARCHAR(255),
    status VARCHAR(20) DEFAULT 'Pending',
    creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_by VARCHAR(255)
);

-- Indexes
CREATE INDEX idx_gr_schedule_po ON `tabPO GR Schedule`(po_no);
CREATE INDEX idx_gr_schedule_date ON `tabPO GR Schedule`(expected_date);
CREATE INDEX idx_gr_schedule_status ON `tabPO GR Schedule`(status);
