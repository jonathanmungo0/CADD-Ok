import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const token = process.env.IOT_DEVICE_TOKEN;

if (!token) {
  console.error('ERROR: IOT_DEVICE_TOKEN is missing.');
  process.exit(1);
}

const bridgeUrl = (process.env.IOT_BRIDGE_URL || 'http://127.0.0.1:4100')
  .replace(/\/+$/, '');

const response = await fetch(`${bridgeUrl}/readings`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    device_id: 'CADD-STAGE4-TEST',
    temperature: 26.5,
    humidity: 65,
    soil_moisture: 42
  })
});

console.log('HTTP status:', response.status);
console.log('Bridge response:', await response.text());
