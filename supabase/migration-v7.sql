-- FASE 12.1: Availability system for admin + buffer
-- Admin defines available hours, agent only offers those

CREATE TABLE IF NOT EXISTS availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  override_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  is_available BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS buffer_min INTEGER DEFAULT 30;

-- Availability is explicitly configured by the administrator.
-- A fresh database has no bookable slots until that configuration exists.

CREATE INDEX IF NOT EXISTS idx_availability_day ON availability(day_of_week);
CREATE INDEX IF NOT EXISTS idx_overrides_date ON availability_overrides(override_date);
