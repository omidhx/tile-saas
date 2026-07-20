# KNOWN_ISSUES

محدودیت‌ها و کارهای باز که **آگاهانه** فعلاً نیستند — تا شفاف بمانند و کسی فکر نکند فراموش شده‌اند. (باگِ فعال نداریم؛ این‌ها gapهای دامنه/پیاده‌سازی‌اند.)

## پیاده‌سازی (ساخته نشده)
| مورد | وضعیت | مرجع |
|---|---|---|
| تأیید SalesRequest (`held→allocated`) | ✅ ساخته و تست‌شده؛ **staff-only** (`authorizeStaff`) | spec ۱۴.۲ |
| SalesDispatch + state machine + `loaded` | ✅ ساخته و تست‌شده؛ create-از-request + loaded + cancel-release، **staff-only** | spec ۱۴.۳ |
| مسیر backorder (محصول ناموجود) | ✅ ساخته و تست‌شده (`createBackorderDispatch`/`setBackorderItemStatus`, `/api/backorders`, پنل staff)؛ کاملاً بیرون از موجودی (تست: on_hand دست‌نخورده، لجر صفر). **باز:** تبدیلِ backorder به in_stock وقتی تولید شد | spec ۵.۶ |
| نقش staff/agent | ✅ `tenant_membership.role` (admin/staff/agent) با CHECK؛ تأیید+حواله staff-only، نماینده ۴۰۳ (unit + e2e). **باز:** تفکیک agent_admin/operator | spec ۱۴.۶ |
| Import اکسل (snapshot) | ✅ ساخته و تست‌شده (`imports.ts`, `/api/imports`, `/staff/import` با پارسِ مرورگریِ SheetJS — فایل به سرور نمی‌رسه). scope-aware zeroing، guardِ below_committed/absent_but_committed، اتمیک، idempotent. **باز:** import_mode=delta (فقط snapshot)، natural-key نهایی وابسته به مصاحبه | spec ۱۴.۵ |
| «رزروهای من» + دکمه‌ی تأیید | ✅ صفحه `/reservations` | — |
| پنل staff (حواله + بارگیری) | ✅ صفحه `/staff` (درخواست‌های تأییدشده → حواله → گذارِ وضعیت) | — |
| سوییچرِ چند-نمایندگی | ✅ `useContexts` + `ContextSwitcher`؛ انتخاب در localStorage می‌ماند (سرور هر درخواست را دوباره authorize می‌کند، پس دست‌کاری‌اش فقط ۴۰۳ می‌دهد). وقتی فقط یک context باشد چیزی نشان داده نمی‌شود | — |
| worker انقضا | ✅ `expire_due_reservations()` + `npm run worker:expire` (cron هر ۱۰-۱۵ دقیقه) | spec ۵.۳ |
| StockAlert + پیامک (Outbox) | ✅ `alerts.ts`/`outbox.ts`، `/api/alerts`، `npm run worker:outbox`. صف‌کردن اتمیک با import، claim-then-send، retry×۵ و dead-letter. **باز:** ارائه‌دهنده‌ی واقعی پیامک (فعلاً `SMS_PROVIDER=log`) | spec ۵.۹ |
| قیمت‌گذاری در UI | جدول‌ها هست، نمایش/تصمیم نه | spec ۵.۷ |

## تصمیم‌های آگاهانه (نه باگ)
- **رزرو lot-based** (نماینده Lot را می‌بیند). auto-pickِ FIFO مقیدِ شید = v2. (spec ۱۴.۱۱)
- **بدون `db/migrations/`** — چون prod نداریم؛ `schema.sql` نصب مرجع است. اولین دیپلوی = ساخت پوشه‌ی migration. (spec ۱۴.۹)
- **بدون آرشیو/پارتیشن رزرو** — مقیاس این پروژه لازمش ندارد؛ index جزئی کافی است. trigger بازبینی: هزاران رزرو فعالِ هم‌زمان. (spec ۱۴.۱۱)
- **بدون Tailwind/React Query/Zustand** — YAGNI تا وقتی چند صفحه/چند-route شد.

## اسنادِ ساخته‌نشده (به‌محض نیاز ساخته می‌شوند)
`SECURITY.md`, `DEPLOYMENT_RUNBOOK.md`, `TESTING_STRATEGY.md`, `DESIGN_SYSTEM.md`, `SEO_PERFORMANCE.md`, `IMPLEMENTATION_PLAN.md`, `openapi.yaml`.
> فعلاً محتوای این‌ها در spec (۸ امنیت، ۳/۱۴.۱۰ دیپلوی) و CODING_STANDARDS/API_SPEC پوشش داده شده. وقتی موضوعشان واقعاً پیش آمد (اولین دیپلوی، اولین اختلاف امنیتی، سیستم دیزاینِ جدی) سندِ مستقلش ساخته می‌شود — تا سندِ کهنه‌ی زودهنگام نداشته باشیم.

## وابسته به مصاحبه‌ی کارخانه (spec ۷)
شید/کالیبر (آیا دیجیتال ثبت می‌شود؟)، snapshot vs delta، برند (product یا lot)، natural key برای import. پیش‌فرضِ تحقیق‌شده دارند، قطعی نیستند.

## محیطی
- تست‌ها Docker می‌خواهند؛ اگر Docker Desktop پایین باشد، تست‌های DB fail می‌دهند (نه باگِ کد).
- CRLF/LF: گیت روی ویندوز warning می‌دهد؛ بی‌اثر.
