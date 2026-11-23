export function analyzeSoilMoisture(value) {
  const moisture = Number(value);

  if (
    value === null ||
    value === undefined ||
    value === '' ||
    !Number.isFinite(moisture) ||
    moisture < 0 ||
    moisture > 100
  ) {
    throw new Error('Soil moisture must be a number between 0 and 100.');
  }

  if (moisture <= 20) {
    return {
      level: 'very_dry',
      severity: 'critical',
      recommendation: 'Soil is very dry. Check the irrigation system and consider irrigation.'
    };
  }

  if (moisture <= 30) {
    return {
      level: 'dry',
      severity: 'warning',
      recommendation: 'Soil is dry. Irrigation is recommended.'
    };
  }

  if (moisture < 45) {
    return {
      level: 'moderate',
      severity: 'info',
      recommendation: 'Soil moisture is moderate. Continue monitoring.'
    };
  }

  if (moisture <= 70) {
    return {
      level: 'moist',
      severity: 'normal',
      recommendation: 'Soil moisture is currently adequate. Irrigation is not recommended by this rule.'
    };
  }

  return {
    level: 'very_wet',
    severity: 'warning',
    recommendation: 'Soil is very wet. Inspect the field and drainage for possible excess water.'
  };
}

export function analyzeReading(reading) {
  if (!reading || typeof reading !== 'object') {
    throw new Error('A sensor reading is required.');
  }

  const result = analyzeSoilMoisture(reading.soil_moisture);

  return {
    device_id: reading.device_id ?? null,
    temperature: reading.temperature ?? null,
    humidity: reading.humidity ?? null,
    soil_moisture: Number(reading.soil_moisture),
    analysis: result,
    mode: 'observation_only',
    pump_command_sent: false,
    analyzed_at: new Date().toISOString()
  };
}
