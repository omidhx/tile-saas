# Migration System

این پوشه برای **تغییراتِ schema روی دیتابیسِ production** است.

`db/schema.sql` منبعِ حقیقت است و فقط برای **نصبِ تازه** (day-zero) استفاده می‌شود.
هر تغییری بعد از اولین دیپلوی، باید یک فایلِ migration در همین پوشه باشد.

## قواعد

۱. **نام‌گذاری:** `NNNN_short_description.sql` که `NNNN` شماره‌ی ترتیبی است (مثلاً `0002_add_index.sql`).
   - `0001` رزرو شده برای `schema.sql` هست (همان نصبِ اولیه).
   - شماره‌ها بدونِ gap و بدونِ reuse.
۲. **همیشه forward-only.** ما migrationهای reverse نداریم — اگر اشتباه کردی، migrationِ بعدی اصلاح می‌کند.
۳. **هر migration در یک تراکنش:** فایل با `BEGIN;` شروع و با `COMMIT;` تمام می‌شود (مگر عملیاتی که خارج از تراکنش‌اند مثل `CREATE INDEX CONCURRENTLY`).
۴. **یک migration فقط یک کار می‌کند.** چند تغییرِ بی‌ربط = چند migration.
۵. **هرگز `DROP TABLE` روی جدولِ production نزن** مگر بعد از تأییدِ صریح و بکاپ.
۶. **تستِ migration:** قبل از merge، روی یک کپی از داده‌ی production اجرا و `npm test` سبز.

## جدول ردیابی migrations

این جدول توسط migration `0002` ساخته می‌شود و ردِ اجرای هر migration را نگه می‌دارد.
اپlication هنگام راه‌اندازی، migrationهای اجرا‌نشده را شناسایی می‌کند.

## اجرای migrations

```bash
# روی دیتابیسِ dev (با متغیرِ محیطی DATABASE_URL):
psql "$DATABASE_URL" -f db/migrations/apply.ts

# یا با tsx:
cd web && node --import tsx ../db/migrations/apply.ts
```

`apply.ts`_idempotent است: migrationهای اجراشده را دوباره اجرا نمی‌کند، و در صورت شکست
میانِ یک migration، تراکنش rollback می‌شود و آن migration در جدول ثبت نمی‌شود.

## فهرست migrations

| # | نام | توضیح | تاریخ |
|---|---|---|---|
| 0001 | `schema.sql` (نصبِ اولیه، در ریشه) | تمامِ schema | day-zero |
| 0002 | `0002_migrations_table.sql` | ساختِ جدول `_migrations` برای ردیابی | قبل از go-live |
