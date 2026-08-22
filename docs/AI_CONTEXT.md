# AI_CONTEXT — راهنمای ایجنت‌های AI

> **[../CLAUDE.md](../CLAUDE.md) قانون canonical است** (Claude Code خودکار می‌خواندش). این سند برای هر ابزار AI دیگر (Cursor/Windsurf/Copilot) و برای «قبل از کد چه بپرسم» است. تکرار نمی‌کند؛ اشاره می‌دهد.

## پروژه در سه خط
Vertical SaaS چندمستأجری برای موجودی/رزرو نمایندگان کاشی ایران. قلب سیستم: `available = on_hand − held − allocated − blocked` که هرگز منفی نمی‌شود و `held` همیشه محاسباتی است. بزرگ‌ترین ریسک: IDOR/نشت بین‌تننتی، نه SQLi.

## Hard Constraints (تغییرناپذیر)
- **بدون Vercel/Supabase مدیریت‌شده** (OFAC). دیپلوی self-hosted روی VPS ایران.
- **بدون سرویس/CDN/فونت خارجی در build/runtime** که روی VPS ایران بشکند (مثل `next/font/google`).
- **پول/متراژ integer** (ریال/cm²)، هرگز float.
- **`held` هرگز ستون ذخیره‌شده نیست.**
- **مقیاس هدف = چند ده نماینده.** راه‌حلی که فقط در «۱۰۰۰ نماینده» لازم است (آرشیو/پارتیشن/Redis/CQRS) = over-engineering، رد.

## قبل از نوشتن کد، این‌ها را بپرس
1. این تغییر کدام قانون معماریِ CLAUDE.md را لمس می‌کند؟ (رزرو؟ RLS؟ تفکیک Request/Dispatch؟)
2. آیا به مصاحبه‌ی کارخانه وابسته است؟ (spec ۷) → پیش‌فرض بگذار، هاردکد نکن، nullable نگه‌دار.
3. آیا مسیر پول/موجودی است؟ → تراکنش + قفل `ORDER BY lot_id` + تست روی Postgres واقعی.
4. آیا از فیچرهای «در MVP نیست» (spec ۱) نزدیک می‌شود؟ → اول بپرس.

## Anti-patterns (ممنوع)
- فیلد کش‌شده برای `held` یا هر مقدار مالی بدون لجر پشتش.
- refetch-before-submit؛ optimistic UI برای رزرو.
- باور کردن `tenant_id`/`agent_account_id` از body بدون تأیید در DB.
- بازتعریف اسکیما در ORM (schema.sql منبع حقیقت).
- `bin_location`/قیمتِ دیگران در پاسخِ API نماینده.
- ساده‌کردنِ validation مرز اعتماد، error handlingِ جلوگیرِ از دست‌رفتن داده، یا امنیت.
- **تابع `SECURITY DEFINER` بدونِ `SET search_path`** (Phase 10-post) — سطحِ حمله است.
- **تغییرِ schema با ویرایشِ `schema.sql` در prodِ داده‌دار** — از `db/migrations/` استفاده کن.
- **آپلود بدونِ حذفِ فایل فیزیکی هنگامِ حذفِ رکورد DB** — فایل‌های یتیم انباشته می‌شوند. از `lib/fileCleanup.ts` استفاده کن.

## Output Expectation
- کد اول، توضیح کوتاه بعد. دیفِ کوچک و متمرکز.
- منطق غیربدیهی → یک تست اجراشدنی همراهش.
- قبل از «کار می‌کند» گفتن: واقعاً اجرا/تست کن (tsc + تست مربوطه)، نتیجه را صادقانه گزارش کن.
- تصمیم‌های ساده‌سازی که گوشه‌ای را می‌برند → کامنت `ponytail:` با سقف و مسیر ارتقا.

## Decision Log / Open Questions
منبع واحد: spec بخش ۷ (سؤال‌های باز) و ۱۴ (تصمیم‌های v7.1). این‌جا کپی نمی‌کنیم تا واگرا نشود.

### رفع‌های Phase 10-post (حسابرسیِ خارجی)
این موارد پس از بازبینیِ یک مدل AI دیگر اضافه شدند:
- `SET search_path = public, pg_temp` روی هر چهار تابع `SECURITY DEFINER`.
- ساختارِ `db/migrations/` با `apply.ts` و جدول `_migrations`.
- `lib/fileCleanup.ts` + `removeProductImage` فایل فیزیکی را هم حذف می‌کند.
- Rate limiter دو-حالته: `RATE_LIMIT_BACKEND=memory|postgres`.
- GitHub Actions CI در `.github/workflows/ci.yml`.
- `Dockerfile` + `docker-compose.yml`.
