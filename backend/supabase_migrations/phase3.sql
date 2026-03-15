-- =============================================================================
-- Scout.ai — Complete Schema Migration (Phase 1 + Phase 3 combined)
-- Safe to run on a fresh Supabase project — all statements are idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PHASE 1: Base tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crawl_sessions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    root_url            TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'running',
    config              JSONB,
    user_id             UUID,                 -- FK added after profiles table exists
    pages_visited       INTEGER,
    pages_skipped       INTEGER,
    broken_links_found  INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawled_pages (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id                  UUID        NOT NULL REFERENCES crawl_sessions(id) ON DELETE CASCADE,
    url                         TEXT        NOT NULL,
    url_pattern                 TEXT,
    is_template_representative  BOOLEAN     NOT NULL DEFAULT false,
    status_code                 INTEGER,
    page_title                  TEXT        NOT NULL DEFAULT '',
    dom_hash                    TEXT        NOT NULL DEFAULT '',
    depth                       INTEGER     NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawled_links (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID        NOT NULL REFERENCES crawl_sessions(id) ON DELETE CASCADE,
    from_page_id UUID        REFERENCES crawled_pages(id) ON DELETE SET NULL,
    to_url       TEXT        NOT NULL,
    link_text    TEXT        NOT NULL DEFAULT '',
    status_code  INTEGER,
    link_status  TEXT        NOT NULL DEFAULT 'unknown',
    is_internal  BOOLEAN     NOT NULL DEFAULT true,
    final_url    TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_patterns (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id             UUID        NOT NULL REFERENCES crawl_sessions(id) ON DELETE CASCADE,
    pattern                TEXT        NOT NULL,
    representative_page_id UUID        REFERENCES crawled_pages(id) ON DELETE SET NULL,
    sample_count           INTEGER     NOT NULL DEFAULT 0,
    estimated_total_pages  INTEGER     NOT NULL DEFAULT 0,
    dom_hash               TEXT        NOT NULL DEFAULT '',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_sessions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    root_url          TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'running',
    overall_score     FLOAT,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ,
    crawl_session_id  UUID        REFERENCES crawl_sessions(id) ON DELETE SET NULL,
    user_id           UUID                            -- FK added after profiles table exists
);

CREATE TABLE IF NOT EXISTS page_audits (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_session_id   UUID        NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
    url                TEXT        NOT NULL,
    ui_report          JSONB,
    ux_report          JSONB,
    compliance_report  JSONB,
    seo_report         JSONB,
    overall_score      FLOAT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- PHASE 3: Auth, Profiles, RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. User profiles  (extends auth.users — requires Supabase Auth to be enabled)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Auto-create a profile row on every new Supabase sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 2. Add foreign key constraints + enforce NOT NULL on user_id
--    (Previously nullable until auth was available)
-- -----------------------------------------------------------------------------

-- crawl_sessions: back-fill with a system user or leave existing rows as-is,
-- then enforce NOT NULL for new rows.  In practice, existing dev rows can be
-- left with NULL until a real user is connected.
ALTER TABLE crawl_sessions
    DROP CONSTRAINT IF EXISTS fk_crawl_sessions_user;
ALTER TABLE crawl_sessions
    ADD CONSTRAINT fk_crawl_sessions_user
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE audit_sessions
    DROP CONSTRAINT IF EXISTS fk_audit_sessions_user;
ALTER TABLE audit_sessions
    ADD CONSTRAINT fk_audit_sessions_user
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;


-- -----------------------------------------------------------------------------
-- 3. Row Level Security
-- -----------------------------------------------------------------------------

-- profiles — users read/update only their own row
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their profile" ON profiles;
CREATE POLICY "users own their profile"
    ON profiles
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- crawl_sessions — scope to owning user
ALTER TABLE crawl_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their crawl sessions" ON crawl_sessions;
CREATE POLICY "users own their crawl sessions"
    ON crawl_sessions
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- crawled_pages — accessible via parent crawl_session
ALTER TABLE crawled_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their crawled pages" ON crawled_pages;
CREATE POLICY "users own their crawled pages"
    ON crawled_pages
    USING (
        session_id IN (
            SELECT id FROM crawl_sessions WHERE user_id = auth.uid()
        )
    );

-- crawled_links
ALTER TABLE crawled_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their crawled links" ON crawled_links;
CREATE POLICY "users own their crawled links"
    ON crawled_links
    USING (
        session_id IN (
            SELECT id FROM crawl_sessions WHERE user_id = auth.uid()
        )
    );

-- template_patterns
ALTER TABLE template_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their template patterns" ON template_patterns;
CREATE POLICY "users own their template patterns"
    ON template_patterns
    USING (
        session_id IN (
            SELECT id FROM crawl_sessions WHERE user_id = auth.uid()
        )
    );

-- audit_sessions
ALTER TABLE audit_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their audit sessions" ON audit_sessions;
CREATE POLICY "users own their audit sessions"
    ON audit_sessions
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- page_audits — accessible via parent audit_session
ALTER TABLE page_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own their page audits" ON page_audits;
CREATE POLICY "users own their page audits"
    ON page_audits
    USING (
        audit_session_id IN (
            SELECT id FROM audit_sessions WHERE user_id = auth.uid()
        )
    );


-- -----------------------------------------------------------------------------
-- 4. Helper view: audit history for the dashboard
--    Returns one row per audit_session with page count.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW user_audit_history AS
SELECT
    a.id                  AS audit_session_id,
    a.user_id,
    a.root_url,
    a.status,
    a.overall_score,
    a.started_at,
    a.completed_at,
    a.crawl_session_id,
    COUNT(p.id)::INTEGER  AS page_count
FROM audit_sessions a
LEFT JOIN page_audits p ON p.audit_session_id = a.id
GROUP BY a.id;

-- RLS on the view is inherited from the underlying table; grant SELECT to authenticated users
GRANT SELECT ON user_audit_history TO authenticated;
