# DR — Uploads Recovery

> **Severity:** SEV-2 (Major) — اگر uploads volume از بین برود
> **RTO Target:** ۱ ساعت
> **RPO Target:** ۲۴ ساعت
>
> **Runbook:** بازیابی فایل‌های `private/uploads/` از آخرین backup رمزنگاری‌شده.

---

## ۱. Trigger Conditions

- فایل‌های product image در UI نمایش داده نمی‌شوند.
- `private/uploads/` volume حذف شده یا corrupt شده.
- `/api/uploads/[id]` 404 برمی‌گرداند برای فایل‌هایی که باید موجود باشند.
- Docker volume `uploads` از بین رفته.

---

## ۲. Immediate Actions

### ۲.۱. بررسی وضعیت

```bash
ssh root@vps
cd /opt/tile-saas

# بررسی volume
docker compose exec -T web ls -la /app/web/private/uploads/
# انتظار: اگر خالی یا خطا → backup لازم است

# بررسی backup موجود
ls -lh backups/uploads/*.gpg
# انتظار: حداقل یک فایل .tar.zst.gpg

# بررسی status file
cat backups/status/uploads-backup-status.json | python3 -m json.tool
```

### ۲.۲. Verify backup

```bash
bash scripts/verify-uploads.sh
# انتظار: exit 0، "Uploads backup file is valid and ready for restore."
```

---

## ۳. Restore Procedure

### ۳.۱. Decrypt و extract به مسیر موقت

```bash
LATEST=$(ls -t backups/uploads/*.gpg | head -1)
echo "Restoring from: ${LATEST}"

# Restore به مسیر ایزوله (نه production مستقیماً)
bash scripts/restore-uploads.sh --test-only
# انتظار: exit 0، "Uploads restore test SUCCEEDED"
```

### ۳.۲. انتقال فایل‌ها به production volume

```bash
# مسیر restored فایل‌ها
RESTORED_DIR="private/uploads_restore_test/uploads"

# بررسی فایل‌ها
ls -la "${RESTORED_DIR}/"
FILE_COUNT=$(find "${RESTORED_DIR}" -type f | wc -l)
echo "Files to restore: ${FILE_COUNT}"

# Backup از uploads فعلی (اگر موجود است)
WEB_CONTAINER=$(docker compose ps -q web | head -1)
docker exec "${WEB_CONTAINER}" bash -c "
  if [ -d /app/web/private/uploads ] && [ \"\$(ls -A /app/web/private/uploads 2>/dev/null)\" ]; then
    mv /app/web/private/uploads /app/web/private/uploads.corrupted.$(date +%s)
    echo 'Old uploads backed up as uploads.corrupted.*'
  fi
  mkdir -p /app/web/private/uploads
"

# کپی فایل‌های restored به container
for f in "${RESTORED_DIR}"/*; do
  if [ -f "$f" ]; then
    docker cp "$f" "${WEB_CONTAINER}:/app/web/private/uploads/"
  fi
done

# بررسی
docker exec "${WEB_CONTAINER}" ls -la /app/web/private/uploads/ | head -10
docker exec "${WEB_CONTAINER}" find /app/web/private/uploads -type f | wc -l
```

### ۳.۳. تطبیق با Manifest

```bash
# Verify فایل‌های restored با manifest
MANIFEST=$(ls -t backups/uploads/*.manifest | head -1)

python3 -c "
import json, os, hashlib

with open('${MANIFEST}') as f:
    data = json.load(f)

RESTORE_DIR = '${RESTORED_DIR}'
missing = 0
mismatched = 0
for entry in data['files']:
    path = os.path.join(RESTORE_DIR, entry['path'])
    if not os.path.exists(path):
        print(f'MISSING: {entry[\"path\"]}')
        missing += 1
        continue
    with open(path, 'rb') as fh:
        actual = hashlib.sha256(fh.read()).hexdigest()
    if actual != entry['sha256']:
        print(f'CHECKSUM MISMATCH: {entry[\"path\"]}')
        mismatched += 1

if missing == 0 and mismatched == 0:
    print(f'✅ All {len(data[\"files\"])} files verified successfully')
else:
    print(f'❌ {missing} missing, {mismatched} checksum mismatches')
"
```

### ۳.۴. تطبیق با دیتابیس

```bash
# بررسی orphan files (فایل روی دیسک ولی در DB نیست)
# و missing files (در DB هست ولی روی دیسک نیست)
docker compose exec -T web node --import tsx scripts/cleanup-orphan-uploads.ts
# این dry-run است — اگر orphan زیاد است، بررسی کن چرا
```

---

## ۴. Verification

```bash
# تست دستی: یک عکس محصول در UI باز کن
# تست /api/uploads/[id] برای یک فایل known:
curl -s -o /dev/null -w "%{http_code}" \
  -H "Cookie: session=<valid-session>" \
  http://localhost:3000/api/uploads/<known-uuid>.jpg
# انتظار: 200

# بررسی status file
cat backups/status/uploads-backup-status.json | python3 -m json.tool
# انتظار: restore_test_last_success_at اخیر
```

---

## ۵. Cleanup

```bash
# حذف مسیر restore test
rm -rf private/uploads_restore_test

# حذف corrupted uploads (پس از تأیید restore موفق)
docker exec "${WEB_CONTAINER}" rm -rf /app/web/private/uploads.corrupted.* 2>/dev/null || true
```

---

## ۶. Post-Restore Checklist

```text
[ ] Backup verified (verify-uploads.sh exit 0)
[ ] Files restored to production volume
[ ] Manifest verified (all checksums match)
[ ] DB consistency check (cleanup-orphan-uploads.ts dry-run)
[ ] Manual image load test in UI
[ ] /api/uploads/[id] returns 200 for known file
[ ] Status file updated
[ ] Corrupted old files removed
[ ] Postmortem (if SEV-2)
```

---

## ۷. ارتباط با سایر Runbookها

| Runbook | ارتباط |
|---|---|
| `dr-database-outage.md` | اگر همزمان DB هم خراب باشد |
| `disk-pressure-and-cleanup.md` | اگر uploads volume پر شده باشد |
| `../RESTORE_RUNBOOK.md` | مرجع کامل restore procedure |
| `../BACKUP_POLICY.md` | سیاست backup و retention |
