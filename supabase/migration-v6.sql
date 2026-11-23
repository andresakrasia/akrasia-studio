-- FASE 12: Booking system
-- Tabla de reservas de videollamada

CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT NOT NULL REFERENCES visitors(visitor_id),
  conversation_id UUID REFERENCES conversations(id),
  lead_id UUID REFERENCES leads(id),
  booked_date DATE NOT NULL,
  booked_time TIME NOT NULL,
  duration_min INTEGER DEFAULT 30,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  meet_url TEXT,
  visitor_email TEXT,
  visitor_phone TEXT,
  visitor_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_visitor ON bookings(visitor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(booked_date, booked_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
