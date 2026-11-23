import dotenv from 'dotenv';

dotenv.config();

const token = process.env.IOT_DEVICE_TOKEN;

if (!token) {
  console.error('ERROR: IOT_DEVICE_TOKEN is missing.');
  process.exit(1);
}

const response = await fetch('http://127.0.0.1:4100/readings', {
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
