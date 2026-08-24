# KNOWN-WARNINGS — هشدارهای ثبت‌شده

> این فایل هشدارهای شناخته‌شده‌ای را ثبت می‌کند که در build/CI/runtime دیده می‌شوند
> ولی blocker نیستند. هر هشدار باید owner، دلیل، و مسیر پیگیری داشته باشد.
>
> **قاعده:** warning را با failure اشتباه نگیر، اما آن را هم ناپدید نکن.

---

## ۱. Node 20 deprecation در GitHub Actions runner

| مورد | مقدار |
|---|---|
| **هشدار** | `Node 20 is being deprecated. This workflow is running with Node 24 by default.` |
| **منبع** | GitHub Actions runner — از `actions/checkout@v4` و `actions/setup-node@v4` |
| **تأثیر** | فقط warning در CI log — build/test موفق است |
| **Owner** | GitHub Actions team (خارج از کنترل پروژه) |
| **مسیر پیگیری** | منتظر آپدیت actions به Node 22/24 runtime |
| **تصمیم** | workflow ما Node 22 استفاده می‌کند (`node-version: 22`)، ولی actions runner خودش روی Node 20/24 اجرا می‌شود. این هشدار از جانب GitHub است. |
| **آخرین بازبینی** | 2026-08-23 |

---

## ۲. `punycode` module deprecated

| مورد | مقدار |
|---|---|
| **هشدار** | `(node:2337) [DEP0040] DeprecationWarning: The 'punycode' module is deprecated.` |
| **منبع** | Node 22 internal — ماژول `punycode` در Node deprecate شده |
| **تأثیر** | فقط warning — هیچ قابلیتی خراب نمی‌شود |
| **Owner** | Node.js team |
| **مسیر پیگیری** | در upgrade بعدی Node بررسی شود. ممکن است در Node 24 حذف شود. |
| **تصمیم** | بدون عمل. این از وابستگی‌های transitive می‌آید، نه از کد ما. |
| **آخرین بازبینی** | 2026-08-23 |

---

## ۳. `@esbuild-kit/esm-loader` deprecated

| مورد | مقدار |
|---|---|
| **هشدار** | `npm warn deprecated @esbuild-kit/esm-loader@2.6.5: Merged into tsx` |
| **منبع** | `tsx` dependency — esbuild-kit به tsx merge شده |
| **تأثیر** | فقط warning در `npm ci` — نصب موفق است |
| **Owner** | tsx maintainer |
| **مسیر پیگیری** | در upgrade بعدی tsx بررسی شود. `tsx ^4.23.1` فعلی کار می‌کند. |
| **تصمیم** | بدون عمل فعلی. در `npm audit` بعدی بررسی شود. |
| **آخرین بازبینی** | 2026-08-23 |

---

## ۴. `url.parse()` deprecation در Next.js

| مورد | مقدار |
|---|---|
| **هشدار** | `(node:2360) [DEP0169] DeprecationWarning: 'url.parse()' behavior is not standardized` |
| **منبع** | Next.js internal — `url.parse()` در Node deprecate شده |
| **تأثیر** | فقط warning در build — build موفق است |
| **Owner** | Next.js team (Vercel) |
| **مسیر پیگیری** | با upgrade آینده‌ی Next.js (پس از 16.3.0) پیگیری شود |
| **تصمیم** | بدون عمل. این از کد Next.js internal می‌آید، نه از کد ما. |
| **آخرین بازبینی** | 2026-08-23 |

---

## ۵. `proxy.ts` documentation comment says "Middleware"

| مورد | مقدار |
|---|---|
| **هشدار** | کامنت در `proxy.ts` می‌گوید "Middleware با سه مسئولیت" |
| **منبع** | rename از `middleware.ts` به `proxy.ts` |
| **تأثیر** | بدون تأثیر — فقط کامنت |
| **Owner** | پروژه |
| **مسیر پیگیری** | در پاک‌سازی مستندات بعدی اصلاح شود |
| **تصمیم** | بدون عمل فوری. رفتار درست است. |
| **آخرین بازبینی** | 2026-08-23 |

---

## قواعد مدیریت هشدارها

۱. هر warning جدید باید در این فایل ثبت شود.
۲. هر warning باید owner داشته باشد (چه کسی مسئول پیگیری است).
۳. هر warning باید تاریخ آخرین بازبینی داشته باشد.
۴. warning‌ها باید در هر upgrade بررسی شوند.
۵. اگر warning تبدیل به error شد، باید فوراً رفع شود.
