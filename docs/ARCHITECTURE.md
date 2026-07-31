# ARCHITECTURE

> تصمیم‌های فنی سطح‌بالا + چراییِ‌شان. استدلال‌های عمیق در [../tile-saas-comprehensive-spec.md](../tile-saas-comprehensive-spec.md) (۳ زیرساخت، ۶ الگوریتم، ۸ امنیت، ۱۱ کلاینت، ۱۴ اصلاحات). این سند «as-built» است: چیزی که واقعاً ساخته شده.

## System Context
```
نماینده (موبایل، RTL) ─┐
                        ├─ Next.js (App Router) ── postgres.js ── PostgreSQL (RLS)
staff/انباردار ────────┘        │
                                 └─ pg function user_contexts (SECURITY DEFINER)
پیامک (Outbox) ← worker         SMS provider ایرانی
```

## Module Boundaries (`web/src/`)
| ماژول | مسئولیت | فایل |
|---|---|---|
| `db/client` | اتصال + `withTenant()` که RLS context را `SET LOCAL` می‌کند | [client.ts](../web/src/db/client.ts) |
| `db/reservations` | **الگوریتم رزرو** (قلب سیستم) | [reservations.ts](../web/src/db/reservations.ts) |
| `auth/*` | هش، نشست JWT، **chokepoint دسترسی** | [authz.ts](../web/src/auth/authz.ts) |
| `app/api/*` | route handlerها: auth/login, me, lots, reservations | [api/](../web/src/app/api/) |
| `app/{login,reserve}` | UI نماینده (pending-state، بدون optimistic) | [reserve/page.tsx](../web/src/app/reserve/page.tsx) |

## Data Flow — رزرو (مسیر بحرانی)
1. کلاینت `POST /api/reservations` (بدون refetch-before-submit، pending-state).
2. `currentUserId()` از JWT → `authorizeAgent()` tenant/agent را در برابر DB تأیید (نه از body).
3. `reserve()` در یک تراکنش: idempotency (scope tenant + payload-hash) → قفل balanceها `ORDER BY lot_id FOR UPDATE` → `held=SUM` → `available≥requested` (all-or-nothing) → درج → لجر → COMMIT.
4. `409` اگر موجودی کم بود؛ کلاینت پیام «موجودی فعلی: X» می‌سازد.

## State Management (کلاینت)
- **server state** فقط از API (فعلاً fetch ساده؛ React Query وقتی چند صفحه شد).
- **سبد رزرو** state محلی جدا (فعلاً `useState`؛ Zystand وقتی سبد چند-route شد — spec ۱۱.۴).
- **Pending state، نه Optimistic UI** برای رزرو (spec ۱۱.۱).

## Observability
`@sentry/nextjs` (v10) از طریقِ `instrumentation.ts` + `onRequestError` — خطاهای catch‌نشده در route handler/server component بدونِ دست‌زدن به هر route جداگانه گرفته می‌شوند. هر `authorize*` موفق (`auth/authz.ts`) برچسبِ `tenantId`/`userId` می‌زند (فقط شناسه، هرگز شماره/ایمیل) تا نشتِ بین‌تننتی سریع‌تر قابلِ ردیابی باشد. بدونِ `SENTRY_DSN`، بی‌اثر می‌ماند نه خطا.

## Caching Strategy
فعلاً هیچ. عمداً. `held` همیشه در لحظه محاسبه می‌شود (قانون #۱). کش نمایشی (staleTime کوتاه) وقتی لیست بزرگ شد. Redis رد شد (over-engineering برای این مقیاس).

## Error Handling
- تراکنش‌های موجودی: atomic؛ خطا → ROLLBACK کامل، هرگز نیمه.
- API: کدهای صریح (۴۰۱/۴۰۳/۴۰۹/۴۰۰) — جدول در [API_SPEC.md](API_SPEC.md).
- لاگین: پیام یکسان + هش الکیِ timing-safe (عدم افشای وجود کاربر).

## Deployment Topology
VPS ایران + Docker/PM2 + Nginx/Caddy (HTTPS با Let's Encrypt). Postgres بدون expose مستقیم. بک‌آپ رمزنگاری‌شده خارج از سرور. جزئیات: spec ۳ و ۱۴.۱۰. (DEPLOYMENT_RUNBOOK.md وقتی به دیپلوی رسیدیم ساخته می‌شود.)

## Trade-offs (چرا این، نه آن)
| انتخاب | به‌جای | چرا |
|---|---|---|
| raw SQL برای مسیر قفل | Drizzle query-builder | صراحتِ `FOR UPDATE`/`ORDER BY`؛ ابهام=باگ |
| Drizzle فقط introspect | بازتعریف ۲۵ جدول در TS | schema.sql منبع حقیقت؛ تکرار=دو منبع حقیقت |
| `SELECT FOR UPDATE` | Redis/OCC | مقیاس چند ده نماینده؛ قفل ردیفی کافی |
| RLS + composite FK **با هم** | یکی | RLS نرم (session)، FK سخت (DB)؛ مکمل |
| JWT در کوکی HttpOnly | session در DB | ساده، بدون state سمت سرور برای MVP |

## Assumptions
- Postgres 16+ (برای `NULLS NOT DISTINCT` احتمالیِ import، `gen_random_uuid`).
- اپ با نقش non-superuser وصل می‌شود.

## Open Questions
- React Query کِی لازم می‌شود؟ (وقتی چند صفحه‌ی server-state داشتیم.)
- worker انقضا/پیامک: کران‌جاب یا صف؟ (spec ۹ می‌گوید worker ساده کافی است.)

## Decision Log
- `partially_converted` حذف شد (ناسازگار با held) — spec ۱۴.۱.
- idempotency = `UNIQUE(tenant_id,key)` + payload-hash — spec ۱۴.۴.
- font سیستمی به‌جای `next/font/google` (تاب‌آوری VPS ایران).
