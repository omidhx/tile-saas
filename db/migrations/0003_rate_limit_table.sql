-- =============================================================================
-- 0003_rate_limit_table.sql — جدولِ rate limit برای multi-instance
-- =============================================================================
-- وقتی `RATE_LIMIT_BACKEND=postgres` در web/.env باشد، اپ از این جدول به‌جای
-- شمارنده‌ی in-memory استفاده می‌کند. این برای production با چند instance ضروری
-- است چون در غیر این صورت سقفِ rate limit ضرب می‌شود.
--
-- ponytail: Redis برای این مقیاس over-engineering است؛ ولی Postgres که از
-- قبل داریم، می‌تواند همین کار را با یک جدول کوچک انجام دهد.
--
-- نکته: GRANT به `app_user` در این migration نیست (مثل 0002). apply.ts با
-- try/catch این کار را مدیریت می‌کند.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS _rate_limit_hits (
    id      BIGSERIAL PRIMARY KEY,
    key     TEXT NOT NULL,
    hit_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time ON _rate_limit_hits (key, hit_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_id ON _rate_limit_hits (id);

REVOKE ALL ON _rate_limit_hits FROM PUBLIC;

COMMIT;
