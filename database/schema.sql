CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'farmer' CHECK (role IN ('farmer','administrator')),
  farm_name TEXT,
  farm_location TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','rw','fr')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farmers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT UNIQUE,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','rw','fr')),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE farmers ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID REFERENCES farmers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  image_filename TEXT,
  predicted_class TEXT NOT NULL,
  disease_name TEXT NOT NULL,
  confidence NUMERIC(5,4),
  all_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  symptoms TEXT,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_class ON predictions(predicted_class);
CREATE INDEX IF NOT EXISTS idx_predictions_user_created_at ON predictions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_activity_created_at ON system_activity(created_at DESC);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  temperature DOUBLE PRECISION NOT NULL
    CONSTRAINT sensor_readings_temperature_check
    CHECK (temperature >= -40 AND temperature <= 80),
  humidity DOUBLE PRECISION NOT NULL
    CONSTRAINT sensor_readings_humidity_check
    CHECK (humidity >= 0 AND humidity <= 100),
  soil_moisture DOUBLE PRECISION NOT NULL
    CONSTRAINT sensor_readings_soil_moisture_check
    CHECK (soil_moisture >= 0 AND soil_moisture <= 100),
  soil_raw INTEGER,
  soil_status VARCHAR(20),
  pump_on BOOLEAN,
  led_status VARCHAR(3),
  gpio_output VARCHAR(4),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sensor_readings_soil_raw_check
    CHECK (soil_raw IS NULL OR soil_raw BETWEEN 0 AND 4095),
  CONSTRAINT sensor_readings_soil_status_check
    CHECK (soil_status IS NULL OR soil_status IN ('TOO_DRY', 'MODERATE', 'MOIST_ENOUGH')),
  CONSTRAINT sensor_readings_led_status_check
    CHECK (led_status IS NULL OR led_status IN ('ON', 'OFF')),
  CONSTRAINT sensor_readings_gpio_output_check
    CHECK (gpio_output IS NULL OR gpio_output IN ('HIGH', 'LOW')),
  CONSTRAINT sensor_readings_irrigation_state_check
    CHECK (
      (pump_on IS NULL AND led_status IS NULL AND gpio_output IS NULL)
      OR
      (
        pump_on IS NOT NULL
        AND led_status IS NOT NULL
        AND gpio_output IS NOT NULL
        AND led_status = CASE WHEN pump_on THEN 'ON' ELSE 'OFF' END
        AND gpio_output = CASE WHEN pump_on THEN 'HIGH' ELSE 'LOW' END
      )
    )
);

ALTER TABLE sensor_readings
  ADD COLUMN IF NOT EXISTS soil_raw INTEGER,
  ADD COLUMN IF NOT EXISTS soil_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS pump_on BOOLEAN,
  ADD COLUMN IF NOT EXISTS led_status VARCHAR(3),
  ADD COLUMN IF NOT EXISTS gpio_output VARCHAR(4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sensor_readings_soil_raw_check'
      AND conrelid = 'public.sensor_readings'::regclass
  ) THEN
    ALTER TABLE sensor_readings
      ADD CONSTRAINT sensor_readings_soil_raw_check
      CHECK (soil_raw IS NULL OR soil_raw BETWEEN 0 AND 4095);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sensor_readings_soil_status_check'
      AND conrelid = 'public.sensor_readings'::regclass
  ) THEN
    ALTER TABLE sensor_readings
      ADD CONSTRAINT sensor_readings_soil_status_check
      CHECK (soil_status IS NULL OR soil_status IN ('TOO_DRY', 'MODERATE', 'MOIST_ENOUGH'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sensor_readings_led_status_check'
      AND conrelid = 'public.sensor_readings'::regclass
  ) THEN
    ALTER TABLE sensor_readings
      ADD CONSTRAINT sensor_readings_led_status_check
      CHECK (led_status IS NULL OR led_status IN ('ON', 'OFF'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sensor_readings_gpio_output_check'
      AND conrelid = 'public.sensor_readings'::regclass
  ) THEN
    ALTER TABLE sensor_readings
      ADD CONSTRAINT sensor_readings_gpio_output_check
      CHECK (gpio_output IS NULL OR gpio_output IN ('HIGH', 'LOW'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sensor_readings_irrigation_state_check'
      AND conrelid = 'public.sensor_readings'::regclass
  ) THEN
    ALTER TABLE sensor_readings
      ADD CONSTRAINT sensor_readings_irrigation_state_check
      CHECK (
        (pump_on IS NULL AND led_status IS NULL AND gpio_output IS NULL)
        OR
        (
          pump_on IS NOT NULL
          AND led_status IS NOT NULL
          AND gpio_output IS NOT NULL
          AND led_status = CASE WHEN pump_on THEN 'ON' ELSE 'OFF' END
          AND gpio_output = CASE WHEN pump_on THEN 'HIGH' ELSE 'LOW' END
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_time
  ON sensor_readings (device_id, received_at DESC);
