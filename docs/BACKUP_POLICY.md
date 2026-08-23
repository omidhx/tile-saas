# BACKUP_POLICY — سیاستِ بکاپ، RPO/RTO و نگهداری

> **منبعِ حقیقت برایِ همه‌ی تصمیم‌های backup/restore.** هر تغییر در RPO، RTO،
> retention، encryption یا off-site باید در این فایل ثبت شود و در `CHANGELOG.md`
> اشاره شود. اسکریپت‌ها (`scripts/backup-db.sh`، `scripts/restore-db.sh`) این
> مقادیر را از متغیرهای محیطی می‌خوانند و این فایل اسنادِ آن مقادیر است.

---

## ۱. اهدافِ بازیابی (Recovery Objectives)

| معیار | مقدار | توضیح |
|---|---|---|
| **RPO** (Recovery Point Objective) | حداکثر ۲۴ ساعت | حداکثر میزانِ داده‌ای که در صورتِ فاجعه از دست می‌رود. |
| **RTO** (Recovery Time Objective) | حداکثر ۲ ساعت | حداکثر زمانی که طول می‌کشد تا سرویس از حالتِ down به حالتِ پذیرشِ ترافیک برگردد. |
| **Retention** | ۳۰ روز | فایل‌های بکاپِ موفق حداقل ۳۰ روز نگهداری می‌شوند. |
| **Restore Test** | هفتگی | حداقل هفته‌ای یک‌بار restore به دیتابیسِ موقت اجرا می‌شود تا اطمینان حاصل شود که بکاپ‌ها قابلِ بازیابی‌اند. |
| **Off-site Copy** | اجباری | حداقل یک کپی از هر بکاپ باید روی storage خارج از VPS اصلی باشد. |

> **تحلیلِ RPO=24h:** این مقدار برایِ Vertical SaaS با چند ده مستأجر و دیتای
> روزانه قابلِ قبول است. اگر به حساسیتِ بیشتری رسیدیم (مثلاً تراکنشِ مالی
> دقیقه‌ای)، باید به WAL archiving + PITR مهاجرت کنیم (بخشِ ۸ را ببینید).

> **تحلیلِ RTO=2h:** این زمان شاملِ diagnosing (۱۵ دقیقه)، provision VPS جدید
> اگر لازم باشد (۳۰ دقیقه)، restore بکاپ (۳۰–۶۰ دقیقه بسته به حجم)، deploy
> application (۱۵ دقیقه)، DNS propagation (تا ۳۰ دقیقه) است.

---

## ۲. محدوده (Scope)

### چیزی که بکاپ گرفته می‌شود

| مورد | روش | توضیح |
|---|---|---|
| **PostgreSQL database** | `pg_dump --format=custom` | تمامِ schema، data، RLS policies، SECURITY DEFINER توابع، _migrations، _rate_limit_hits. |
| **Schema + Data** | یکجا | بکاپ، `schema.sql` و `seed-dev.sql` نیست — داده‌ی واقعیِ production است. |

### چیزی که بکاپ گرفته نمی‌شود (و چرا)

| مورد | چرا نه | استراتژیِ بازیابی |
|---|---|---|
| **Uploaded files** (`private/uploads/`) | اینها volume ماندگارِ Docker هستند. اگر volume از بین برود، فایل‌ها از بین می‌روند. | برای MVP: استراتژیِ مجزا لازم است (rsync periodic یا S3-compatible storage). در فازِ ۹ اضافه خواهد شد. |
| **Application code** | در Git است (GitHub backup به‌عنوان off-site). | `git clone` روی VPS جدید. |
| **Environment variables / secrets** | نباید در بکاپ باشند — راز هستند. | هر VPS جدید باید از secret manager یا `web/.env`手工 منتقل شود. |
| **Caddy/Nginx config** | در Git است (`Caddyfile`). | از Git بازیابی می‌شود. |
| **Docker images** | از `Dockerfile` قابلِ بازتولید. | `docker compose build` روی VPS جدید. |
| **PostgreSQL config** (`postgresql.conf`) | از image پیش‌فرض استفاده می‌شود. | تنظیماتِ custom اگر اضافه شوند، باید در Git باشند. |

> **هشدار:** بکاپ فقط دیتابیس را پوشش می‌دهد. فایل‌های آپلودشده (عکسِ محصول،
> فاکتورها) باید با استراتژیِ جدا پشتیبان شوند. این یک finding ثبت‌شده‌ست:
> **AUD-009** — تا زمانِ راه‌اندازی، در `docs/KNOWN_ISSUES.md` ثبت شده.

---

## ۳. فرکانس و زمان‌بندی

| بکاپ | فرکانس | زمانِ اجرا | طولِ متوسط |
|---|---|---|---|
| Daily DB backup | روزانه | 03:00 IRST (های ایران) | ۵–۳۰ ثانیه (بسته به حجم) |
| Daily uploads backup | روزانه | 03:30 IRST | ۱۰ ثانیه–۵ دقیقه (بسته به تعداد/حجم فایل‌ها) |
| Off-site sync | بعد از هر backup | 04:00 IRST | ۱–۵ دقیقه (بسته به پهنای باند) |
| Cleanup (retention) | روزانه | 04:30 IRST | < ۱ ثانیه |
| Restore test (DB) | هفتگی | یکشنبه 05:00 IRST | ۱–۲ دقیقه |
| Restore test (uploads) | هفتگی | یکشنبه 05:30 IRST | ۳۰ ثانیه–۲ دقیقه |

> **زمان‌بندی با cron یا docker compose؟** اگر از `docker-compose.yml` استفاده
> می‌کنید، **cron روی host** را راه بیندازید (نه داخل container). اسکریپت با
> `docker compose exec postgres pg_dump ...` دیتابیس را dump می‌کند.

### مثالِ crontab (روی host)

```cron
# ───── Daily DB backup at 03:00 IRST ─────
# IRST = UTC+3:30 → 03:00 IRST = 23:30 UTC (day before)
30 23 * * *  cd /opt/tile-saas && bash scripts/backup-db.sh >> /var/log/tile-saas-backup.log 2>&1

# ───── Cleanup old backups at 04:00 IRST ─────
00 00 * * *  cd /opt/tile-saas && bash scripts/cleanup-old-backups.sh >> /var/log/tile-saas-backup.log 2>&1

# ───── Weekly restore test (Sunday 05:00 IRST) ─────
00 01 * * 0  cd /opt/tile-saas && bash scripts/restore-db.sh --test-only >> /var/log/tile-saas-backup.log 2>&1
```

---

## ۴. رمزنگاری (Encryption)

**الگوریتم:** GPG با symmetric AES-256 (passphrase از `BACKUP_GPG_PASSPHRASE`).

**چرا GPG symmetric؟**
- gpg به‌طور گسترده روی Linux/Alpine در دسترس است.
- Symmetric نیاز به مدیریتِ keypair ندارد (simpler for ops).
- Passphrase در یک متغیرِ محیطی محافظت می‌شود.
- برایِ MVP با چند سرور، این کافی است.

**چرا asymmetric (keypair) نه؟**
- برایِ تیم‌های بزرگ که چند اپراتور باید بتوانند decrypt کنند، asymmetric بهتر است.
- در آن حالت، هر اپراتور کلیدِ عمومی خودش را اضافه می‌کند و بکاپ با چند recipient
  رمزنگاری می‌شود. سپس با کلیدِ خصوصیِ هر اپراتور قابلِ decrypt است.
- در فازِ ۹ به asymmetric مهاجرت خواهیم کرد.

> **قانونِ طلایی:** بکاپِ رمزنگاری‌نشده هرگز نباید از VPS خارج شود. اسکریپت
> ابتدا encrypt می‌کند، سپس upload می‌کند. اگر upload fail شود، فایلِ رمزنگاری‌شده
> روی host باقی می‌ماند و فایلِ خام در همان مرحله پاک می‌شود.

---

## ۵. Off-site Storage

هر بکاپ باید حداقل در دو مکان باشد:

1. **Local:** `backups/daily/` روی همان VPS (برایِ restore سریع).
2. **Off-site:** روی یک سرور یا storage جدا — که می‌تواند یکی از این‌ها باشد:
   - سرورِ بکاپِ دوم در data center دیگر
   - S3-compatible storage (MinIO, Wasabi, Backblaze B2, AWS S3)
   - سرویسِ بکاپِ ارائه‌دهنده‌ی هاست ایرانی
   - قفلِ USB یا NAS روی شبکه‌ی داخلیِ شرکت

### متغیرهای محیطیِ Off-site

| متغیر | ضروری | مثال | توضیح |
|---|---|---|---|
| `BACKUP_OFFSITE_TARGET` | ❌ اختیاری | `user@backup.example.com:/backups/tile-saas/` | rsync target. اگر خالی باشد، فقط local ذخیره می‌شود (با warning). |
| `BACKUP_OFFSITE_METHOD` | ❌ | `rsync` | فعلاً فقط rsync. S3 در فازِ ۹. |
| `BACKUP_OFFSITE_SSH_KEY` | ❌ | `/root/.ssh/backup_key` | اگر rsync نیاز به SSH key دارد. |
| `BACKUP_RETENTION_DAYS` | ❌ | `30` | پیش‌فرض ۳۰. |

> **توصیه:** حتی اگر `BACKUP_OFFSITE_TARGET` خالی است (محیطِ تست)، اسکریپت با
> موفقیت تمام می‌شود ولی warning می‌دهد. در production این متغیر حتماً ست شود.

---

## ۶. Verification و Integrity

هر بکاپ بعد از تولید، چهار مرحله verification طی می‌کند:

1. **Size check:** فایل باید non-zero باشد و حداقل ۱ KB داشته باشد.
2. **Checksum:** SHA-256 در همان لحظه محاسبه و در `backup-status.json` ذخیره می‌شود.
3. **Decrypt + format check:** اسکریپت، فایل را decrypt کرده و با `pg_restore --list`
   بررسی می‌کند که یک PostgreSQL dump معتبر است (نه فایلِ خراب).
4. **Off-site copy verification:** اگر rsync اجرا شد، exit code چک می‌شود.

> **Restore test هفتگی** بررسیِ عمیق‌تری است — یک بکاپ را به‌طور کامل restore
> می‌کند و integrity checks اجرا می‌کند (بخشِ ۷ را ببینید).

---

## ۷. Restore Test Procedure

هدف: اثبات اینکه بکاپ واقعاً قابلِ بازیابی است (نه فقط فایلِ معتبر).

```text
┌──────────────────┐
│ Latest Backup   │ ← backups/daily/...sql.zstd.gpg
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Decrypt          │ ← gpg --decrypt
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Restore to temp  │ ← pg_restore into tile_restore_test
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Integrity checks │ ← table count, FK validity, tenant presence
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Smoke queries    │ ← SELECT 1, COUNT(*) FROM app_user, ...
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Drop temp DB     │ ← cleanup
└──────────────────┘
```

### Integrity Checks (حداقل)

| چک | کوئری | مورد انتظار |
|---|---|---|
| Database responsive | `SELECT 1;` | `1` |
| Tables exist | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';` | ≥ ۳۸ جدول |
| Migrations table populated | `SELECT count(*) FROM _migrations;` | ≥ ۴ |
| Tenants exist | `SELECT count(*) FROM tenant;` | ≥ ۱ |
| Platform admin exists | `SELECT count(*) FROM app_user WHERE is_platform_admin;` | ≥ ۱ |
| FK constraints valid | `SET session_replication_role='replica'; SELECT count(*) FROM ...; RESET;` | بدون خطا |
| Critical tables non-empty (sample) | `SELECT count(*) FROM app_user; SELECT count(*) FROM tenant;` | مطابقِ snapshot |

### Smoke Queries (برایِ application-level)

```sql
-- تابعِ SECURITY DEFINER کار می‌کند؟
SELECT * FROM user_contexts('00000000-0000-0000-0000-000000000000');
-- (می‌تواند خالی باشد ولی نباید error بدهد)

-- RLS policies نصب هستند؟
SELECT count(*) FROM pg_policy;
-- (باید ≥ ۱ باشد)

-- _rate_limit_hits جدول وجود دارد؟
SELECT count(*) FROM _rate_limit_hits;
```

---

## ۸. مسیرِ ارتقا (Upgrade Path)

مدلِ فعلی (pg_dump روزانه) برایِ RPO=24h کافی است. اگر به RPOی کوچک‌تر نیاز شد:

### مرحله‌ی بعد: WAL Archiving + PITR

```text
postgresql.conf:
  archive_mode = on
  archive_command = 'test ! -f /backups/wal/%f && cp %p /backups/wal/%f'
  archive_timeout = '5min'
```

- **مزیت:** RPO به چند دقیقه کاهش می‌یابد (به‌اندازه‌ی `archive_timeout`).
- **هزینه:** نیاز به storage بیشتر، مانیتورینگِ WAL archiving، restore procedure پیچیده‌تر.
- **زمانِ پیشنهادی:** وقتی به >۱۰۰ مستأجر رسیدیم یا تراکنشِ مالیِ حساس اضافه شد.

### مرحله‌ی بعدِ بعد: Replication (Standby)

- یک PostgreSQL standby (streaming replication) روی VPS دوم.
- در صورتِ failover، standby را به primary ارتقا می‌دهیم.
- RTO به چند دقیقه کاهش می‌یابد.
- **هزینه:** VPS دوم، setup پیچیده‌تر، split-brain ریسک.

> **تصمیمِ فعلی:** pg_dump روزانه برایِ MVP کافی است. WAL/PITR و Replication
> در فازِ ۹ یا ۱۰ بررسی می‌شود. این تصمیم در `MEMORY.md` ثبت شده.

---

## ۹. مسئولیت‌ها (Roles & Responsibilities)

| نقش | مسئولیت |
|---|---|
| **On-call engineer** | پاسخ به alertهای backup failure، اجرایِ restore در صورتِ فاجعه. |
| **Platform admin** | نگهداریِ passphrase، تنظیمِ `BACKUP_GPG_PASSPHRASE` روی VPS، دسترسی به off-site storage. |
| **DBA / Ops** | وارسیِ هفتگیِ restore test results، به‌روزرسانیِ این سند در صورتِ تغییر. |
| **All engineers** | آگاهی از این سند، reporting هرگونه تغییرِ رفتاری در backup. |

> **Passphrase باید در محلِ امن نگهداری شود:** password manager، vault، یا حداقل
> در دو نفرِ قابلِ اعتماد پخش شود. اگر passphrase گم شود، همه‌ی بکاپ‌ها قابلِ
> بازیابی نیستند.

---

## ۱۰. Secret Management — ذخیره‌سازیِ امنِ Passphrase و SSH Keys

این بخش مهم‌ترین قسمتِ امنیتیِ فاز ۸ است. اگر passphrase یا SSH key لو برود،
مهاجم می‌تواند بکاپ‌ها را decrypt کند یا به storage off-site دسترسی پیدا کند.

### ۱۰.۱ Passphrase (`BACKUP_GPG_PASSPHRASE`)

**کجا نگهداری شود:**

| محل | مناسب؟ | توضیح |
|---|---|---|
| Password manager (1Password، Bitwarden، KeePass) | ✅ | بهترین گزینه — encrypted at rest، share بینِ team members. |
| Vault (HashiCorp Vault، AWS Secrets Manager) | ✅ | برایِ enterprise — auto-rotation، audit log. |
| `.env` روی VPS production | ⚠️ | قابلِ قبول فقط اگر VPS hardened است و فقط ۱–۲ نفر root دارند. |
| Git repository | ❌ | هرگز — حتی private repo. |
| Slack/email/chat | ❌ | هرگز — ممکن است لاگ شود. |
| همان VPS که دیتابیس روش اجرا می‌شود (بدون encryption) | ❌ | اگر VPS هک شود، بکاپ هم لو می‌رود. |

**قوانین:**
- حداقل ۳۲ کاراکتر — `openssl rand -base64 32` برایِ تولید.
- حداقل دو نفر باید به آن دسترسی داشته باشند (bus factor).
- در صورتِ suspicion به leak — فوراً rotation: passphrase جدید، re-encrypt همه‌ی بکاپ‌های موجود، delete بکاپ‌های قبلی.
- هرگز در logs، console، error messages چاپ نشود — اسکریپت‌ها از `--passphrase-fd 0` استفاده می‌کنند و `set -x` را رد می‌کنند (defense-in-depth).

### ۱۰.۲ SSH Key برایِ rsync off-site (`BACKUP_OFFSITE_SSH_KEY`)

**قوانین:**
- کلیدِ اختصاصی برایِ backup — نه کلیدِ root یا کلیدِ production.
- Passphrase روی کلید: اختیاری ولی توصیه می‌شود (اگر `ssh-agent` اجرا می‌شود).
- Permission فایل کلید: `0600` یا `0400` (ssh در غیر این صورت رد می‌کند).
- کلیدِ عمومی روی سرورِ off-site در `~/.ssh/authorized_keys` — با restriction:
  ```
  # در ~/.ssh/authorized_keys روی سرورِ backup:
  command="rsync --server -vlogDtprze.iLs --timeout=300 . /backups/tile-saas/",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding ssh-ed25519 AAAA... backup@tile-saas-prod
  ```
  این جلویِ اجرایِ دستورهای دیگر را می‌گیرد — حتی اگر کلید لو شود، مهاجم فقط می‌تواند به `backups/tile-saas/` فایل بنویسد.
- rotation: سالانه یا در صورتِ suspicion.

### ۱۰.۳ `POSTGRES_PASSWORD`

- در `.env` روی VPS production — فقط root خوانده می‌شود.
- در password manager (برایِ restore در VPS جدید).
- هرگز در backup file ذخیره نمی‌شود (pg_dump با `--no-owner --no-privileges` گرفته می‌شود).

### ۱۰.۴ Audit Checklist (هفتگی)

```text
[ ] BACKUP_GPG_PASSPHRASE در password manager موجود است؟
[ ] حداقل دو نفر به passphrase دسترسی دارند؟
[ ] SSH key backup فقط permission 0600 دارد؟
[ ] SSH key backup در authorized_keysِ سرورِ off-site با command= restriction است؟
[ ] هیچ passphrase یا password در git نیست؟ (grep -r 'BACKUP_GPG_PASSPHRASE' .)
[ ] فایل‌های .gpg و .sha256 در backups/daily/ فقط 0600 هستند؟
[ ] status file (backup-status.json) 0644 است و هیچ secret ندارد؟
[ ] در لاگ‌های آخرین هفته هیچ passphrase چاپ نشده؟
```

---

## ۱۱. خطوطِ پایانی

- این سند با هر تغییرِ RPO/RTO/retention به‌روزرسانی می‌شود.
- تغییرات در `CHANGELOG.md` اشاره می‌شوند.
- اسکریپت‌ها مقادیر را از env vars می‌خوانند — این سند اسنادِ آن مقادیر است.
- در صورتِ تناقضِ بینِ سند و کد، کد حاکم است ولی bug گزارش می‌شود.
- **اگر passphrase گم شود:** همه‌ی بکاپ‌ها قابلِ بازیابی نیستند. این ریسکِ پذیرفته‌شده‌ست و در بخشِ ۹ مستند شده.

---

## ۱۲. Phase 9 — Backup فایل‌های private/uploads/ (AUD-009)

### ۱۲.۱. زمینه

فایل‌های آپلودشده (عکسِ محصول، لوگو، فاکتور) در `private/uploads/` ذخیره
می‌شوند — روی Docker named volume (`uploads`)، جدا از کدِ اپلیکیشن. اگر این
volume خراب شود یا حذف شود، همه‌ی فایل‌ها از بین می‌روند. backup دیتابیس
این فایل‌ها را پوشش **نمی‌دهد** — فقط `product_image.url`، `product.image_url`
و `tenant.logo_url` در دیتابیس ذخیره می‌شوند (نه خودِ فایل‌ها).

**AUD-009:** این شکافِ Disaster Recovery بود. Phase 9 آن را رفع می‌کند.

### ۱۲.۲. استراتژی

مدلِ انتخاب‌شده: **tar + zstd + GPG + manifest + checksum**

```text
private/uploads/  →  tar (داخل container)  →  zstd -19  →  GPG AES-256  →  .gpg file
                                                                              + .sha256
                                                                              + .manifest (JSON)
```

این مدل همان الگوی backup دیتابیس است (Phase 8) — تفاوت‌ها:
- به‌جای `pg_dump`، از `tar` استفاده می‌شود.
- manifest اضافی تولید می‌شود (لیستِ فایل‌ها با size و checksum هرکدام).
- restore به مسیرِ ایزوله‌ی `private/uploads_restore_test/` انجام می‌شود (نه production).

### ۱۲.۳. artifact

هر backup شامل ۴ فایل است:

```text
backups/uploads/
├── uploads_YYYY-MM-DD_HHMM.tar.zst.gpg      ← encrypted backup
├── uploads_YYYY-MM-DD_HHMM.tar.zst.gpg.sha256  ← checksum
├── uploads_YYYY-MM-DD_HHMM.manifest         ← JSON: file list + individual checksums
└── uploads_YYYY-MM-DD_HHMM.tar.zst.gpg.sha256 (همان checksum file)
```

**manifest format (JSON):**

```json
{
  "backup_name": "uploads_2026-08-24_0330",
  "created_at": "2026-08-24T03:30:00Z",
  "file_count": 42,
  "files": [
    {
      "path": "abc123-def456.jpg",
      "size": 102400,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "mtime": 1724473800
    }
  ]
}
```

### ۱۲.۴. اسکریپت‌ها

| اسکریپت | کاربرد |
|---|---|
| `scripts/backup-uploads.sh` | ایجاد backup از private/uploads/ (داخل container) |
| `scripts/verify-uploads.sh` | verify بدونِ restore کامل (decrypt + tar --list + manifest check) |
| `scripts/restore-uploads.sh` | restore به مسیرِ ایزوله‌ی `private/uploads_restore_test/` |
| `scripts/cleanup-old-uploads-backups.sh` | retention policy enforcement |

همه‌ی اسکریپت‌ها از الگوی backup دیتابیس پیروی می‌کنند:
- `set -euo pipefail`
- flock (concurrency guard)
- `BACKUP_TEST_MODE` + `BACKUP_TEST_HOLD_SECONDS` (test hook)
- `CLEANUP_DONE` guard (double-cleanup prevention)
- signal handlers با `128 + signal_number` exit codes
- passphrase via `--passphrase-fd 0` (نه argv)
- `set +o history` (anti-leak)
- `chmod 600` برای .gpg/.sha256/.manifest
- `chmod 0644` برای status file

### ۱۲.۵. consistency دیتابیس و فایل‌ها

backup دیتابیس و backup فایل‌ها باید از نظر زمانی تا حد امکان سازگار باشند.
این پروژه از الگوی زیر استفاده می‌کند:

1. **backup دیتابیس** ساعت ۰۳:۰۰ اجرا می‌شود.
2. **backup uploads** ساعت ۰۳:۳۰ اجرا می‌شود (۳۰ دقیقه بعد).
3. اگر فایلی بین این دو زمان آپلود شود:
   - در backup uploads خواهد بود (دیرتر).
   - در backup دیتابیس **نخواهد بود** (زودتر).
   - این حالت "تقریباً سازگار" است — restore دیتابیس + uploads به نقطه‌ی
     زمانیِ uploads، یک فایلِ orphan در filesystem ایجاد می‌کند که در DB
     reference ندارد. `cleanup-orphan-uploads.ts` این را پاک می‌کند.

اگر سازگاریِ دقیق لازم باشد (مثلاً برای فاکتورهای مالی):
- application باید در حالتِ maintenance قرار گیرد.
- یا snapshot filesystem (LVM، ZFS) استفاده شود.
- این over-engineering برای MVP فعلی است و در فازِ ۱۰ بررسی می‌شود.

### ۱۲.۶. restore به production

restore به production (نه restore test) نیاز به این مراحل دارد:

1. تأییدِ checksum artifact (`.sha256`)
2. تأییدِ passphrase (decrypt test)
3. بررسی manifest (تعداد فایل‌ها)
4. بررسی فضای دیسک کافی
5. تأییدِ مسیرِ مقصد (`private/uploads/`، نه مسیرِ اشتباه)
6. تأییدِ عدمِ path traversal در tar entries
7. استخراج tar به مسیرِ موقت (مثلاً `private/uploads_restored/`)
8. بررسیِ integrity (file count، MIME types، extensions)
9. بررسیِ تطبیقِ فایل‌ها با رکوردهای دیتابیس
10. swap: `mv private/uploads private/uploads.old && mv private/uploads_restored private/uploads`
11. تأییدِ application
12. پاک‌سازیِ `private/uploads.old`

این مراحل در `docs/UPLOADS_RESTORE_RUNBOOK.md` مستند شده‌اند.

### ۱۲.۷. محدودیت‌های فعلی

- **runtime verification pending:** اسکریپت‌ها به Docker نیاز دارند — CI فقط
  تستِ static انجام می‌دهد. staging و production runtime هنوز اجرا نشده‌اند.
- **consistency تقریبی:** backup دیتابیس و uploads در زمان‌های متفاوت گرفته
  می‌شوند (۳۰ دقیقه فاصله). این برای MVP قابل قبول است ولی برای فاکتورهای
  حساس باید maintenance window استفاده شود.
- **بدون incremental:** هر backup کامل است. برای حجم‌های بزرگ (>۱GB)، باید
  به rsync با hardlinks یا BorgBackup مهاجرت شود.
- **بدین deduplication:** اگر چند عکسِ یکسان آپلود شوند، هر کدام در backup
  جداگانه ذخیره می‌شوند. برای مقیاسِ فعلی (چند صد کاشی) قابل قبول است.

### ۱۲.۸. metrics

`/api/metrics` حالا شامل بخش `uploads_backup` است:

```json
{
  "uploads_backup": {
    "last_success_at": "2026-08-24T03:30:42Z",
    "last_failure_at": null,
    "last_failure_reason": null,
    "last_success_size_bytes": 5242880,
    "last_success_sha256": "abc123def456...",
    "last_success_file_count": 42,
    "backup_age_seconds": 3600,
    "restore_test_last_success_at": "2026-08-24T05:30:00Z",
    "retention_days": 30
  }
}
```

اگر status file موجود نباشد: `{ "configured": false, "reason": "..." }`.
