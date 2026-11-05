# Migrationها

`db/schema.sql` برای نصب تازه است و هر تغییر schema بعد از آن باید **هم** در `schema.sql` **هم** در یک فایل تازه‌ی این پوشه باشد.
تست‌ها از `schema.sql` می‌سازند و سرور موجود از migration، پس اگر یکی جا بماند، این دو از هم جدا می‌شوند.

## قواعد

1. نام: `NNNN_short_description.sql`. شماره‌ها ترتیبی‌اند و دوباره استفاده نمی‌شوند.
2. فقط رو به جلو. اشتباه را migration بعدی اصلاح می‌کند.
3. فایل اجراشده را عوض نکنید، حتی کامنتش را: checksum آن ثبت شده و `migrate` با خطا می‌ایستد.
4. هر فایل با `BEGIN;` شروع و با `COMMIT;` تمام می‌شود، هر کدام در خط خودش.
5. روی نصب تازه هم اجرا می‌شود، پس باید idempotent باشد (`IF NOT EXISTS` و مانند آن).
6. جدول تازه grant لازم دارد: `db/create-app-user.sql` را به‌روز کنید.

## اجرا

```bash
# با نقش superuser؛ روی سرور خود compose این را انجام می‌دهد.
cd web && MIGRATION_DATABASE_URL=postgres://postgres:...@localhost:5432/tile npm run migrate
```

`web/scripts/migrate.ts` دیتابیس خالی را از `schema.sql` می‌سازد، checksumها را چک می‌کند، migrationهای اجرانشده را می‌زند،
نقش `app_user` و grantها را تازه می‌کند و اگر `APP_USER_PASSWORD` ست باشد رمزش را می‌گذارد. اجرای دوباره چیزی را عوض نمی‌کند.
