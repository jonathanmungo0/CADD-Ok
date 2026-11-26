import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIotReading } from '../src/iotValidation.js';

const basicReading = {
  device_id: ' CADD-ESP32 ',
  temperature: 25,
  humidity: 65,
  soil_moisture: 55
};

test('accepts bridge sensor readings and normalizes optional irrigation fields', () => {
  const result = validateIotReading(basicReading);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.reading, {
    device_id: 'CADD-ESP32',
    temperature: 25,
    humidity: 65,
    soil_moisture: 55,
    soil_raw: null,
    soil_status: null,
    pump_on: null,
    led_status: null,
    gpio_output: null
  });
});

test('accepts complete, consistent irrigation state', () => {
  const result = validateIotReading({
    ...basicReading,
    soil_raw: 1800,
    soil_status: 'MOIST_ENOUGH',
    pump_on: true,
    led_status: 'ON',
    gpio_output: 'HIGH'
  });

  assert.equal(result.error, undefined);
  assert.equal(result.reading.pump_on, true);
});

test('rejects partial or contradictory irrigation state', () => {
  const partial = validateIotReading({ ...basicReading, pump_on: true });
  const contradictory = validateIotReading({
    ...basicReading,
    pump_on: true,
    led_status: 'OFF',
    gpio_output: 'HIGH'
  });

  assert.match(partial.error, /led_status/i);
  assert.match(contradictory.error, /do not match/i);
});

test('rejects out-of-range sensor data and non-object input', () => {
  assert.match(
    validateIotReading({ ...basicReading, soil_moisture: 101 }).error,
    /soil moisture/i
  );
  assert.match(validateIotReading(null).error, /JSON sensor reading/i);
});
