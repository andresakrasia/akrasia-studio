-- ============================================
-- AKRASIA STUDIO — CMS + Project Manager
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- ==========================================
-- 1. PROJECTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  type TEXT,
  client_name TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'in_production', 'post_production', 'completed', 'delivered')),
  thumbnail TEXT,
  video_url TEXT,
  resolution TEXT,
  aspect TEXT,
  duration TEXT,
  category TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 2. PROJECT_TASKS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_by TEXT NOT NULL DEFAULT 'admin'
    CHECK (created_by IN ('admin', 'ai')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 3. FEED_ENTRIES TABLE (AI_Generation_Live)
-- ==========================================
CREATE TABLE IF NOT EXISTS feed_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'mid'
    CHECK (level IN ('high', 'mid', 'low')),
  source TEXT NOT NULL DEFAULT 'system'
    CHECK (source IN ('admin', 'ai', 'system')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 4. STUDIO_LOGS TABLE (Estudio_Logs)
-- ==========================================
CREATE TABLE IF NOT EXISTS studio_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  log_type TEXT NOT NULL DEFAULT 'info'
    CHECK (log_type IN ('success', 'info', 'warning')),
  source TEXT NOT NULL DEFAULT 'system'
    CHECK (source IN ('admin', 'ai', 'system')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 5. STUDIO_STATS TABLE (Studio_Status)
-- ==========================================
CREATE TABLE IF NOT EXISTS studio_stats (
  key TEXT PRIMARY KEY,
  value INT NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 6. SERVICES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  chat_message TEXT,
  highlighted BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 7. INDICES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_sort ON projects(sort_order);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_feed_entries_active ON feed_entries(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_entries_project ON feed_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_studio_logs_active ON studio_logs(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_logs_project ON studio_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_services_sort ON services(sort_order);

-- ==========================================
-- 8. RLS — Enable + service_role only
-- ==========================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on projects" ON projects;
CREATE POLICY "Service role full access on projects" ON projects
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on project_tasks" ON project_tasks;
CREATE POLICY "Service role full access on project_tasks" ON project_tasks
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on feed_entries" ON feed_entries;
CREATE POLICY "Service role full access on feed_entries" ON feed_entries
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on studio_logs" ON studio_logs;
CREATE POLICY "Service role full access on studio_logs" ON studio_logs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on studio_stats" ON studio_stats;
CREATE POLICY "Service role full access on studio_stats" ON studio_stats
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on services" ON services;
CREATE POLICY "Service role full access on services" ON services
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ==========================================
-- 9. STORAGE BUCKET — project-thumbnails
-- ==========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-thumbnails', 'project-thumbnails', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read access on project-thumbnails" ON storage.objects;
CREATE POLICY "Public read access on project-thumbnails" ON storage.objects
  FOR SELECT USING (bucket_id = 'project-thumbnails');

DROP POLICY IF EXISTS "Service role full access on project-thumbnails" ON storage.objects;
CREATE POLICY "Service role full access on project-thumbnails" ON storage.objects
  FOR ALL USING (bucket_id = 'project-thumbnails' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'project-thumbnails' AND auth.role() = 'service_role');

-- Demonstration data is excluded from production migrations.
-- See seeds/demo.sql (disposable development databases only).

-- ==========================================
-- 15. AUTO-UPDATE updated_at TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated ON projects;
CREATE TRIGGER trg_projects_updated
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_studio_stats_updated ON studio_stats;
CREATE TRIGGER trg_studio_stats_updated
  BEFORE UPDATE ON studio_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
