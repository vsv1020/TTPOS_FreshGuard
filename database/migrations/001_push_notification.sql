-- FreshGuard Push Notification - Database Migration
-- Table: reminders

CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES batch(id),
    store_id UUID REFERENCES store(id),
    device_token VARCHAR(255),
    scheduled_at TIMESTAMP NOT NULL,
    notified_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_reminders_batch ON reminders(batch_id);
CREATE INDEX idx_reminders_store ON reminders(store_id);
CREATE INDEX idx_reminders_status ON reminders(status);

-- Admin 配置表（如果不存在）
CREATE TABLE IF NOT EXISTS push_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 默认配置
INSERT INTO push_config (key, value, description) VALUES 
    ('enabled', 'true', '全局推送开关'),
    ('hours_before', '24', '提前推送小时数')
ON CONFLICT (key) DO NOTHING;
