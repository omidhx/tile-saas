// Staging mock DB server — PGlite را روی پورت 5432 (پروتکل PostgreSQL) شبیه‌سازی می‌کند
// این فقط برای staging verification است، نه production
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

// schema.sql را اجرا کن
import { readFileSync } from "node:fs";
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");

await db.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
await db.exec(schema);

// seed: یک tenant، user، agent برای تست
await db.exec(`
  INSERT INTO tenant (id, name, slug) VALUES ('11111111-1111-1111-1111-111111111111', 'Test Factory', 'test');
  INSERT INTO app_user (id, phone, password_hash, full_name) VALUES
    ('a8888888-8888-8888-8888-888888888888', '09120000000', '$2a$12$00000000000000000000000000000000000000000000000000000000', 'Test User');
  INSERT INTO tenant_membership (id, tenant_id, user_id, role, is_active, can_manage_access)
    VALUES ('m1', '11111111-1111-1111-1111-111111111111', 'a8888888-8888-8888-8888-888888888888', 'admin', true, true);
`);

console.log("✓ Staging mock DB ready (PGlite)");
console.log("  Note: PGlite is in-process, not a TCP server.");
console.log("  The Next.js app cannot connect to PGlite via DATABASE_URL.");
console.log("  For real staging, use PostgreSQL 16 via Docker.");
