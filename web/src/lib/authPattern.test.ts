import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * گاردِ الگوی احراز.
 *
 * دو باگِ واقعی (staff/page.tsx و staff/import/page.tsx) از یک الگوی مشترک آمدند:
 * صفحه‌ای که به‌جای `useContexts()` مستقیم `fetch("/api/me")` می‌زند و خودش دستی
 * role را فیلتر می‌کند. این یا کاربرِ بدونِ context را با اسپینرِ ابدی رها می‌کند
 * (هیچ حالتِ «none» تعریف نشده) یا کاربرِ نقشِ اشتباه را با یک fallback خاموش
 * قبول می‌کند (۴۰۳های پی‌درپی به‌جایِ یک بنرِ تمیز).
 *
 * فقط همین سه فایل مجازند مستقیم به /api/me وصل شوند — بقیه باید از useContexts
 * بگذرند. اگر صفحه‌ی جدیدی این گارد را رد کند، یعنی یا واقعاً استثنا است (اینجا
 * اضافه شود) یا دوباره همان باگ در حالِ تکرار است.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED = new Set([
  "src/lib/useContexts.ts",
  "src/app/page.tsx",       // ریدایرکتِ نقش-آگاهِ ریشه — پیش از اینکه Ctx معنی داشته باشد
  "src/app/login/page.tsx", // مقصدِ بعدِ ورود را از روی نقش تعیین می‌کند، صفحه‌ای رندر نمی‌کند
  // v9: مدیرِ پلتفرم ممکن است هیچ tenant_membershipای نداشته باشد (حسابِ خالص
  // برای ساختِ کارخانه‌ی تازه) — useContexts روی چنین کاربری همیشه state="none"
  // می‌دهد، چون آن هوک ذاتاً برای contextِ tenant طراحی شده، نه فلگِ سراسریِ
  // is_platform_admin. این صفحه از قبل از وجودِ هر tenantی معنا دارد.
  "src/app/platform/tenants/page.tsx",
]);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
}

// الگوی خودِ خطا را می‌گیریم، نه هر اشاره‌ای به "/api/me" (وگرنه همین فایل هم
// چون در پیام‌خطا/کامنت نامش را می‌آورد، به‌اشتباه offender حساب می‌شود).
const CALLS_API_ME = /fetch\(\s*["'`]\/api\/me["'`]/;

test("فقط useContexts/صفحه‌ی ریشه/ورود مستقیم به /api/me وصل می‌شوند", () => {
  const files: string[] = [];
  walk(join(ROOT, "src"), files);

  const offenders = files
    .filter((f) => !ALLOWED.has(f.slice(ROOT.length).replace(/\\/g, "/")))
    .filter((f) => CALLS_API_ME.test(readFileSync(f, "utf8")));

  assert.deepEqual(offenders.map((f) => f.slice(ROOT.length)), [],
    "این فایل‌ها باید از useContexts() استفاده کنند، نه fetch(\"/api/me\") مستقیم");
});
