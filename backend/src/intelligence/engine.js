import { pool } from '../config/db.js';
import { analyzeReading } from './rules.js';

export async function getLatestSensorReading() {
  const result = await pool.query(
    `SELECT
       id,
       device_id,
       temperature,
       humidity,
       soil_moisture,
       received_at
     FROM sensor_readings
     ORDER BY received_at DESC, id DESC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

export async function analyzeLatestReading() {
  const reading = await getLatestSensorReading();

  if (!reading) {
    return {
      success: false,
      message: 'No sensor readings are available yet.',
      data: null
    };
  }

  const analysis = analyzeReading(reading);

  return {
    success: true,
    message: 'Latest sensor reading analyzed successfully.',
    data: {
      reading_id: reading.id,
      received_at: reading.received_at,
      ...analysis
    }
  };
}
