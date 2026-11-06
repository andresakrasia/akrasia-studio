-- ============================================
-- AKRASIA STUDIO — Fase 4: Supabase Migration
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- 1. Tabla visitors
CREATE TABLE IF NOT EXISTS visitors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT UNIQUE NOT NULL,
  first_seen TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  source TEXT DEFAULT 'web',
  page_views INTEGER DEFAULT 1
);

-- 2. Tabla conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT REFERENCES visitors(visitor_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  message_count INTEGER DEFAULT 0
);

-- 3. Tabla messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabla leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT REFERENCES visitors(visitor_id),
  conversation_id UUID REFERENCES conversations(id),
  email TEXT,
  phone TEXT,
  company TEXT,
  name TEXT,
  project_type TEXT,
  summary TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'lost')),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Funcion para incrementar message_count
CREATE OR REPLACE FUNCTION increment_message_count(conv_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE conversations
  SET message_count = message_count + 1, updated_at = now()
  WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Indices para performance
CREATE INDEX IF NOT EXISTS idx_conversations_visitor ON conversations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_visitor ON leads(visitor_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC);

-- 7. RLS: Bloquear acceso anonimo, permitir service_role
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Politicas: solo service_role puede hacer todo
CREATE POLICY "Service role full access on visitors" ON visitors
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on conversations" ON conversations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on messages" ON messages
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on leads" ON leads
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
