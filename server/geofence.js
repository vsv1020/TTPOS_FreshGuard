// TTPOS LBS - Geofence Service
// 地理围栏地址验证服务

const turf = require('@turf/turf');

// ============================================
// 围栏管理 CRUD
// ============================================

const Geofence = {
  tableName: 'geofences',
  
  // 创建围栏
  async create(data) {
    const { name, description, type, center_lat, center_lng, radius_km, polygon_geojson, created_by } = data;
    
    const result = await db.query(`
      INSERT INTO geofences (name, description, type, center_lat, center_lng, radius_km, polygon_geojson, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, description, type, center_lat, center_lng, radius_km, polygon_geojson, created_by]);
    
    return result.rows[0];
  },
  
  // 获取围栏列表
  async findAll(activeOnly = true) {
    let query = 'SELECT * FROM geofences';
    if (activeOnly) {
      query += ' WHERE is_active = true';
    }
    query += ' ORDER BY created_at DESC';
    
    const result = await db.query(query);
    return result.rows;
  },
  
  // 获取单个围栏
  async findById(id) {
    const result = await db.query('SELECT * FROM geofences WHERE id = $1', [id]);
    return result.rows[0];
  },
  
  // 更新围栏
  async update(id, data) {
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(data)) {
      if (['name', 'description', 'type', 'center_lat', 'center_lng', 'radius_km', 'polygon_geojson', 'is_active'].includes(key)) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }
    
    fields.push(`updated_at = NOW()`);
    values.push(id);
    
    const result = await db.query(`
      UPDATE geofences SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *
    `, values);
    
    return result.rows[0];
  },
  
  // 删除围栏
  async delete(id) {
    await db.query('DELETE FROM geofences WHERE id = $1', [id]);
    return { success: true };
  }
};

// ============================================
// 地址验证服务
// ============================================

class GeofenceService {
  
  /**
   * 验证地址是否在围栏内
   * @param {Object} input - 输入 { address, lat, lng, application_type }
   * @returns {Object} { inside, geofence, distance_km, message }
   */
  async validate(input) {
    let { address, lat, lng, application_type } = input;
    
    // 1. 如果提供的是地址，先转换为坐标
    if (address && !lat) {
      const geoResult = await this.geocode(address);
      if (!geoResult.success) {
        return { inside: false, message: '地址解析失败' };
      }
      lat = geoResult.lat;
      lng = geoResult.lng;
    }
    
    if (!lat || !lng) {
      return { inside: false, message: '缺少坐标信息' };
    }
    
    // 2. 获取适用的围栏
    const geofences = await this.getApplicableGeofences(application_type);
    if (geofences.length === 0) {
      // 没有围栏限制，默认通过
      return { inside: true, message: '无围栏限制' };
    }
    
    // 3. 逐个检查围栏
    for (const geofence of geofences) {
      const result = this.checkPointInGeofence(lat, lng, geofence);
      
      if (result.inside) {
        return {
          inside: true,
          geofence: {
            id: geofence.id,
            name: geofence.name,
            distance_km: result.distance_km
          },
          message: '地址在允许范围内'
        };
      }
    }
    
    // 4. 都不在范围内
    const nearest = await this.findNearestGeofence(lat, lng, application_type);
    return {
      inside: false,
      geofence: nearest ? { name: nearest.name, distance_km: nearest.distance_km } : null,
      message: '地址不在允许范围内'
    };
  }
  
  /**
   * 检查点是否在围栏内
   */
  checkPointInGeofence(lat, lng, geofence) {
    const point = turf.point([lng, lat]);
    
    if (geofence.type === 'circle') {
      // 圆形围栏：计算距离
      const center = turf.point([parseFloat(geofence.center_lng), parseFloat(geofence.center_lat)]);
      const distance = turf.distance(point, center, { units: 'kilometers' });
      const radius = parseFloat(geofence.radius_km);
      
      return {
        inside: distance <= radius,
        distance_km: Math.round(distance * 100) / 100
      };
    } else if (geofence.type === 'polygon' && geofence.polygon_geojson) {
      // 多边形围栏：判断点是否在多边形内
      const polygon = turf.polygon(geofence.polygon_geojson.coordinates);
      const isInside = turf.booleanPointInPolygon(point, polygon);
      
      return {
        inside: isInside,
        distance_km: 0
      };
    }
    
    return { inside: false, distance_km: null };
  }
  
  /**
   * 获取适用的围栏
   */
  async getApplicableGeofences(applicationType) {
    let query = 'SELECT * FROM geofences WHERE is_active = true';
    
    if (applicationType) {
      query += `
        AND id IN (
          SELECT geofence_id FROM geofence_applications 
          WHERE application_type = $1
        )
      `;
      const result = await db.query(query, [applicationType]);
      return result.rows;
    }
    
    const result = await db.query(query);
    return result.rows;
  }
  
  /**
   * 查找最近的围栏
   */
  async findNearestGeofence(lat, lng, applicationType) {
    const geofences = await this.getApplicableGeofences(applicationType);
    
    let nearest = null;
    let minDistance = Infinity;
    
    for (const geofence of geofences) {
      if (geofence.type === 'circle') {
        const center = turf.point([parseFloat(geofence.center_lng), parseFloat(geofence.center_lat)]);
        const point = turf.point([lng, lat]);
        const distance = turf.distance(point, center, { units: 'kilometers' });
        
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { name: geofence.name, distance_km: Math.round(distance * 100) / 100 };
        }
      }
    }
    
    return nearest;
  }
  
  /**
   * 地址转坐标 (Geocoding)
   * 需要集成 Mapbox 或其他 Geocoding 服务
   */
  async geocode(address) {
    // TODO: 集成 Mapbox Geocoding API
    // 这里返回模拟数据
    console.log('[LBS] Geocoding address:', address);
    return { success: false, message: '需集成 Mapbox Geocoding API' };
  }
  
  /**
   * 验证并记录日志
   */
  async validateWithLog(input) {
    const result = await this.validate(input);
    
    // 记录验证日志
    await db.query(`
      INSERT INTO geofence_validations 
      (geofence_id, input_address, input_lat, input_lng, result_inside, distance_km)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      result.geofence?.id || null,
      input.address || null,
      input.lat || null,
      input.lng || null,
      result.inside,
      result.geofence?.distance_km || null
    ]);
    
    return result;
  }
}

// ============================================
// 辅助函数
// ============================================

/**
 * 计算两点间距离（Haversine 公式）
 * 备用方案，不需要 Turf.js
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // 地球半径 (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

module.exports = { Geofence, GeofenceService };
