-- ============================================
-- AKRASIA STUDIO — migration-v5: Hot leads + Telegram bidirectional
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- 1. Update leads status CHECK constraint to include 'hot'
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'hot', 'contacted', 'qualified', 'lost'));

-- 2. Add budget_mentioned column
ALTER TABLE leads ADD COLUMN IF NOT EXISTS budget_mentioned TEXT;

-- 3. Add source column to leads (web, telegram)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';

-- 4. Index for hot leads query
CREATE INDEX IF NOT EXISTS idx_leads_hot ON leads(status) WHERE status = 'hot';
