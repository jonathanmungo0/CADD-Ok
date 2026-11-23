
import { pool } from './src/config/db.js';

try {
  console.log('Creating CADD IoT sensor table...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id BIGSERIAL PRIMARY KEY,
      device_id VARCHAR(100) NOT NULL,
      temperature DOUBLE PRECISION NOT NULL
        CHECK (temperature >= -40 AND temperature <= 80),
      humidity DOUBLE PRECISION NOT NULL
        CHECK (humidity >= 0 AND humidity <= 100),
      soil_moisture DOUBLE PRECISION NOT NULL
        CHECK (soil_moisture >= 0 AND soil_moisture <= 100),
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    idx_sensor_readings_device_time
    ON sensor_readings (device_id, received_at DESC);
  `);

  console.log('SUCCESS: sensor_readings table is ready.');

} catch (error) {
  console.error('DATABASE ERROR:', error.message);

} finally {
  await pool.end();
}
