import crypto from 'node:crypto';
import express from 'express';
import { requireAuth } from '../auth.js';
import { pool } from '../config/db.js';
import { validateIotReading } from '../iotValidation.js';

const router = express.Router();
const deviceToken = process.env.IOT_DEVICE_TOKEN;

function requireDeviceToken(req, res, next) {
  if (!deviceToken) {
    return res.status(503).json({
      error: 'IoT device authentication is not configured.'
    });
  }

  const authorization = req.get('authorization') || '';
  const supplied = authorization.match(/^Bearer ([^\s]+)$/i)?.[1] || '';
  const expectedBuffer = Buffer.from(deviceToken);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return res.status(401).json({ error: 'Valid IoT device authentication is required.' });
  }

  next();
}

// POST /api/iot/readings
// Save an IoT sensor reading permanently in PostgreSQL.
router.post('/readings', requireDeviceToken, async (req, res) => {
  const { reading, error: validationError } = validateIotReading(req.body);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sensor_readings (
        device_id, temperature, humidity, soil_moisture, soil_raw,
        soil_status, pump_on, led_status, gpio_output
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, device_id, temperature, humidity, soil_moisture,
                soil_raw, soil_status, pump_on, led_status, gpio_output,
                received_at`,
      [
        reading.device_id,
        reading.temperature,
        reading.humidity,
        reading.soil_moisture,
        reading.soil_raw,
        reading.soil_status,
        reading.pump_on,
        reading.led_status,
        reading.gpio_output
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Sensor reading saved.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('IoT reading error:', error.message);

    return res.status(500).json({
      error: 'Could not save IoT reading.'
    });
  }
});


// GET /api/iot/latest
// Return the most recent reading across all devices.
router.get('/latest', requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, temperature, humidity, soil_moisture,
              soil_raw, soil_status, pump_on, led_status, gpio_output,
              received_at
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
router.get('/history', requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, temperature, humidity, soil_moisture,
              soil_raw, soil_status, pump_on, led_status, gpio_output,
              received_at
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
