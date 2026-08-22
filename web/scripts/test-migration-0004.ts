// =============================================================================
// scripts/test-migration-0004.ts — تستِ واقعی migration 0004 روی PGlite
// =============================================================================
// این اسکریپت نشان می‌دهد که migration 0004 روی یک دیتابیسِ واقعی (PGlite،
// PostgreSQL در WASM) کار می‌کند.
//
// نکته: PGlite از pgcrypto پشتیبانی نمی‌کند، پس نمیتوانیم کل schema.sql را
// اجرا کنیم. به‌جای آن، فقط چهار تابعِ SECURITY DEFINER را با حالتِ قدیمی
// (بدون search_path) می‌سازیم، بعد migration 0004 را اجرا می‌کنیم، و در نهایت
// چک می‌کنیم که search_path اضافه شده باشد. این دقیقاً همان سناریوی production
// است: دیتابیس موجود با توابعِ قدیمی + migration 0004 که با CREATE OR REPLACE
// آن‌ها را آپدیت می‌کند.
//
// اجرا:
//   cd web && node --import tsx scripts/test-migration-0004.ts
// =============================================================================

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

async function main() {
  console.log("🔧 راه‌اندازی PGlite (PostgreSQL در WASM)…");
  const db = new PGlite();

  // ۱. جداولِ لازم برای توابع را بساز (حداقلِ لازم)
  console.log("📄 ساختِ جداولِ پایه…");
  await db.exec(`
    CREATE TABLE tenant (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      default_reservation_ttl_hours INT NOT NULL DEFAULT 24,
      logo_url TEXT,
      sms_config JSONB,
      currency_unit TEXT NOT NULL DEFAULT 'rial',
      track_shade_caliber TEXT NOT NULL DEFAULT 'optional',
      auto_approve_limit BIGINT,
      max_staff INT,
      max_agents INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE app_user (
      id UUID PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      full_name TEXT,
      email TEXT,
      bale_chat_id TEXT,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      session_epoch INT NOT NULL DEFAULT 0,
      is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE tenant_membership (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      user_id UUID NOT NULL REFERENCES app_user(id),
      role TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      can_manage_access BOOLEAN NOT NULL DEFAULT FALSE,
      allowed_pages TEXT[] NOT NULL DEFAULT '{}',
      UNIQUE (tenant_id, user_id)
    );
    CREATE TABLE agent_account (
      id UUID NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      legal_name TEXT NOT NULL,
      code TEXT NOT NULL,
      credit_limit BIGINT,
      price_list_id UUID,
      auto_approve_limit BIGINT,
      assigned_staff_user_id UUID REFERENCES app_user(id),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (tenant_id, code),
      UNIQUE (tenant_id, id)
    );
    CREATE TABLE agent_account_user (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      agent_account_id UUID NOT NULL,
      user_id UUID NOT NULL REFERENCES app_user(id),
      role TEXT NOT NULL,
      UNIQUE (agent_account_id, user_id)
    );
    CREATE TABLE reservation (
      id UUID NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      agent_account_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      idempotency_key TEXT,
      idempotency_request_hash TEXT,
      PRIMARY KEY (id),
      UNIQUE (tenant_id, id)
    );
    CREATE TABLE inventory_lot (
      id UUID NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      variant_id UUID NOT NULL,
      warehouse_id UUID NOT NULL,
      PRIMARY KEY (id),
      UNIQUE (tenant_id, id)
    );
    CREATE TABLE reservation_item (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      reservation_id UUID NOT NULL,
      lot_id UUID NOT NULL,
      quantity_boxes INT NOT NULL
    );
    CREATE TABLE notification_outbox (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenant(id),
      channel TEXT NOT NULL DEFAULT 'sms',
      recipient TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ
    );
  `);
  console.log("✓ جداولِ پایه ساخته شدند.");

  // ۲. توابعِ SECURITY DEFINER را با حالتِ قدیمی (بدون search_path) بساز
  //    — شبیه‌سازیِ دیتابیسِ موجود که هنوز migration 0004 را نگرفته
  console.log("\n📄 ساختِ توابع با حالتِ قدیمی (بدون search_path)…");
  await db.exec(`
    CREATE FUNCTION user_contexts(p_user_id UUID)
    RETURNS TABLE (tenant_id UUID, tenant_name TEXT, agent_account_id UUID, agent_legal_name TEXT, role TEXT,
                   can_manage_access BOOLEAN, allowed_pages TEXT[],
                   assigned_staff_name TEXT, assigned_staff_phone TEXT, currency_unit TEXT)
    LANGUAGE sql SECURITY DEFINER STABLE AS $$
        SELECT t.id, t.name, aa.id, aa.legal_name, tm.role, tm.can_manage_access, tm.allowed_pages,
               su.full_name, su.phone, t.currency_unit
        FROM tenant_membership tm
        JOIN tenant t ON t.id = tm.tenant_id AND t.is_active
        LEFT JOIN agent_account_user aau ON aau.user_id = tm.user_id AND aau.tenant_id = tm.tenant_id
        LEFT JOIN agent_account aa ON aa.id = aau.agent_account_id AND aa.is_active
        LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
        WHERE tm.user_id = p_user_id AND tm.is_active
    $$;

    CREATE FUNCTION expire_due_reservations()
    RETURNS TABLE (tenant_id UUID, variant_id UUID)
    LANGUAGE sql SECURITY DEFINER AS $$
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

    CREATE FUNCTION claim_pending_notifications(p_limit INT, p_max_attempts INT)
    RETURNS TABLE (id UUID, tenant_id UUID, channel TEXT, recipient TEXT, payload JSONB, attempt_count INT)
    LANGUAGE sql SECURITY DEFINER AS $$
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

    CREATE FUNCTION finish_notification(p_id UUID, p_sent BOOLEAN, p_max_attempts INT)
    RETURNS VOID
    LANGUAGE sql SECURITY DEFINER AS $$
        UPDATE notification_outbox
        SET status = CASE WHEN p_sent THEN 'sent'
                          WHEN attempt_count >= p_max_attempts THEN 'failed'
                          ELSE 'pending' END,
            sent_at = CASE WHEN p_sent THEN now() ELSE sent_at END
        WHERE id = p_id;
    $$;

    REVOKE EXECUTE ON FUNCTION user_contexts(UUID) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION expire_due_reservations() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) FROM PUBLIC;
  `);
  console.log("✓ توابعِ قدیمی ساخته شدند.");

  // ۳. وضعیتِ توابع را قبل از migration 0004 چک کن
  console.log("\n🔍 وضعیتِ توابع قبل از migration 0004:");
  const before = await db.query(`
    SELECT proname, proconfig
    FROM pg_proc
    WHERE proname IN ('user_contexts', 'expire_due_reservations',
                      'claim_pending_notifications', 'finish_notification')
    ORDER BY proname
  `);
  for (const row of before.rows as { proname: string; proconfig: string[] | null }[]) {
    const config = row.proconfig;
    console.log(`  - ${row.proname}: ${config ? JSON.stringify(config) : "NULL (خام)"}`);
  }

  // ۴. migration 0004 را اجرا کن
  console.log("\n📄 اجرای migration 0004_lock_definer_search_path.sql…");
  const migrationSql = readFileSync(
    join(ROOT, "db", "migrations", "0004_lock_definer_search_path.sql"),
    "utf8",
  );
  try {
    await db.exec(migrationSql);
    console.log("✓ migration 0004 اجرا شد.");
  } catch (err) {
    console.error("✗ خطا در اجرای migration 0004:", err);
    console.error("  این یعنی assertion شکست خورده یا syntax خطا دارد.");
    process.exit(1);
  }

  // ۵. وضعیتِ توابع را بعد از migration 0004 چک کن
  console.log("\n🔍 وضعیتِ توابع بعد از migration 0004:");
  const after = await db.query(`
    SELECT proname, proconfig, proconfig::text AS proconfig_text
    FROM pg_proc
    WHERE proname IN ('user_contexts', 'expire_due_reservations',
                      'claim_pending_notifications', 'finish_notification')
    ORDER BY proname
  `);
  let allHaveSearchPath = true;
  for (const row of after.rows as { proname: string; proconfig: string[] | null; proconfig_text: string | null }[]) {
    const config = row.proconfig;
    const configText = row.proconfig_text;
    console.log(`  - ${row.proname}: proconfig=${JSON.stringify(config)}, text=${configText}`);
    // proconfig ممکن است فرمت‌های مختلف داشته باشد: ['search_path=public, pg_temp'] یا '{search_path=public, pg_temp}'
    const configStr = Array.isArray(config) ? config.join(",") : (config ?? "");
    const hasSearchPath =
      configStr.includes("search_path=public, pg_temp") ||
      configStr.includes("search_path=public,pg_temp") ||
      (configText ?? "").includes("search_path=public, pg_temp") ||
      (configText ?? "").includes("search_path=public,pg_temp");
    console.log(`    hasSearchPath: ${hasSearchPath}`);
    if (!hasSearchPath) allHaveSearchPath = false;
  }

  // ۶. نتیجه‌ی نهایی
  console.log("\n" + "=".repeat(60));
  if (allHaveSearchPath) {
    console.log("✓ موفقیت: هر چهار تابع SECURITY DEFINER حالا SET search_path دارند.");
    console.log("  migration 0004 روی دیتابیسِ واقعی (PGlite/WASM) کار می‌کند.");
    console.log("  این اثبات می‌کند که CREATE OR REPLACE + assertion درست پیاده شده.");
    process.exit(0);
  } else {
    console.log("✗ شکست: یک یا چند تابع هنوز search_path ندارند.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("خطای غیرمنتظره:", err);
  process.exit(1);
});
