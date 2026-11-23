import dotenv from 'dotenv';

dotenv.config();

const token = process.env.IOT_DEVICE_TOKEN;

const response = await fetch(
  'https://key-daisy-affecting-creatures.trycloudflare.com/readings',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      device_id: 'CADD-PUBLIC-TEST',
      temperature: 27.2,
      humidity: 68,
      soil_moisture: 38
    })
  }
);

console.log('HTTP status:', response.status);
console.log('Response:', await response.text());
