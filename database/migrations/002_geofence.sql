-- TTPOS LBS - Geofence Database Migration
-- Version: 1.0

-- 围栏表
CREATE TABLE IF NOT EXISTS geofences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('circle', 'polygon')),
    center_lat DECIMAL(10, 8),
    center_lng DECIMAL(11, 8),
    radius_km DECIMAL(10, 2),
    polygon_geojson JSONB,
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_geofences_type ON geofences(type);
CREATE INDEX idx_geofences_active ON geofences(is_active);

-- 围栏应用关联表
CREATE TABLE IF NOT EXISTS geofence_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id UUID REFERENCES geofences(id) ON DELETE CASCADE,
    application_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(geofence_id, application_type)
);

-- 验证日志表
CREATE TABLE IF NOT EXISTS geofence_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id UUID REFERENCES geofences(id),
    input_address VARCHAR(500),
    input_lat DECIMAL(10, 8),
    input_lng DECIMAL(11, 8),
    result_inside BOOLEAN,
    distance_km DECIMAL(10, 2),
    validated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_validations_geofence ON geofence_validations(geofence_id);
CREATE INDEX idx_validations_date ON geofence_validations(validated_at);

-- 默认围栏（示例）
INSERT INTO geofences (name, description, type, center_lat, center_lng, radius_km, is_active) 
VALUES ('Default Zone', 'Default circular geofence', 'circle', 13.7563, 100.5018, 10.0, true)
ON CONFLICT DO NOTHING;
