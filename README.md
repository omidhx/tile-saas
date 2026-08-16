# Tile SaaS — پنل موجودی و رزرو نمایندگان کاشی و سرامیک

Vertical SaaS چندمستأجری برای کارخانه‌های کاشی/سرامیک ایران: موجودی + رزرو + درخواست سفارش نماینده‌ها،
به‌جای تماس تلفنی و اکسل روزانه. زنجیره: مشاهده موجودی → رزرو → SalesRequest → تأیید → SalesDispatch → بارگیری.

## منبع حقیقت (این‌ها را کپی نکن، بهشون لینک بده)
| چی | کجا |
|---|---|
| مرجع کامل محصول/معماری/داده (v7.1) | [tile-saas-comprehensive-spec.md](tile-saas-comprehensive-spec.md) |
| قوانین رفتاریِ کدنویسی برای AI | [CLAUDE.md](CLAUDE.md) |
| اسکیمای دیتابیس (منبع حقیقت) | [db/schema.sql](db/schema.sql) |
| اسناد این پوشه | [docs/](docs/) — PRD، ARCHITECTURE، API_SPEC، DATABASE_SCHEMA، CODING_STANDARDS، AI_CONTEXT، KNOWN_ISSUES، ux-wireframes |
| **بکاپ‌های محلی (کجا هستند، چطور برگردانیم)** | [docs/BACKUPS.md](docs/BACKUPS.md) |

## Stack
- **Next.js** (App Router, TypeScript, src-dir) + **postgres.js** + **Drizzle** (فقط introspect؛ اسکیمای SQL منبع حقیقت می‌مونه)
- **PostgreSQL** self-hosted (RLS + composite FK)
- Auth: **jose** (JWT در کوکی HttpOnly) + **bcryptjs**
- تست: `node:test` روی Postgres واقعی در Docker
- میزبانی: **VPS ایران** (تاب‌آوری قطعی اینترنت) — بدون Vercel/Supabase مدیریت‌شده (OFAC). جزئیات: spec بخش ۳.

## راه‌اندازی محلی
```bash
# ۱) دیتابیس (نمونه‌ی یک‌بارمصرف)
docker run -d --name tile_pg -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16-alpine
psql "postgres://postgres:pw@localhost:5432/postgres" -f db/schema.sql

# ۲) اپ
cd web
cp .env.example .env      # DATABASE_URL و AUTH_SECRET را پر کن (AUTH_SECRET حداقل ۳۲ کاراکتر، وگرنه بالا نمی‌آید)
npm install
npm run dev               # http://localhost:3000  → /login → /reserve
```
> اپ باید با نقشِ **non-superuser** به Postgres وصل شه وگرنه RLS بایپس می‌شه (spec ۸/۱۴.۶).

## دستورها (`web/`)
| دستور | کار |
|---|---|
| `npm run dev` | سرور توسعه |
| `npm run build` | بیلد پروداکشن |
| `npm test` | تست یکپارچه (نیازمند `DATABASE_URL` به Postgres تازه) |
| `npm run test:e2e` | e2e با Playwright — مسیرِ حیاتی (ورود→رزرو→تأیید→حواله→بارگیری). خودش DBِ dev را با `seed:dev` بازمی‌سازد و سرور را بالا می‌آورد؛ اولین بار `npx playwright install chromium` لازم است |
| `npm run db:pull` | introspect اسکیمای typed از دیتابیس → `src/db/generated/` |

## ساختار پوشه
```
db/          schema.sql (منبع حقیقت) + test_schema.sql (تست دود)
docs/        اسناد کنترلی (این پوشه)
web/         اپ Next.js
  src/db/      client.ts (withTenant/RLS)، reservations.ts (الگوریتم رزرو)
  src/auth/    password، session، authz (chokepoint IDOR)
  src/app/     login، reserve، api/{auth,me,lots,reservations}
```

## معماری در یک نگاه
نماینده لاگین می‌کند → `/api/me` context را از تابع `user_contexts` می‌گیرد → `/api/lots` موجودیِ قابل‌سفارش
(`available`, نه `on_hand`) را نشان می‌دهد → رزرو با `POST /api/reservations` که از **chokepoint دسترسی**
(`authorizeAgent`) رد و بعد الگوریتم رزرو (قفل `ORDER BY lot_id`, `available≥requested`, all-or-nothing) اجرا می‌شود.
جزئیات: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## وضعیت
اسکلت end-to-end کار می‌کند (لاگین → کاتالوگ → رزرو، همه با تست سبز). کارهای باز: [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) و [CHANGELOG.md](CHANGELOG.md).
