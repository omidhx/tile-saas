# KNOWN_ISSUES

محدودیت‌ها و کارهای باز که **آگاهانه** فعلاً نیستند — تا شفاف بمانند و کسی فکر نکند فراموش شده‌اند. (باگِ فعال نداریم؛ این‌ها gapهای دامنه/پیاده‌سازی‌اند.)

## پیاده‌سازی (ساخته نشده)
| مورد | وضعیت | مرجع |
|---|---|---|
| تأیید SalesRequest (`held→allocated`) | ✅ ساخته و تست‌شده (`salesRequests.ts`, `/api/reservations/:id/approve`)؛ فعلاً بدون role-gate (staff) | spec ۱۴.۲ |
| SalesDispatch + state machine + `loaded` | spec ۱۴.۳، کد نه | — |
| Import اکسل (snapshot) | schema هست، پردازش نه | spec ۱۴.۵ |
| «رزروهای من» + سوییچرِ چند-نمایندگی | UI نه؛ `/api/me` چند context می‌دهد ولی صفحه اولین را می‌گیرد | — |
| صفحه‌های staff/انباردار | نه | — |
| worker انقضا/پیامک (Outbox) | جدول‌ها هست، worker نه | spec ۹ |
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
