-- =============================================================================
-- Phase 4: Add screenshot storage to crawled_pages
-- Safe to run multiple times (idempotent).
-- =============================================================================

-- Store the JPEG screenshot captured during crawl (base64-encoded).
-- Nullable — older rows or pages where screenshot failed will be NULL.
ALTER TABLE crawled_pages
    ADD COLUMN IF NOT EXISTS screenshot_b64 TEXT;
