# AUD-001: Cross-Tenant File Access Analysis

> **وضعیت:** Go-Live Blocker
> **تاریخ:** 2026-08-23
> **روش:** بازرسی کد (static analysis)

## ۱. مدل دسترسی فایل

فایل‌های آپلودشده در `public/uploads/` ذخیره می‌شوند. این پوشه در `middleware.ts` matcher از CSP معاف است:

```
matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|uploads/).*)"]
```

یعنی:
- `uploads/` در Next.js static serving است
- CSP اعمال نمی‌شود
- هیچ authentication check روی GET `/uploads/...` وجود ندارد
- فایل با UUID نام‌گذاری می‌شود (`randomUUID()`)
- URL در `product_image.url` یا `tenant.logo_url` ذخیره می‌شود

## ۲. تهدیدات Cross-Tenant

| سناریو | امکان‌پذیر؟ | شواهد | ریسک |
|---|---|---|---|
| tenant A فایل tenant B را بخواند | ⚠️ بله — اگر UUID را بداند | `uploads/` عمومی است، هیچ auth نیست | متوسط — UUID غیرقابل‌حدس است ولی نشت از طریق log، URL bar، یا referrer ممکن است |
| tenant A فایل tenant B را overwrite کند | ❌ خیر | نام `randomUUID()` — مهاجم نمی‌تواند نام را حدس بزند | — |
| tenant A فایل tenant B را حذف کند | ❌ خیر — فقط `/api/product-images` DELETE با `authorizeStaffPage` | `product-images/route.ts:32` | — |
| فایل از tenant حذف شده، هنوز قابل دسترسی باشد | ⚠️ بله — اگر URL در log یا cache باشد | cleanup script فقط فایل‌های بدون reference را پاک می‌کند | پایین |
| tenant A از طریق shared-catalog به عکس tenant B برسد | ❌ خیر | shared-catalog فقط variantهای tenant خودش را نشان می‌دهد | — |

## ۳. راه‌حل‌های پیشنهادی

### مسیر A: Download Route احراز هویت‌شده (توصیه‌شده برای production)

```typescript
// web/src/app/api/files/[id]/route.ts
// GET /api/files/[id] — احراز هویت + بررسی ownership
```

فایل‌ها در `/private/uploads/` (خارج از `public/`) ذخیره می‌شوند.
دانلود فقط از طریق route احراز هویت‌شده امکان‌پذیر است.
route بررسی می‌کند که فایل متعلق به tenant کاربر است.

### مسیر B: فعلاً قابل زندگی (برای MVP)

وضعیت فعلی قابل زندگی است اگر:
1. UUID به‌عنوان capability token در نظر گرفته شود (نه obscurity)
2. `Referrer-Policy: strict-origin-when-cross-origin` فعال است (هست)
3. `X-Content-Type-Options: nosniff` فعال است (هست)
4. cleanup-orphan-uploads.ts منظم اجرا می‌شود
5. URL فایل هرگز در log یا error message چاپ نشود

**ولی** این جایگزین authorization نیست. برای go-live باید مسیر A پیاده شود یا
accepted risk رسمی ثبت شود.

## ۴. تست‌های لازم (Blocked — نیاز به PostgreSQL)

| Test | نیاز | وضعیت |
|---|---|---|
| tenant A فایل tenant B را از URL بخواند | PostgreSQL + auth | Blocked |
| فایل بدون auth قابل دسترسی باشد | Next.js runtime | Blocked |
| فایل بعد از حذف محصول هنوز قابل دسترسی باشد | PostgreSQL | Blocked |
| cleanup script فایل orphan را پاک کند | PostgreSQL | Blocked |

## ۵. حکم

**Go-Live Blocker** — تا زمانی که:
1. download route احراز هویت‌شده ساخته شود، یا
2. accepted risk رسمی با owner و تاریخ بازبینی ثبت شود
