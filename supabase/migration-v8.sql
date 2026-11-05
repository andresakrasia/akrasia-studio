-- FASE 13: Email Builder — historial de emails enviados

CREATE TABLE IF NOT EXISTS sent_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  visitor_id TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  template_type TEXT DEFAULT 'custom',
  status TEXT DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'failed')),
  resend_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_lead ON sent_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_visitor ON sent_emails(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_created ON sent_emails(created_at DESC);
