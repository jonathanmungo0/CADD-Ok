
const soilStatuses = new Set([
  'TOO_DRY',
  'MODERATE',
  'MOIST_ENOUGH'
]);

const ledStatuses = new Set(['ON', 'OFF']);
const gpioOutputs = new Set(['HIGH', 'LOW']);

const SOIL_DRY_THRESHOLD = 30;
const SOIL_WET_THRESHOLD = 45;

export function validateIotReading(body) {

  // Check that the request contains a JSON object.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: 'A JSON sensor reading is required.'
    };
  }

  const {
    device_id,
    temperature,
    humidity,
    soil_moisture,
    soil_raw,
    soil_status,
    pump_on,
    led_status,
    gpio_output
  } = body;

  // Validate device ID.
  if (
    typeof device_id !== 'string' ||
    !device_id.trim() ||
    device_id.trim().length > 100
  ) {
    return { error: 'Invalid device_id.' };
  }

  // Validate temperature.
  if (
    !Number.isFinite(temperature) ||
    temperature < -40 ||
    temperature > 80
  ) {
    return { error: 'Invalid temperature.' };
  }

  // Validate air humidity.
  if (
    !Number.isFinite(humidity) ||
    humidity < 0 ||
    humidity > 100
  ) {
    return { error: 'Invalid humidity.' };
  }

  // Validate soil moisture percentage.
  if (
    !Number.isFinite(soil_moisture) ||
    soil_moisture < 0 ||
    soil_moisture > 100
  ) {
    return { error: 'Invalid soil moisture.' };
  }

  // Validate raw soil sensor value.
  const hasIrrigationData = [
    soil_raw,
    soil_status,
    pump_on,
    led_status,
    gpio_output
  ].some((value) => value !== undefined);

  if (hasIrrigationData) {
    if (typeof pump_on !== 'boolean') {
      return { error: 'Invalid pump_on value.' };
    }

    if (!ledStatuses.has(led_status)) {
      return { error: 'Invalid led_status.' };
    }

    if (!gpioOutputs.has(gpio_output)) {
      return { error: 'Invalid gpio_output.' };
    }

    if (
      led_status !== (pump_on ? 'ON' : 'OFF') ||
      gpio_output !== (pump_on ? 'HIGH' : 'LOW')
    ) {
      return {
        error: 'Pump, LED and GPIO states do not match.'
      };
    }

    if (
      !Number.isInteger(soil_raw) ||
      soil_raw < 0 ||
      soil_raw > 4095
    ) {
      return { error: 'Invalid soil_raw value.' };
    }

    if (!soilStatuses.has(soil_status)) {
      return { error: 'Invalid soil_status.' };
    }

    const expectedSoilStatus =
      soil_moisture <= SOIL_DRY_THRESHOLD
        ? 'TOO_DRY'
        : soil_moisture >= SOIL_WET_THRESHOLD
          ? 'MOIST_ENOUGH'
          : 'MODERATE';

    if (soil_status !== expectedSoilStatus) {
      return {
        error: 'Soil status does not match soil moisture.'
      };
    }
  }

  // Return validated sensor reading.
  return {
    reading: {
      device_id: device_id.trim(),
      temperature,
      humidity,
      soil_moisture,
      soil_raw: hasIrrigationData ? soil_raw : null,
      soil_status: hasIrrigationData ? soil_status : null,
      pump_on: hasIrrigationData ? pump_on : null,
      led_status: hasIrrigationData ? led_status : null,
      gpio_output: hasIrrigationData ? gpio_output : null
    }
  };
}
