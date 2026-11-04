-- =============================================================================
-- 0004_lock_definer_search_path.sql — قفلِ search_path روی توابع SECURITY DEFINER
-- =============================================================================
-- این migration همان تغییری است که در schema.sql برای نصبِ تازه داده شد، ولی
-- برای دیتابیس‌های موجود (که با schema.sql قدیمی ساخته شده‌اند) لازم است.
--
-- چرا CREATE OR REPLACE نه DROP+CREATE: GRANTهای موجود روی توابع حفظ می‌شوند
-- (DROP+CREATE می‌شد از نو GRANT زد). CREATE OR REPLACE فقط بدنه و config را
-- عوض می‌کند، نه مالکیت و grant را.
--
-- چرا این migration حیاتی است: بدون `SET search_path`، هر تابع SECURITY DEFINER
-- خودش سطحِ حمله است. مهاجم با ساختنِ شیء هم‌نام در schemaیِ قابلِ‌نوشتن،
-- می‌توانست تابع را به کدِ خودش هدایت کند (search_path injection).
--
-- اعتبارسنجی: assertion به‌جای `DO $$` (که postgres.js در tx.unsafe با آن
-- مشکل دارد) در `apply.ts` با یک SELECT ساده انجام می‌شود. این کار بعد از
-- اجرای migrationها انجام می‌شود — اگر assertion شکست بخورد، apply.ts exit
-- می‌کند و کاربر متوجه می‌شود.
-- =============================================================================

BEGIN;

-- user_contexts — STABLE است؛ هنگام replace باید حفظ شود.
CREATE OR REPLACE FUNCTION user_contexts(p_user_id UUID)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, agent_account_id UUID, agent_legal_name TEXT, role TEXT,
               can_manage_access BOOLEAN, allowed_pages TEXT[],
               assigned_staff_name TEXT, assigned_staff_phone TEXT, currency_unit TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
    SELECT t.id, t.name, aa.id, aa.legal_name, tm.role, tm.can_manage_access, tm.allowed_pages,
           su.full_name, su.phone, t.currency_unit
    FROM tenant_membership tm
    JOIN tenant t              ON t.id = tm.tenant_id AND t.is_active
    LEFT JOIN agent_account_user aau ON aau.user_id = tm.user_id AND aau.tenant_id = tm.tenant_id
    LEFT JOIN agent_account aa ON aa.id = aau.agent_account_id AND aa.is_active
    LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
    WHERE tm.user_id = p_user_id AND tm.is_active
$$;

CREATE OR REPLACE FUNCTION expire_due_reservations()
RETURNS TABLE (tenant_id UUID, variant_id UUID)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH done AS (
        UPDATE reservation SET status = 'expired'
        WHERE status = 'active' AND expires_at <= now()
        RETURNING id, reservation.tenant_id
    )
    SELECT DISTINCT d.tenant_id, l.variant_id
    FROM done d
    JOIN reservation_item ri ON ri.reservation_id = d.id
    JOIN inventory_lot l ON l.id = ri.lot_id;
$$;

CREATE OR REPLACE FUNCTION claim_pending_notifications(p_limit INT, p_max_attempts INT)
RETURNS TABLE (id UUID, tenant_id UUID, channel TEXT, recipient TEXT, payload JSONB, attempt_count INT)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE notification_outbox SET attempt_count = notification_outbox.attempt_count + 1
    WHERE notification_outbox.id IN (
        SELECT o.id FROM notification_outbox o
        WHERE o.status = 'pending' AND o.attempt_count < p_max_attempts
        ORDER BY o.created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING notification_outbox.id, notification_outbox.tenant_id, notification_outbox.channel,
              notification_outbox.recipient, notification_outbox.payload, notification_outbox.attempt_count;
$$;

CREATE OR REPLACE FUNCTION finish_notification(p_id UUID, p_sent BOOLEAN, p_max_attempts INT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE notification_outbox
    SET status = CASE WHEN p_sent THEN 'sent'
                      WHEN attempt_count >= p_max_attempts THEN 'failed'
                      ELSE 'pending' END,
        sent_at = CASE WHEN p_sent THEN now() ELSE sent_at END
    WHERE id = p_id;
$$;

COMMIT;
