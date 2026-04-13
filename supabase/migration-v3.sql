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

-- ==========================================
-- 10. SEED DATA — Services
-- ==========================================
INSERT INTO services (title, description, icon, chat_message, highlighted, sort_order) VALUES
  ('Direction', 'Direccion creativa con criterio humano e IA', 'movie', 'Me interesa vuestro servicio de direccion creativa', true, 0),
  ('AI Generation', 'Contenido generado y supervisado al 100%', 'auto_fix_high', 'Me interesa saber mas sobre la generacion de contenido con IA', false, 1),
  ('VFX & Post', 'Efectos visuales y postproduccion avanzada', 'layers', 'Me interesa vuestro servicio de VFX y postproduccion', false, 2),
  ('Sound Design', 'Diseno sonoro inmersivo', 'graphic_eq', 'Me interesa vuestro servicio de diseno sonoro', false, 3),
  ('Branded Content', 'Piezas unicas para marcas que quieren destacar', 'campaign', 'Me interesa vuestro servicio de branded content', false, 4)
ON CONFLICT DO NOTHING;

-- ==========================================
-- 11. SEED DATA — Projects
-- ==========================================
INSERT INTO projects (title, slug, type, status, thumbnail, video_url, resolution, aspect, duration, category, sort_order) VALUES
  ('NEON ODYSSEY', 'neon-odyssey', 'Spot publicitario', 'in_production',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuCy8_Pwy45KvXXwMe2zFuBVQx-te4NpVdATxcGvTffOI8VV08UO6wBDUeF1gpT_GmHu2W_fOO0_X0dE9-yYHpGMtXF9heZt-aL4tkJbwIid1qXxspfnHDk1tyLU7F7tsMBnSSQ8MKaViqs0OtqD9PS3WPHLGo0Irn9oJxbxmDIv6SsVpLn6HgKquZIWnT9wJrzJ4HmSm_EuppXH9AmKVdjlbgOKVnUjgGW89ZCYz00wHGnbKF-hffHEZ8hGa_uFapqYBr7ztIFtGgU',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '7680x4320', '2.39:1', '30s', 'commercial', 0),
  ('CITY PULSE', 'city-pulse', 'Videoclip musical', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuBj9IwwXJuP9tM7ew6D6n7ardX95MLNqyelLdOojSKrBtmAhrf-DUlANlTSQWGz82B_k1y_7zgsNGE_K8Yr-emTTU6QCNu_ajR9Qqr86VKLyn7fPB4Y3T8pFATMI4Bo5SwmzhUna-Tb889Rp_KpmMF1uCPyNNY0fJmh9-W_PpOmIRZE7uiaSuHJ4BMWBIflqIHudxLrpnMbkRHSxtAIlE3D8nQBXyksibxZpGOkApq8LIvprpQY4mSVDLY0TPxQeomJ0TYwaRThNe0',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '3840x2160', '16:9', '3:42s', 'music-video', 1),
  ('VOID FRAGMENTS', 'void-fragments', 'Corto experimental', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuA_jahNr4muf_2RPYh7NpX7zXRVhJ7Cxv9N1dzNq4tfnM_0bpndC3rRJW9rZ63-M-mJ5GCnxXce073AjWj_0qJmsviy4cb8COpCgQHanDph1euGaeZb9PGAhIxb9r6Kg9Zuv3XU-rLLWzjx1ZFhmZYSkpQYh6hI-fezL7LlEDrx9-2jX-xVxselfUSkBUHE0zhDTCguBI_PL_H-c9hbtq65bi__hfVPZ09IjraMratEA2FrVqUGcMMCf1I0I_9z9iP7_6umhZjgHqM',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '4096x2160', '1.90:1', '12:00s', 'experimental', 2),
  ('ASCENSION', 'ascension', 'Branded content', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuCy8_Pwy45KvXXwMe2zFuBVQx-te4NpVdATxcGvTffOI8VV08UO6wBDUeF1gpT_GmHu2W_fOO0_X0dE9-yYHpGMtXF9heZt-aL4tkJbwIid1qXxspfnHDk1tyLU7F7tsMBnSSQ8MKaViqs0OtqD9PS3WPHLGo0Irn9oJxbxmDIv6SsVpLn6HgKquZIWnT9wJrzJ4HmSm_EuppXH9AmKVdjlbgOKVnUjgGW89ZCYz00wHGnbKF-hffHEZ8hGa_uFapqYBr7ztIFtGgU',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '7680x4320', '2.39:1', '60s', 'branded', 3),
  ('SIGNAL NOIR', 'signal-noir', 'Fashion film', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuBj9IwwXJuP9tM7ew6D6n7ardX95MLNqyelLdOojSKrBtmAhrf-DUlANlTSQWGz82B_k1y_7zgsNGE_K8Yr-emTTU6QCNu_ajR9Qqr86VKLyn7fPB4Y3T8pFATMI4Bo5SwmzhUna-Tb889Rp_KpmMF1uCPyNNY0fJmh9-W_PpOmIRZE7uiaSuHJ4BMWBIflqIHudxLrpnMbkRHSxtAIlE3D8nQBXyksibxZpGOkApq8LIvprpQY4mSVDLY0TPxQeomJ0TYwaRThNe0',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '3840x2160', '16:9', '45s', 'fashion', 4),
  ('CHROME DREAMS', 'chrome-dreams', 'Documental', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuA_jahNr4muf_2RPYh7NpX7zXRVhJ7Cxv9N1dzNq4tfnM_0bpndC3rRJW9rZ63-M-mJ5GCnxXce073AjWj_0qJmsviy4cb8COpCgQHanDph1euGaeZb9PGAhIxb9r6Kg9Zuv3XU-rLLWzjx1ZFhmZYSkpQYh6hI-fezL7LlEDrx9-2jX-xVxselfUSkBUHE0zhDTCguBI_PL_H-c9hbtq65bi__hfVPZ09IjraMratEA2FrVqUGcMMCf1I0I_9z9iP7_6umhZjgHqM',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '3840x2160', '16:9', '25:00s', 'documentary', 5),
  ('ECHO CHAMBER', 'echo-chamber', 'Instalacion inmersiva', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuCy8_Pwy45KvXXwMe2zFuBVQx-te4NpVdATxcGvTffOI8VV08UO6wBDUeF1gpT_GmHu2W_fOO0_X0dE9-yYHpGMtXF9heZt-aL4tkJbwIid1qXxspfnHDk1tyLU7F7tsMBnSSQ8MKaViqs0OtqD9PS3WPHLGo0Irn9oJxbxmDIv6SsVpLn6HgKquZIWnT9wJrzJ4HmSm_EuppXH9AmKVdjlbgOKVnUjgGW89ZCYz00wHGnbKF-hffHEZ8hGa_uFapqYBr7ztIFtGgU',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '4096x2160', '1.90:1', 'Loop', 'installation', 6),
  ('SILICON DAWN', 'silicon-dawn', 'Branded content', 'completed',
   'https://lh3.googleusercontent.com/aida-public/AB6AXuBj9IwwXJuP9tM7ew6D6n7ardX95MLNqyelLdOojSKrBtmAhrf-DUlANlTSQWGz82B_k1y_7zgsNGE_K8Yr-emTTU6QCNu_ajR9Qqr86VKLyn7fPB4Y3T8pFATMI4Bo5SwmzhUna-Tb889Rp_KpmMF1uCPyNNY0fJmh9-W_PpOmIRZE7uiaSuHJ4BMWBIflqIHudxLrpnMbkRHSxtAIlE3D8nQBXyksibxZpGOkApq8LIvprpQY4mSVDLY0TPxQeomJ0TYwaRThNe0',
   'https://www.youtube.com/embed/dQw4w9WgXcQ', '3840x2160', '16:9', '45s', 'branded', 7)
ON CONFLICT (slug) DO NOTHING;

-- ==========================================
-- 12. SEED DATA — Studio Stats
-- ==========================================
INSERT INTO studio_stats (key, value, label) VALUES
  ('active_projects', 3, 'Proyectos en curso'),
  ('pieces_delivered', 24, 'Piezas entregadas'),
  ('active_clients', 7, 'Clientes activos')
ON CONFLICT (key) DO NOTHING;

-- ==========================================
-- 13. SEED DATA — Feed Entries
-- ==========================================
INSERT INTO feed_entries (text, level, source) VALUES
  ('Render 4K finalizado — NEON ODYSSEY', 'high', 'system'),
  ('Color grade exportado — ASCENSION', 'mid', 'system'),
  ('Sesion de cliente iniciada', 'low', 'system'),
  ('Generacion de frames IA — VOID FRAGMENTS', 'high', 'system'),
  ('Composite VFX completo — CITY PULSE', 'mid', 'system'),
  ('Audio master procesado — SIGNAL NOIR', 'mid', 'system'),
  ('Upscale 8K completado', 'high', 'system'),
  ('Pre-produccion iniciada — nuevo proyecto', 'low', 'system'),
  ('Motion tracking finalizado', 'mid', 'system'),
  ('Exportacion HDR — CHROME DREAMS', 'high', 'system');

-- ==========================================
-- 14. SEED DATA — Studio Logs
-- ==========================================
INSERT INTO studio_logs (text, log_type, source) VALUES
  ('Render 4K finalizado — NEON ODYSSEY', 'success', 'system'),
  ('Color grade exportado — ASCENSION', 'info', 'system'),
  ('Nuevo proyecto en cola', 'warning', 'system'),
  ('Render 4K finalizado — CITY PULSE', 'success', 'system'),
  ('Motor de IA sincronizado', 'success', 'system'),
  ('Sesion de cliente iniciada', 'info', 'system'),
  ('Exportacion HDR completada', 'success', 'system'),
  ('VFX composite renderizado — VOID FRAGMENTS', 'info', 'system'),
  ('Backup automatico completado', 'info', 'system'),
  ('Audio mix finalizado — SIGNAL NOIR', 'success', 'system'),
  ('Pipeline de IA recalibrado', 'warning', 'system'),
  ('Cliente nuevo registrado', 'info', 'system');

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
