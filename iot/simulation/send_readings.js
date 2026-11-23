
const API_URL = 'http://localhost:4000/api/iot/readings';

const deviceId = 'CADD-ESP32-SIM-001';

// Example readings, not real farm measurements.
const simulatedReadings = [
  { temperature: 25, humidity: 65, soil_moisture: 55 },
  { temperature: 28, humidity: 72, soil_moisture: 40 },
  { temperature: 32, humidity: 80, soil_moisture: 25 },
  { temperature: 34, humidity: 85, soil_moisture: 18 },
  { temperature: 27, humidity: 68, soil_moisture: 48 }
];

let index = 0;

async function sendReading() {
  const values = simulatedReadings[index];

  const payload = {
    device_id: deviceId,
    ...values
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    console.log('Sent:', payload);
    console.log('CADD response:', result);
    console.log('-----------------------------');

  } catch (error) {
    console.error('Could not contact CADD backend:', error.message);
  }

  index = (index + 1) % simulatedReadings.length;
}

sendReading();
setInterval(sendReading, 5000);
