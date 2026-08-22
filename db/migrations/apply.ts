// =============================================================================
// db/migrations/apply.ts — اجرای idempotentِ migrationها
// =============================================================================
// این اسکریپت:
//   ۱. اگر جدول `_migrations` وجود نداشت، migration 0002 را اجرا می‌کند.
//   ۲. همه‌ی migrationهای اجرا‌نشده (با شماره‌ی بالاتر از آخرینِ اجرا‌شده) را
//      به ترتیب، هر کدام در یک تراکنش، اجرا می‌کند.
//   ۳. در صورت شکستِ یک migration، می‌ایستد و migrationهای بعدی اجرا نمی‌شوند.
//
// استفاده:
//   node --env-file=web/.env --import tsx db/migrations/apply.ts
//
// یا با DATABASE_URL از محیط:
//   DATABASE_URL=postgres://... node --import tsx db/migrations/apply.ts
//
// idempotent: اگر دوباره اجرا شود، چیزی اضافه نمی‌کند — فقط migrationهای
// اجرا‌نشده را اجرا می‌کند.
// =============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = new URL("./", import.meta.url).pathname;
const MIGRATION_0002 = join(MIGRATIONS_DIR, "0002_migrations_table.sql");

type MigrationFile = {
  id: number;
  name: string;
  filename: string;
  content: string;
  checksum: string;
};

/**
 * SQL را به statementهای جدا تقسیم کن.
 *
 * مراحل:
 *   ۱. اول کامنت‌های خطی (`-- ...`) را حذف کن — غیر از داخل `$$...$$`.
 *   ۲. بعد بر اساس `;` جدا کن — غیر از داخل `$$...$$`.
 *
 * این ترتیب مهم است: اگر اول split کنی، `;` داخل کامنت‌ها هم به‌عنوان
 * پایان statement شناسه می‌شود و statementهای خالی/ناقص می‌سازد.
 */
function splitSqlStatements(sql: string): string[] {
  // مرحله ۱: اول کامنت‌ها را حذف کن
  const withoutComments = stripComments(sql);

  // مرحله ۲: حالا بر اساس `;` جدا کن (با احترام به `$$...$$`)
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  let i = 0;

  while (i < withoutComments.length) {
    // چک برای `$$` (شروع یا پایان dollar-quote)
    if (withoutComments.substring(i, i + 2) === "$$") {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i += 2;
      continue;
    }

    // چک برای `;` خارج از dollar-quote
    if (withoutComments[i] === ";" && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += withoutComments[i];
    i++;
  }

  // آخرین statement (اگر چیزی مونده)
  const lastTrimmed = current.trim();
  if (lastTrimmed) {
    statements.push(lastTrimmed);
  }

  return statements;
}

/**
 * خط‌هایی که با `--` شروع می‌شوند را حذف کن (commentهای SQL).
 * داخل `$$...$$` را دست نمی‌زنیم.
 *
 * الگوریتم: کاراکتر به کاراکتر پیش برو. در هر لحظه یکی از این حالت‌ها هستی:
 *   - در حالتِ عادی (default)
 *   - در حالتِ dollar-quote (بین $$ و $$)
 *   - در حالتِ line-comment (بعد از -- تا انتهای خط)
 *
 * این روش صحیح‌تر از split-by-line است چون `$$` داخل commentها را به‌عنوان
 * dollar-quote اشتباه نمی‌گیرد.
 */
function stripComments(sql: string): string {
  const chars = [...sql];
  const result: string[] = [];
  let i = 0;
  let inDollarQuote = false;
  let inLineComment = false;

  while (i < chars.length) {
    // چک برای `$$` (dollar-quote)
    if (!inLineComment && sql.substring(i, i + 2) === "$$") {
      inDollarQuote = !inDollarQuote;
      result.push("$$");
      i += 2;
      continue;
    }

    // چک برای `--` (شروع line-comment) — فقط وقتی داخل dollar-quote نیستیم
    if (!inDollarQuote && !inLineComment && sql.substring(i, i + 2) === "--") {
      inLineComment = true;
      i += 2;
      continue;
    }

    // چک برای newline (پایان line-comment)
    if (inLineComment && chars[i] === "\n") {
      inLineComment = false;
      result.push("\n"); // newline را حفظ کن تا ساختار خط‌ها بماند
      i++;
      continue;
    }

    // اگر داخل comment هستیم، chars را skip کن
    if (inLineComment) {
      i++;
      continue;
    }

    // در غیر این صورت، char را اضافه کن
    result.push(chars[i]);
    i++;
  }

  return result.join("");
}

function parseMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((filename) => {
    const match = filename.match(/^(\d{4})_(.+)\.sql$/);
    if (!match) throw new Error(`نام فایل نامعتبر: ${filename}`);
    const id = parseInt(match[1], 10);
    const name = match[2];
    const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    return { id, name, filename, content, checksum };
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL تنظیم نشده.");
    process.exit(1);
  }

  // non-superuser — اپ با همین نقش migration هم می‌زند (نه superuser)
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // ۱. اطمینان از وجودِ جدول `_migrations` — اگر نبود، 0002 را اجرا کن.
    const [exists] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '_migrations'
      ) AS exists`;
    if (!exists.exists) {
      console.log("→ نصبِ جدول `_migrations` (migration 0002)…");
      const content = readFileSync(MIGRATION_0002, "utf8");
      await sql.unsafe(content);
      // درجِ رکورد برای خودِ 0002
      const checksum = createHash("sha256").update(content).digest("hex");
      await sql`
        INSERT INTO _migrations (id, name, checksum) VALUES (2, 'migrations_table', ${checksum})
        ON CONFLICT (id) DO NOTHING`;
      console.log("✓ جدول `_migrations` ساخته شد.");
    }

    // ۲. خواندنِ آخرین migration اجرا‌شده
    const applied = await sql<{ id: number; name: string; checksum: string }[]>`
      SELECT id, name, checksum FROM _migrations ORDER BY id`;

    // ۳. تشخیصِ migrationهای اجرا‌نشده
    const all = parseMigrations();
    const pending = all.filter(
      (m) => !applied.some((a) => a.id === m.id),
    );

    if (pending.length === 0) {
      console.log("✓ همه‌ی migrationها اجرا شده‌اند — چیزی برای اجرا نیست.");
      return;
    }

    // ۴. هشدار اگر checksum migration اجرا‌شده‌ای تغییر کرده
    //    سیاست mismatch (VERSION 1):
    //    - migration اجرا‌شده را هرگز تغییر نده — migration تازه بساز.
    //    - اگر تغییر داد، apply.ts با exit(1) می‌ایستد. این fail-loud است.
    //    - دلیل: migrationهای اجرا‌شده در `_migrations` با checksum ثبت شده‌اند.
    //      اگر فایل عوض شود، نمیدانیم کدام نسخه روی prod اجرا شده. باید از backup
    //      برگردانی یا دستی checksum را در `_migrations` اصلاح کنی.
    for (const a of applied) {
      const m = all.find((x) => x.id === a.id);
      if (m && m.checksum !== a.checksum) {
        console.error(
          `✗ فایلِ migration "${m.filename}" پس از اجرا تغییر کرده. ` +
          `این یعنی migrationها به‌عنوان منبعِ حقیقت قابلِ اعتماد نیستند. ` +
          `اگر قصدِ اصلاح دارید، migration تازه بسازید؛ migration اجرا‌شده را تغییر ندهید.`,
        );
        console.error(
          `  اگر عمداً فایل را تغییر داده‌ای و میدانی چه می‌کنی، ` +
          `می‌توانی checksum را در _migrations دستی UPDATE کنی ` +
          `(محتاطانه — ریسکِ drift).`,
        );
        process.exit(1);
      }
    }

    // ۴.۱. سیاست mismatch بین schema.sql و migrations (VERSION 2):
    //    دو منبعِ حقیقت داریم:
    //      - schema.sql: نصبِ تازه (fresh install)
    //      - db/migrations/: تغییراتِ prod
    //    این دو باید همگام بمانند. ولی apply.ts نمی‌تواند خودش schema.sql را
    //    با DB مقایسه کند (نمیداند کدام نسخه روی prod اجرا شده). پس:
    //
    //    قاعده: هر تغییری در schema باید در **هر دو** جا انجام شود:
    //      ۱. در schema.sql (برای نصبِ تازه)
    //      ۲. در یک migration جدید در db/migrations/ (برای prod)
    //
    //    این کار دستی است — apply.ts نمی‌تواند آن را enforce کند. ولی برای
    //    کمک به توسعه‌دهنده، یک هشدار در README نوشته شده. اگر در اینجا
    //    mismatch پیدا شد، باید یک migration جدید بسازی که schema را به
    //    حالتِ صحیح برگرداند.
    //
    //    در آینده می‌توانیم یک تست اضافه کنیم که schema.sql + migrations را
    //    روی دیتابیس تازه اعمال می‌کند و `pg_dump --schema-only` را مقایسه
    //    می‌کند. ولی فعلاً این کار دستی است.

    // ۵. اجرای migrationهای pending — هر کدام در تراکنش جدا
    for (const m of pending) {
      console.log(`→ اعمالِ migration ${m.id} (${m.name})…`);
      await sql.begin(async (tx) => {
        // BEGIN/COMMIT خود فایل را حذف می‌کنیم — tx خودش تراکنش را باز می‌کند
        const cleaned = m.content
          .replace(/^BEGIN;?\s*$/gm, "")
          .replace(/^COMMIT;?\s*$/gm, "");

        // statementها را جدا کن — postgres.js در tx.unsafe با چند statement
        // مشکل دارد، به‌خصوص با `DO $$...$$` که به‌عنوان quote شناخته می‌شود.
        // با `;` جدا می‌کنیم ولی `$$...$$` را حفظ می‌کنیم.
        const statements = splitSqlStatements(cleaned);

        for (const stmt of statements) {
          const trimmed = stmt.trim();
          if (!trimmed || trimmed.startsWith("--")) continue;
          await tx.unsafe(trimmed);
        }

        await tx`
          INSERT INTO _migrations (id, name, checksum) VALUES (${m.id}, ${m.name}, ${m.checksum})`;
      });
      console.log(`✓ migration ${m.id} اعمال شد.`);
    }

    console.log(`\n✓ ${pending.length} migration با موفقیت اعمال شد.`);
  } catch (err) {
    console.error("\n✗ شکست در migration:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
