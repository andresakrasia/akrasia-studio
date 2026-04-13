-- ============================================
-- AKRASIA STUDIO — Fase 5: Content Table
-- Run this SQL in Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS content (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on content" ON content
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
