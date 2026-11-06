// تنها مسیرِ ساختِ دیتابیس: نصبِ تازه، ارتقا و بعد از بازیابیِ بکاپ همین یک دستور است.
// compose، CI و `npm run migrate` همگی همین را اجرا می‌کنند.
//   ۱. دیتابیسِ خالی: schema.sql
//   ۲. checksumِ migrationهای اجراشده (حتی وقتی چیزی برای اجرا نیست)
//   ۳. migrationهای اجرانشده، هر کدام در تراکنشِ خودش
//   ۴. create-app-user.sql (idempotent؛ grantها بعد از هر migration تازه می‌شوند)
//   ۵. رمزِ app_user از APP_USER_PASSWORD، اگر ست شده باشد
//
// با نقشِ admin وصل می‌شود، نه app_user: MIGRATION_DATABASE_URL و اگر نبود DATABASE_URL.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// __dirname نه import.meta: در ایمیج همین فایل به dist-scripts/ بیلد می‌شود و عمقش یکی است.
const DB_DIR = join(__dirname, "..", "..", "db");
const MIGRATIONS_DIR = join(DB_DIR, "migrations");

// فایل‌ها خودشان BEGIN;/COMMIT; دارند و اینجا تراکنش را sql.begin باز می‌کند.
// نقطه‌ویرگول لازم است: BEGIN بدون آن بدنه‌ی بلوک DO است و نباید حذف شود.
const withoutTx = (content: string) => content.replace(/^(BEGIN|COMMIT);\s*$/gm, "");
const readSql = (path: string) => withoutTx(readFileSync(path, "utf8"));

function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) fail("MIGRATION_DATABASE_URL تنظیم نشده.");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [role] = await sql<{ rolsuper: boolean; name: string }[]>`
      SELECT rolsuper, rolname AS name FROM pg_roles WHERE rolname = current_user`;
    if (!role.rolsuper) {
      fail(
        `migrate با نقش «${role.name}» اجرا نمی‌شود چون باید نقش بسازد و schema را عوض کند. ` +
        "MIGRATION_DATABASE_URL را روی نقشِ admin (POSTGRES_USER) بگذارید؛ اپ با app_user می‌ماند.",
      );
    }

    const [state] = await sql<{ empty: boolean; tracked: boolean }[]>`
      SELECT to_regclass('public.tenant') IS NULL AS empty,
             to_regclass('public._migrations') IS NOT NULL AS tracked`;
    if (state.empty) {
      console.log("→ دیتابیس خالی است: نصبِ schema.sql");
      await sql.begin((tx) => tx.unsafe(readSql(join(DB_DIR, "schema.sql"))));
    } else if (!state.tracked) {
      // دیتابیسِ قدیمی‌تر از سیستم migration: 0002 جدول را می‌سازد و پایین ثبت می‌شود.
      await sql.begin((tx) => tx.unsafe(readSql(join(MIGRATIONS_DIR, "0002_migrations_table.sql"))));
    }

    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort()
      .map((filename) => {
        const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
        return {
          id: Number(filename.slice(0, 4)),
          name: filename.slice(5, -4),
          filename,
          content,
          checksum: createHash("sha256").update(content).digest("hex"),
        };
      });

    const applied = await sql<{ id: number; checksum: string }[]>`SELECT id, checksum FROM _migrations`;
    for (const a of applied) {
      const m = all.find((x) => x.id === a.id);
      if (m && m.checksum !== a.checksum) {
        fail(`فایل migration «${m.filename}» بعد از اجرا عوض شده. migration اجراشده را تغییر ندهید؛ migration تازه بسازید.`);
      }
    }

    const pending = all.filter((m) => !applied.some((a) => a.id === m.id));
    for (const m of pending) {
      console.log(`→ migration ${m.filename}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(withoutTx(m.content));
        await tx`INSERT INTO _migrations (id, name, checksum) VALUES (${m.id}, ${m.name}, ${m.checksum})`;
      });
    }

    await sql.unsafe(readFileSync(join(DB_DIR, "create-app-user.sql"), "utf8"));
    const password = process.env.APP_USER_PASSWORD;
    if (password) await sql.unsafe(`ALTER ROLE app_user PASSWORD '${password.replaceAll("'", "''")}'`);

    const [unlocked] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_proc
      WHERE prosecdef AND pronamespace = 'public'::regnamespace
        AND NOT coalesce(proconfig::text, '') ~ 'search_path=public, ?pg_temp'`;
    if (unlocked.count > 0) fail(`${unlocked.count} تابع SECURITY DEFINER بدون search_path قفل‌شده است.`);

    console.log(`✓ migrate تمام شد: ${pending.length} migration تازه از ${all.length}.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("✗ migrate شکست خورد:", e instanceof Error ? e.message : e);
  process.exit(1);
});
