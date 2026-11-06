# backups/

بکاپ‌های رمزنگاری‌شده‌ی سرور که `scripts/backup-db.sh` و `scripts/backup-uploads.sh` می‌سازند. هیچ‌کدام وارد git نمی‌شوند.
راهنمای بکاپ و بازیابی: `docs/GO_LIVE.md`. (این پوشه با `_backups/` فرق دارد که اسنپ‌شات پروژه است: `docs/BACKUPS.md`.)

- `daily/`: دیتابیس، `tile_saas_<زمان>.sql.zstd.gpg` با `.sha256`
- `uploads/`: آپلودها، `uploads_<زمان>.tar.zst.gpg` با `.sha256` و `.manifest`
- `status/`: فایل JSON با زمان و حجم آخرین بکاپ، بدون راز. داخل کانتینر web فقط‌خواندنی mount می‌شود و `/api/metrics` آن را نشان می‌دهد.
