-- =============================================================================
-- 0003_rate_limit_table.sql — جدولِ rate limit برای multi-instance
-- =============================================================================
-- وقتی `RATE_LIMIT_BACKEND=postgres` در web/.env باشد، اپ از این جدول به‌جای
-- شمارنده‌ی in-memory استفاده می‌کند. این برای production با چند instance ضروری
-- است چون در غیر این صورت سقفِ rate limit ضرب می‌شود (هر پروسه شمارنده‌ی جدا).
--
-- ponytail: Redis برای این مقیاس over-engineering است؛ ولی Postgres که از
-- قبل داریم، می‌تواند همین کار را با یک جدول کوچک انجام دهد.
--
-- چرا tenant-scoped نیست: rate limit سراسری است (per-IP و per-identifier، نه
-- per-tenant). اگر per-tenant شود، یک tenant می‌تواند با ساختِ tenants متعدد
-- rate limit را دور بزند.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS _rate_limit_hits (
    id      BIGSERIAL PRIMARY KEY,
    key     TEXT NOT NULL,
    hit_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ایندکسِ مرکب برای کوئریِ پراستفاده: WHERE key=? AND hit_at > ?
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time ON _rate_limit_hits (key, hit_at);

-- ایندکسِ id برای حذفِ ردیف‌های قدیمی به‌صورتِ batch (HOUSEKEEPING زیر)
CREATE INDEX IF NOT EXISTS idx_rate_limit_id ON _rate_limit_hits (id);

-- فقط نقشِ اپ حقِ نوشتن دارد — نه PUBLIC
REVOKE ALL ON _rate_limit_hits FROM PUBLIC;

-- =============================================================================
-- GRANT صریح برای نقشِ اپ (app_user) — حیاتی برای production
-- =============================================================================
-- بدون این GRANT، وقتی `RATE_LIMIT_BACKEND=postgres` فعال شود، اپ با `app_user`
-- نمی‌تواند INSERT/SELECT/DELETE بزند و fail-open می‌شود — یعنی فیکس امنیتی
-- در production خاموش می‌شود دقیقاً وقتی نقش non-superuser ساخته شده.
--
-- این دقیقاً همان نکته‌ای است که بازبین اشاره کرد: GRANT بعد از CREATE فقط
-- با ALL TABLES کار نمی‌کند؛ باید صریحاً روی این جدول بزنیم.
-- =============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, DELETE ON _rate_limit_hits TO app_user;
        -- sequence هم GRANT می‌شود چون INSERT از BIGSERIAL استفاده می‌کند
        GRANT USAGE, SELECT ON SEQUENCE _rate_limit_hits_id_seq TO app_user;
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- HOUSEKEEPING — پاک‌سازیِ ردیف‌های قدیمی به‌صورتِ دوره‌ای
-- =============================================================================
-- هر delete در checkRatePostgres فقط ردیف‌های همان key را پاک می‌کند. ولی
-- ردیف‌های کلیدهایی که دیگر ضربه نمی‌گیرند، برای همیشه می‌مانند. این کار
-- پاکسازیِ ردیف‌های قدیمی‌تر از ۲۴ ساعت را به cron می‌سپارد:
--
--   DELETE FROM _rate_limit_hits WHERE hit_at < now() - interval '24 hours';
--
-- در cron سرور (اگر Docker worker نیست):
--   0 */6 * * * psql "$DATABASE_URL" -c "DELETE FROM _rate_limit_hits WHERE hit_at < now() - interval '24 hours';"
--
-- در Docker worker (پیشنهادی): یک سرویس housekeeping جدا در docker-compose.yml.
-- (هر ۶ ساعت کافی است — این جدول نباید بزرگ شود چون همه‌ی ردیف‌ها کوتاه‌مدت‌اند.)
-- =============================================================================
