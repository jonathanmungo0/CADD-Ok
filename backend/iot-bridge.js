
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { validateIotReading } from './src/iotValidation.js';

dotenv.config();

const app = express();
const HOST = process.env.IOT_BRIDGE_HOST || '0.0.0.0';
const PORT = Number(process.env.IOT_BRIDGE_PORT || 4100);
const BACKEND_URL = (process.env.IOT_BACKEND_URL || 'http://127.0.0.1:4000')
  .replace(/\/+$/, '');

const DEVICE_TOKEN = process.env.IOT_DEVICE_TOKEN;
const DEMO_TOKEN = process.env.IOT_DEMO_TOKEN;

const DEMO_DEVICE_ID = 'CADD-WOKWI-ESP32';
const DEMO_INTERVAL_MS = 4000;

app.use(express.json({ limit: '2kb' }));

if (!DEVICE_TOKEN || !DEMO_TOKEN) {
  console.error('Missing IoT token configuration in .env');
  process.exit(1);
}

if (DEVICE_TOKEN === DEMO_TOKEN) {
  console.error('IOT_DEVICE_TOKEN and IOT_DEMO_TOKEN must be different.');
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('IOT_BRIDGE_PORT must be a valid TCP port.');
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
  const { reading, error } = validateIotReading(req.body);

  if (error) {
    return res.status(400).json({
      success: false,
      message: error
    });
  }

  // Restrict the public demonstration credential.
  if (req.isDemoDevice) {
    if (reading.device_id !== DEMO_DEVICE_ID) {
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
      `${BACKEND_URL}/api/iot/readings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEVICE_TOKEN}`
        },
        body: JSON.stringify(reading),
        signal: AbortSignal.timeout(5000)
      }
    );

    let result;
    try {
      result = await upstream.json();
    } catch {
      result = {
        success: false,
        message: 'CADD backend returned an invalid response.'
      };
    }

    return res.status(upstream.status).json(result);

  } catch (error) {
    console.error('CADD backend connection failed:', error.message);

    return res.status(502).json({
      success: false,
      message: 'CADD backend is unavailable'
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`CADD IoT Bridge running on http://${HOST}:${PORT}`);
});
