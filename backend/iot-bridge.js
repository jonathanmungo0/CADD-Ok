
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const app = express();
const PORT = 4100;

const DEVICE_TOKEN = process.env.IOT_DEVICE_TOKEN;
const DEMO_TOKEN = process.env.IOT_DEMO_TOKEN;

const DEMO_DEVICE_ID = 'CADD-WOKWI-ESP32';
const DEMO_INTERVAL_MS = 4000;

app.use(express.json({ limit: '2kb' }));

if (!DEVICE_TOKEN || !DEMO_TOKEN) {
  console.error('Missing IoT token configuration in .env');
  process.exit(1);
}

let lastDemoSubmission = 0;

function tokenMatches(expectedToken, suppliedToken) {
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);

  return (
    expected.length === supplied.length &&
    crypto.timingSafeEqual(expected, supplied)
  );
}

function requireDeviceToken(req, res, next) {
  const authorization = req.headers.authorization || '';

  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';

  if (tokenMatches(DEVICE_TOKEN, suppliedToken)) {
    req.isDemoDevice = false;
    return next();
  }

  if (tokenMatches(DEMO_TOKEN, suppliedToken)) {
    req.isDemoDevice = true;
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid device authentication'
  });
}

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'CADD IoT Bridge'
  });
});

app.post('/readings', requireDeviceToken, async (req, res) => {
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

  // Restrict the public demonstration credential.
  if (req.isDemoDevice) {
    if (device_id !== DEMO_DEVICE_ID) {
      return res.status(403).json({
        success: false,
        message: 'Demo credential is restricted to the Wokwi device'
      });
    }

    const now = Date.now();

    if (now - lastDemoSubmission < DEMO_INTERVAL_MS) {
      return res.status(429).json({
        success: false,
        message: 'Please wait before sending another demo reading'
      });
    }

    lastDemoSubmission = now;
  }

  try {
    const upstream = await fetch(
      'http://127.0.0.1:4000/api/iot/readings',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_id: device_id.trim(),
          temperature,
          humidity,
          soil_moisture
        })
      }
    );

    const result = await upstream.json();

    return res.status(upstream.status).json(result);

  } catch (error) {
    console.error('CADD backend connection failed:', error.message);

    return res.status(502).json({
      success: false,
      message: 'CADD backend is unavailable'
    });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CADD IoT Bridge running on http://127.0.0.1:${PORT}`);
});
