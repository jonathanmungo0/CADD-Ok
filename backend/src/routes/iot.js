
import express from 'express';
import { pool } from '../config/db.js';

const router = express.Router();

// POST /api/iot/readings
// Save an IoT sensor reading permanently in PostgreSQL.
router.post('/readings', async (req, res) => {
  const {
    device_id,
    temperature,
    humidity,
    soil_moisture
  } = req.body || {};

  if (
    typeof device_id !== 'string' ||
    !device_id.trim() ||
    device_id.trim().length > 100 ||
    typeof temperature !== 'number' ||
    typeof humidity !== 'number' ||
    typeof soil_moisture !== 'number' ||
    !Number.isFinite(temperature) ||
    !Number.isFinite(humidity) ||
    !Number.isFinite(soil_moisture) ||
    temperature < -40 || temperature > 80 ||
    humidity < 0 || humidity > 100 ||
    soil_moisture < 0 || soil_moisture > 100
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid sensor reading'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sensor_readings
        (device_id, temperature, humidity, soil_moisture)
       VALUES ($1, $2, $3, $4)
       RETURNING id, device_id, temperature, humidity,
                 soil_moisture, received_at`,
      [
        device_id.trim(),
        temperature,
        humidity,
        soil_moisture
      ]
    );

    console.log('CADD IoT reading saved:', result.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Sensor reading saved permanently',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('IoT database save failed:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Could not save sensor reading'
    });
  }
});


// GET /api/iot/latest
// Return the most recent reading across all devices.
router.get('/latest', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, temperature, humidity,
              soil_moisture, received_at
       FROM sensor_readings
       ORDER BY received_at DESC, id DESC
       LIMIT 1`
    );

    return res.json({
      success: true,
      data: result.rows[0] || null
    });

  } catch (error) {
    console.error('IoT latest reading failed:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Could not retrieve latest reading'
    });
  }
});


// GET /api/iot/history
// Return the latest 100 readings.
router.get('/history', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, temperature, humidity,
              soil_moisture, received_at
       FROM sensor_readings
       ORDER BY received_at DESC, id DESC
       LIMIT 100`
    );

    return res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('IoT history retrieval failed:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Could not retrieve sensor history'
    });
  }
});

export default router;
