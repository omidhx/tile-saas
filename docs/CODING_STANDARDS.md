# CODING_STANDARDS

> قواعدی که AI و انسان هر دو باید رعایت کنند تا کد یک‌دست بماند. قوانین رفتاریِ سطح‌بالا در [../CLAUDE.md](../CLAUDE.md)؛ این سند جزئیاتِ استایل است.

## اصل حاکم: ponytail (کمترین کدِ درست)
ساده‌ترین راه‌حلی که کار می‌کند. قبل از نوشتن: آیا لازم است؟ آیا در همین کد هست؟ آیا stdlib/native/dependencyِ موجود حلش می‌کند؟ فقط بعد، کد جدید. abstractionِ بدون نیاز، factory تک‌محصول، config برای مقدار ثابت — ممنوع.

## TypeScript
- `strict` روشن (پیش‌فرض create-next-app). `any` فقط با دلیل.
- نوع خروجیِ کوئری‌ها را صریح بده (`tx<{...}[]>\`…\``) — postgres.js تایپ را نمی‌داند.
- عدد از DB: `INT` → number، ولی `SUM`/`BIGINT` → **string**؛ با `Number(...)` یا `::int` در کوئری تبدیل کن (این باگ واقعاً رخ داد).

## دیتابیس
- **مسیر قفل/پول با raw SQL** (postgres.js)، نه query-builder — صراحت مهم‌تر از اختصار.
- **schema.sql منبع حقیقت.** جدول را در TS بازتعریف نکن؛ `db:pull` introspect کن.
- **تغییرات prod با migrationهای forward-only در `db/migrations/`** (Phase 10-post) — `apply.ts` رد اجرا را با checksum نگه می‌دارد. `schema.sql` فقط برای نصبِ تازه است.
- هر کار روی داده‌ی tenant داخل `withTenant()` (که `SET LOCAL app.tenant_id` می‌زند). هرگز کوئری دامنه‌ای بیرون آن.
- پول = ریال/BIGINT، متراژ = cm²/INT، زمان = UTC. اعشار فقط در UI.
- **هر تابع `SECURITY DEFINER` باید `SET search_path = public, pg_temp` داشته باشد** (Phase 10-post) — بدونش، تابع در برابرِ search_path injection آسیب‌پذیر است.

## امنیت (هرگز ساده نکن)
- هر endpoint: `currentUserId()` → `authorizeAgent()`. tenant/agent از body باور نمی‌شود.
- ورودی را در مرز اعتماد validate کن. رمز با bcrypt/argon2، هرگز دست‌ساز.
- `bin_location` و قیمتِ نماینده‌ی دیگر هرگز در پاسخِ API نماینده.

## کامپوننت/UI
- سرور component پیش‌فرض؛ `"use client"` فقط وقتی state/eff/event لازم است.
- رزرو: **pending-state، نه optimistic**. بدون refetch-before-submit.
- RTL فارسی (`dir="rtl"`, `lang="fa"`). فونت سیستمی — **بدون `next/font/google`** (fetch خارجی روی VPS ایران می‌شکند). CSS ساده در `globals.css` با CSS variables؛ Tailwind فعلاً نه (YAGNI).

## Error Handling / Logging
- تراکنش‌های موجودی atomic؛ خطا → ROLLBACK کامل، هرگز نیمه.
- کدهای HTTP صریح (API_SPEC). پیام‌های کاربرِ نماینده فارسی و عمل‌گرا.
- لاگِ ساده‌ی سرور کافی است (Prometheus/Grafana رد شد).

## تست (ponytail: هر منطق غیربدیهی یک چکِ اجراشدنی)
- منطق پول/موجودی/امنیت → تست یکپارچه روی Postgres واقعی (Docker)، نه mock.
- `node:test` + `resetSchema()`. بدون framework سنگین مگر لازم شد.
- قبل از commitِ تغییرِ غیربدیهی: `tsc --noEmit` + تست مربوطه سبز.

## Naming
- موجودیت فیزیکی همیشه `lot_id` (نه `inventory_lot_id`).
- سفارش تجاری `SalesRequest` (نه `Invoice`). snake_case در DB، camelCase در TS.

## Git
- کامیتِ کوچک و متمرکز. پیام: `type(scope): summary` + بدنه‌ی «چرا».
- تریلر اجباری: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- push به هر دو mirror (GitLab + GitHub).
- **هر تغییرِ schema با migration در `db/migrations/`** — هرگز `schema.sql` را در prodِ داده‌دار اجرا نکن.

## Assumptions
- Node ۲۲+، Postgres ۱۶+، Docker برای تست محلی.

## Open Questions
- ESLint/Prettier اضافه شود؟ (فعلاً نه؛ وقتی چند مشارکت‌کننده شد.)

## Decision Log
- بدون ORM برای مسیر رزرو (raw SQL) — ARCHITECTURE Trade-offs.
- Migration با checksum (Phase 10-post) — `db/migrations/apply.ts`.
- Rate limiter دو-حالته (Phase 10-post) — `RATE_LIMIT_BACKEND=memory|postgres`.
- SECURITY DEFINER با `SET search_path` (Phase 10-post) — همه‌ی چهار تابع.
