# backups/ — بکاپ‌های روزانه‌ی دیتابیس (Phase 8)

این دایرکتوری توسط `scripts/backup-db.sh` پر می‌شود. سه بخش دارد:

```text
backups/
├── daily/         ← فایل‌های بکاپِ رمزنگاری‌شده (هر روز یک فایل .sql.zstd.gpg)
├── status/        ← فایلِ status به‌صورت JSON (metrics اپ آن را می‌خواند)
└── README.md      ← این فایل
```

## daily/

فایل‌های بکاپ با این الگوی نام‌گذاری ساخته می‌شوند:

```text
tile_saas_YYYY-MM-DD_HHMM.sql.zstd.gpg
```

مثال:

```text
tile_saas_2026-08-24_0300.sql.zstd.gpg
```

این فایل‌ها با **symmetric GPG encryption** (passphrase از `BACKUP_GPG_PASSPHRASE`) رمزنگاری می‌شوند و **بدون passphrase قابل بازیابی نیستند**.

## status/

`backup-status.json` — فایل کوچکِ JSON که فقط این فیلدها را دارد (هیچ secret یا path حساسی نه):

```json
{
  "last_success_at": "2026-08-24T03:00:42Z",
  "last_failure_at": null,
  "last_failure_reason": null,
  "last_success_size_bytes": 1234567,
  "last_success_sha256": "abc123...",
  "backup_age_seconds": 86400,
  "restore_test_last_success_at": "2026-08-24T03:15:21Z",
  "restore_test_last_failure_at": null,
  "retention_days": 30
}
```

این فایل به‌صورت read-only داخلِ container وب mount می‌شود تا `/api/metrics` بتواند
آن را در خروجی خودش embed کند. اپلیکیشن فقط می‌خواند — هرگز نمی‌نویسد.

## نگهداری

- فایل‌های `daily/` با retention policy حذف می‌شوند (پیش‌فرض ۳۰ روز).
- `status/backup-status.json` هر بار که backup یا restore-test اجرا می‌شود بازنویسی می‌شود.
- هر دو دایرکتوری در `.gitignore` هستند — `daily/*` و `status/*` هرگز commit نمی‌شوند.

## امنیت

- هیچ‌وقت passphrase را در این دایرکتوری نگذارید.
- فایل‌های `daily/` فقط به‌صورت رمزنگاری‌شده هستند — decrypt فقط در حینِ restore.
- `status/backup-status.json` فقط metadata دارد: timestamp، size، checksum. مسیرِ
  فایل، نام bucket، credentials — هیچ‌کدام در status نیستند.
