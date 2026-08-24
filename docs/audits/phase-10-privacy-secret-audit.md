# Phase 10 — Privacy & Secret Lifecycle Audit Report

> **Audit Starting Commit:** `6843cdb`
> **Phase 10 Final Commit:** `63edd6d`
> **Audit Date:** 2026-08-24 UTC
> **Auditor:** Super Z (automated)
> **Repository:** `omidhx/tile-saas`
> **Branch:** `main`

---

## 1. Executive Summary

این ممیزی چرخه‌ی عمرِ Secretها و کنترل‌های Privacy پروژه‌ی tile-saas را پوشش
می‌دهد. ممیزی در ۱۱ بخش انجام شد: Secret Inventory، Leakage Audit، Environment
Contract، Secret Strength، Rotation Lifecycle، Logging & Privacy، Privacy Data
Inventory، Tenant Deletion، Fixes، Tests و Findings Registry.

**نتیجه‌ی کلی:**

| شاخص | مقدار |
|---|---|
| Findings شناسایی‌شده | ۴ |
| Findings Fixed | ۲ (AUD-101، AUD-102) |
| Accepted Risks | ۲ (AUD-103، AUD-104) |
| P1 حل‌نشده | ۰ |
| Hardcoded secrets یافت‌شده | ۰ |
| `.env` در git history | هرگز commit نشده |
| TypeScript typecheck | ✅ clean |
| Unit tests | ✅ 178/178 pass |
| Bash syntax | ✅ 12/12 OK |
| CI runtime (commit `63edd6d`) | ✅ run_id=32702509663، conclusion=success |

---

## 2. Secret Inventory

| # | Secret | محل تعریف | محل مصرف | Runtime/Build/Test | حساسیت | Validation مکانیزم | Rotation | وضعیت |
|---|---|---|---|---|---|---|---|---|
| ۱ | `AUTH_SECRET` | `.env` / docker-compose `environment` | `session.ts`، `secretBox.ts` | Runtime | **Critical** | `if (!raw \|\| raw.length < 32) throw` — fail-loud at startup | Manual: generate new → update `.env` → restart → all sessions invalidated | ✅ Validated |
| ۲ | `POSTGRES_PASSWORD` | `.env` / docker-compose `environment` | `db/client.ts`، backup scripts | Runtime | **Critical** | `${POSTGRES_PASSWORD:?...}` in scripts — fail-loud if missing | Manual: `ALTER ROLE ... PASSWORD '...'` → update `.env` → restart | ✅ Required |
| ۳ | `BACKUP_GPG_PASSPHRASE` | `.env` | `backup-db.sh`، `restore-db.sh`، `backup-uploads.sh`، `restore-uploads.sh`، CI scripts | Runtime | **Critical** | `${BACKUP_GPG_PASSPHRASE:?...}` — fail-loud if missing | Manual: generate new → re-encrypt all existing backups → update `.env` | ✅ Required |
| ۴ | `DATABASE_URL` | `.env` / docker-compose `environment` | `db/client.ts` | Runtime | **Critical** | Contains `POSTGRES_PASSWORD` — if missing, app fails to connect | Tied to `POSTGRES_PASSWORD` rotation | ✅ Required |
| ۵ | `SENTRY_DSN` | `.env` (optional) | `sentry.server.config.ts`، `sentry.edge.config.ts` | Runtime | Medium | Empty string = disabled; non-empty = active | Manual: update DSN in Sentry dashboard → update `.env` → restart | ✅ Optional |
| ۶ | `SMS_PROVIDER` | `.env` + `tenant.sms_config` (DB) | `notify/sender.ts`، `notify/smsProviders.ts` | Runtime | Medium | Default `log` = no real SMS sent; tenant-level override via UI | Via UI: change provider → re-enter API key → secretBox re-encrypts | ✅ Optional |
| ۷ | `sms_config` (JSONB) | DB `tenant.sms_config` column | `notify/smsProviders.ts` (decrypted at runtime) | Runtime | **High** | `secretBox.ts`: AES-256-GCM encryption; key derived from `AUTH_SECRET` | Via UI: change API key → `secretBox.encryptSecret()` re-encrypts | ✅ Encrypted |
| ۸ | `password_hash` | DB `app_user.password_hash` column | `auth/password.ts` (bcrypt compare) | Runtime | **High** | bcrypt hash (never stored in plaintext) | Via password reset flow: `hashPassword(newPassword)` → UPDATE | ✅ bcrypt |
| ۹ | `code_hash` | DB `password_reset.code_hash` column | `auth/passwordFlows.ts` (bcrypt compare) | Runtime | Medium | bcrypt hash + `expires_at` CHECK constraint + `attempt_count` limit | Auto-expire: `expires_at < now()` → invalid | ✅ bcrypt + expire |
| ۱۰ | `BACKUP_OFFSITE_TARGET` | `.env` (optional) | `backup-db.sh`، `backup-uploads.sh` (rsync) | Runtime | Medium | Empty = local-only (with warning); non-empty = rsync to remote | Manual: update target path in `.env` | ✅ Optional |
| ۱۱ | `BACKUP_OFFSITE_SSH_KEY` | `.env` (optional) | `backup-db.sh`، `backup-uploads.sh` (rsync -e ssh) | Runtime | **High** | File existence check + permission check (must be 0600/0400) | Manual: `ssh-keygen` → update `authorized_keys` → update `.env` | ✅ Optional + perm check |
| ۱۲ | CI test passphrase | `.github/workflows/ci.yml` env section | `ci-backup-test.sh`، `ci-uploads-backup-test.sh` | CI only | **Low** | Literal value `ci-test-passphrase-only-not-for-production` — clearly marked | N/A (test-only) | ✅ Test-only |

### نکات کلیدی

- **هیچ secret واقعی در repository commit نشده.** فایل `.env` در `.gitignore` است و `git log --all --diff-filter=A -- '.env'` خالی برمی‌گرداند.
- `sms_config` در دیتابیس با `secretBox.ts` (AES-256-GCM) رمزنگاری شده — کلید از `AUTH_SECRET` با SHA-256 مشتق می‌شود.
- `password_hash` با bcrypt ذخیره می‌شود (هرگز plaintext).
- CI passphrase به‌صورت literal در YAML است ولی با عبارت `not-for-production` مشخص شده و هیچگاه در production استفاده نمی‌شود.
- تمام secret‌های اجباری در startup fail-loud می‌شوند (اپ بالا نمی‌آید).

---

## 3. Privacy Data Inventory

| # | داده | محل ذخیره | حساسیت | مدت نگهداری | دسترسی | حذف/ناشناس‌سازی | Backup پوشش |
|---|---|---|---|---|---|---|---|
| ۱ | **Account / Identity** (`app_user`: phone، email، full_name، bale_chat_id، password_hash) | PostgreSQL `app_user` table | **High** | Indefinite (until user deleted) | RLS + auth (user sees own data; admin sees tenant data) | `DELETE FROM app_user` CASCADE → password_reset، tenant_membership | ✅ DB backup (encrypted) |
| ۲ | **Contact information** (phone، email) | `app_user` table | **High** | Indefinite | RLS (per-tenant isolation) | Same as above | ✅ DB backup |
| ۳ | **Tenant data** (name، slug، logo_url، sms_config) | `tenant` table | Medium | Indefinite | RLS (tenant members only) | No tenant deletion endpoint (Accepted Risk AUD-103) | ✅ DB backup |
| ۴ | **Product / Catalog data** (product، product_image، price_list، etc.) | PostgreSQL multiple tables | Low | Indefinite | RLS (tenant members only) | `DELETE FROM tenant` CASCADE (if implemented) → all tenant-scoped tables | ✅ DB backup |
| ۵ | **Uploaded files** (product images، logos) | Docker volume `private/uploads/` | Medium | Indefinite | Auth + tenant ownership (`/api/uploads/[id]`) | `deleteUploadFile()` on product image delete; `cleanup-orphan-uploads.ts` for orphans | ✅ Uploads backup (Phase 9) |
| ۶ | **Audit logs** (`audit_log`: actor_user_id، action، entity، old_value، new_value) | PostgreSQL `audit_log` table | Medium | Indefinite (immutable by design) | RLS (per-tenant) | No deletion (immutable audit trail) | ✅ DB backup |
| ۷ | **Sessions** (JWT in cookie) | Client-side cookie (httpOnly، secure، sameSite=lax) | Medium | ۷ days (JWT expiry) | Per-user (signed with AUTH_SECRET) | `invalidateSessionsIn()` increments `session_epoch` → all old JWTs invalid | N/A (ephemeral) |
| ۸ | **Notification outbox** (`notification_outbox`: recipient، payload) | PostgreSQL `notification_outbox` table | Medium | Until sent or failed (max 5 retries) | RLS (per-tenant) | Worker processes; `status='failed'` after 5 retries → manual cleanup | ✅ DB backup |
| ۹ | **Password reset** (`password_reset`: code_hash، expires_at، attempt_count) | PostgreSQL `password_reset` table | Medium | Until `expires_at` (typically 15 min) | Per-user (no RLS — user-specific) | Auto-expire: `expires_at < now()` | ✅ DB backup |
| ۱۰ | **Operational logs** (structured JSON via `logger.ts`) | stdout / Docker logs / Sentry | Low | Depends on log retention (typically 7-30 days) | System admins | Log rotation (Docker/Caddy); Sentry retention per plan | N/A (ephemeral) |
| ۱۱ | **Backup archives** (`.tar.zst.gpg` + `.manifest` + `.sha256`) | `backups/daily/` + `backups/uploads/` | **Critical** | ۳۰ days (configurable via `BACKUP_RETENTION_DAYS`) | Root only (0600 permissions) | `cleanup-old-backups.sh` + `cleanup-old-uploads-backups.sh` | N/A (is backup) |

### Retention Policies

| داده | Retention مکانیزم | Cleanup tool | وضعیت |
|---|---|---|---|
| `_rate_limit_hits` | ۲۴ ساعت | `worker-housekeeping` (every 6h) | ✅ Active |
| `password_reset` | `expires_at` CHECK constraint | Auto-expire in auth flow | ✅ Active |
| `notification_outbox` | `status='failed'` after 5 retries | Manual cleanup (no automated retention) | ⚠️ No auto-cleanup |
| `audit_log` | Indefinite (immutable) | No deletion | ✅ By design |
| Backup archives | ۳۰ days (default) | `cleanup-old-backups.sh` + `cleanup-old-uploads-backups.sh` | ✅ Script exists، cron pending |

---

## 4. Leakage Audit

### 4.1. ابزارهای استفاده‌شده

| ابزار | وضعیت | محدودیت |
|---|---|---|
| `git grep` با pattern‌های امن | ✅ استفاده شد | فقط pattern‌های شناخته‌شده |
| بررسی دستی Dockerfile و docker-compose | ✅ انجام شد | — |
| بررسی CI workflow و artifact | ✅ انجام شد | — |
| بررسی logger redaction | ✅ انجام شد | — |
| `gitleaks` | ❌ نصب نیست | در محیط sandbox قابل نصب نیست |
| `trufflehog` | ❌ نصب نیست | در محیط sandbox قابل نصب نیست |
| Docker image layer inspection | ❌ نیاز به Docker | Docker در sandbox موجود نیست |

### 4.2. نتایج اسکن

| مورد | Command | مسیر | Severity | False positive / Confirmed | وضعیت |
|---|---|---|---|---|---|
| Hardcoded API keys | `grep -rnE '(sk_\|sk_live_\|ghp_\|AKIA\|eyJ\|BEGIN.*PRIVATE KEY)'` | `web/src/`، `scripts/`، `db/` | — | N/A | ✅ None found |
| `.env` در git history | `git log --all --diff-filter=A --name-only -- '.env'` | — | — | N/A | ✅ Never committed |
| Secret در error responses | `grep -rn "error.*password\|error.*secret"` | `web/src/` | — | N/A | ✅ None found |
| Secret در CI artifact | `.github/workflows/ci.yml` env section | CI env | Low | Confirmed (expected) | ✅ Test-only، clearly marked |
| Secret در Docker image | `Dockerfile ENV` directives | `Dockerfile` | — | N/A | ✅ No secrets in Dockerfile |
| `DATABASE_URL` در logs | `logger.ts` REDACTED_KEYS | `web/src/lib/logger.ts` | — | N/A | ✅ Redacted |
| `AUTH_SECRET` در logs | `logger.ts` REDACTED_KEYS | `web/src/lib/logger.ts` | — | N/A | ✅ In REDACTED_KEYS |
| Secret در backup manifest | `backup-uploads.sh` manifest generation | `scripts/backup-uploads.sh` | — | N/A | ✅ Manifest has checksums only |
| Secret در source maps | Production build config | `next.config.ts` | — | N/A | ✅ No source maps in production |

### 4.3. Logger Redaction Coverage

`web/src/lib/logger.ts` شامل `REDACTED_KEYS` است (۱۸ کلید پس از fix AUD-102):

```text
password, token, authorization, cookie, session, secret, apiKey,
database_url, DATABASE_URL, AUTH_SECRET, jwt, refresh_token,
backup_gpg_passphrase, BACKUP_GPG_PASSPHRASE,
postgres_password, POSTGRES_PASSWORD,
sentry_dsn, SENTRY_DSN
```

**متد redaction:** recursive — nested objects هم redact می‌شوند.

---

## 5. Findings Registry

### Finding AUD-101

| فیلد | مقدار |
|---|---|
| **Title** | Env vars در source ولی NOT در `.env.example` |
| **Severity** | Low |
| **Status** | Resolved |
| **Confidence** | High |
| **Source** | `web/src/db/client.ts` (`DEBUG_PG_NOTICE`)، `web/src/lib/backupStatus.ts` (`BACKUP_STATUS_PATH`)، `web/src/lib/uploadsBackupStatus.ts` (`UPLOADS_STATUS_PATH`) |
| **Affected component** | Environment contract (`.env.example`) |
| **Threat or failure scenario** | Developer ممکن است از وجود `DEBUG_PG_NOTICE`، `BACKUP_STATUS_PATH`، `UPLOADS_STATUS_PATH` بی‌خبر باشد و در production به‌اشتباه فعال کند (مخصوصاً `DEBUG_PG_NOTICE` که نویز اضافه می‌کند). |
| **Verification method** | `comm -23` بین env vars در source و `.env.example` |
| **Evidence** | ۳ env vars در source بودند ولی در `.env.example` نبودند: `DEBUG_PG_NOTICE`، `BACKUP_STATUS_PATH`، `UPLOADS_STATUS_PATH` |
| **Reproduction command** | `comm -23 <(grep -rn "process\.env\." web/src/ --include="*.ts" \| sed 's/.*process\.env\.\([A-Z_]*\).*/\1/' \| sort -u) <(grep -E "^[A-Z_]+=" .env.example \| sed 's/=.*//' \| sort -u)` |
| **Reproduction result** | `DEBUG_PG_NOTICE`، `BACKUP_STATUS_PATH`، `UPLOADS_STATUS_PATH` (۳ مورد) |
| **Root cause** | این env vars بعد از `.env.example` اضافه شده‌اند و فراموش شده‌اند. |
| **Owner** | Super Z |
| **Remediation** | اضافه‌شدن به `.env.example` با توضیح و comment. |
| **Tests added** | N/A (documentation fix) |
| **Regression risk** | Low — فقط مستندسازی |
| **Blocking for Go-Live** | No |

### Finding AUD-102

| فیلد | مقدار |
|---|---|
| **Title** | `BACKUP_GPG_PASSPHRASE` در `REDACTED_KEYS` نیست |
| **Severity** | Low |
| **Status** | Resolved |
| **Confidence** | High |
| **Source** | `web/src/lib/logger.ts` |
| **Affected component** | Logger redaction |
| **Threat or failure scenario** | اگر در log context همراه با کلید `backup_gpg_passphrase` یا `BACKUP_GPG_PASSPHRASE` استفاده شود، redact نمی‌شود. البته اسکریپت‌ها از `echo \| gpg` استفاده می‌کنند و هرگز آن را به logger نمی‌فرستند، ولی defense-in-depth باید آن را در `REDACTED_KEYS` اضافه کند. |
| **Verification method** | بررسی `REDACTED_KEYS` در `logger.ts` — passphrase نبود. |
| **Evidence** | `REDACTED_KEYS` شامل ۱۲ کلید بود ولی `backup_gpg_passphrase`، `BACKUP_GPG_PASSPHRASE`، `postgres_password`، `POSTGRES_PASSWORD`، `sentry_dsn`، `SENTRY_DSN` نبود. |
| **Reproduction command** | `grep -c "backup_gpg_passphrase\|BACKUP_GPG_PASSPHRASE\|postgres_password\|POSTGRES_PASSWORD\|sentry_dsn\|SENTRY_DSN" web/src/lib/logger.ts` |
| **Reproduction result** | `0` (قبل از fix) |
| **Root cause** | `REDACTED_KEYS` در Phase 7 اضافه شد ولی backup passphrase و سایر secret‌های Phase 8/9/10 فراموش شد. |
| **Owner** | Super Z |
| **Remediation** | اضافه‌شدن ۶ کلید جدید به `REDACTED_KEYS`: `backup_gpg_passphrase`، `BACKUP_GPG_PASSPHRASE`، `postgres_password`، `POSTGRES_PASSWORD`، `sentry_dsn`، `SENTRY_DSN`. |
| **Tests added** | N/A (existing `observability.test.ts` redaction tests still pass) |
| **Regression risk** | Low — فقط defense-in-depth |
| **Blocking for Go-Live** | No |

### Finding AUD-103

| فیلد | مقدار |
|---|---|
| **Title** | Tables بدون `ON DELETE CASCADE` برای `tenant_id` |
| **Severity** | Medium |
| **Status** | Accepted Risk |
| **Confidence** | High |
| **Source** | `db/schema.sql` |
| **Affected component** | Tenant deletion |
| **Threat or failure scenario** | اگر tenant از DB حذف شود، جداول `audit_log`، `notification_outbox`، `sales_request` و چند جدول دیگر FK violation می‌دهند و DELETE fail می‌شود. |
| **Verification method** | `grep "tenant_id.*REFERENCES tenant(id)" db/schema.sql \| grep -v "ON DELETE CASCADE"` |
| **Evidence** | ۵+ جدول `REFERENCES tenant(id)` دارند ولی `ON DELETE CASCADE` ندارند: `audit_log`، `notification_outbox`، `sales_request`، `customer`، `incoming_stock`. |
| **Root cause** | Tenant deletion feature وجود ندارد — این جداول برای soft-delete طراحی شده‌اند نه hard-delete. `audit_log` عمداً immutable است. |
| **Owner** | Product team |
| **Remediation** | مستندسازی به‌عنوان Accepted Risk. وقتی tenant deletion feature اضافه شود (آینده)، migration برای CASCADE یا soft-delete (`is_active = false`) لازم است. |
| **Accepted Risk justification** | هیچ tenant deletion endpointی در اپ وجود ندارد. tenant فقط از طریق `POST /api/platform/tenants` ساخته می‌شود، حذف نمی‌شود. `audit_log` عمداً immutable است (audit trail). تا زمانی که tenant deletion feature اضافه نشده، این finding blocking نیست. |
| **Tests added** | N/A |
| **Regression risk** | Low — فقط در صورت اضافه‌شدن tenant deletion feature |
| **Blocking for Go-Live** | No (tenant deletion not in scope) |

### Finding AUD-104

| فیلد | مقدار |
|---|---|
| **Title** | Orphan upload files on manual tenant deletion |
| **Severity** | Low |
| **Status** | Accepted Risk |
| **Confidence** | High |
| **Source** | `web/src/lib/fileCleanup.ts`، `web/scripts/cleanup-orphan-uploads.ts` |
| **Affected component** | File cleanup |
| **Threat or failure scenario** | اگر tenant مستقیماً از DB حذف شود (SQL دستی)، فایل‌های فیزیکی در `private/uploads/` orphan می‌مانند — رکورد DB حذف شده ولی فایل روی دیسک باقی می‌ماند. |
| **Verification method** | بررسی `fileCleanup.ts` و `cleanup-orphan-uploads.ts` — فقط روی product image delete کار می‌کنند، نه tenant delete. |
| **Evidence** | `deleteUploadFile()` فقط در `removeProductImage` و `removeAllProductImages` صدا زده می‌شود. هیچ tenant-level cleanup trigger وجود ندارد. |
| **Root cause** | Tenant deletion feature وجود ندارد. |
| **Owner** | Product team |
| **Remediation** | `cleanup-orphan-uploads.ts` موجود است و orphan files را پاک می‌کند (dry-run + `--commit`). وقتی tenant deletion feature اضافه شود، باید trigger شود. |
| **Accepted Risk justification** | `cleanup-orphan-uploads.ts` به‌عنوان safety net موجود است. در workflow عادی، product image delete فایل را پاک می‌کند. فقط در صورت حذف دستی tenant از DB، orphan پیش می‌آید که cleanup script آن را پاک می‌کند. |
| **Tests added** | N/A |
| **Regression risk** | Low — فقط در صورت حذف دستی tenant |
| **Blocking for Go-Live** | No |

---

## 6. Rotation Matrix

| Secret | ایجاد | ذخیره | rotation | revoke | recovery | Runbook | وضعیت |
|---|---|---|---|---|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` | `.env` on VPS | Manual: generate new → update `.env` → restart → all sessions invalidated | Old key stops working immediately after restart | Old backups decryptable with old key (AUTH_SECRET only affects session signing + secretBox) | `docs/runbooks/secret-rotation.md` | ✅ Documented |
| `BACKUP_GPG_PASSPHRASE` | `openssl rand -base64 32` | `.env` on VPS | Manual: generate new → re-encrypt all existing backups → update `.env` | Old backups need old passphrase | Keep old passphrase in vault | `docs/runbooks/secret-rotation.md` | ✅ Documented |
| `POSTGRES_PASSWORD` | Manual | `.env` + `ALTER ROLE` | Manual: `ALTER ROLE ... PASSWORD '...'` → update `.env` → restart | Old password stops working after `ALTER ROLE` | DB admin access (superuser) | `docs/runbooks/secret-rotation.md` | ✅ Documented |
| `sms_config` keys | Via UI | DB (encrypted with `secretBox`) | Via UI: change API key → `secretBox.encryptSecret()` re-encrypts | Old key stops working when provider rejects it | UI re-entry | `docs/runbooks/secret-rotation.md` | ✅ Documented |
| `BACKUP_OFFSITE_SSH_KEY` | `ssh-keygen` | `.ssh/` on VPS | Manual: generate new key → update `authorized_keys` on backup host → update `.env` | Remove old key from `authorized_keys` | SSH access to backup host | `docs/runbooks/secret-rotation.md` | ✅ Documented |

---

## 7. Go-Live Blocking Status

| Finding | Severity | Status | Blocking for Go-Live? | Decision |
|---|---|---|---|---|
| AUD-101 | Low | ✅ Resolved | No | Fixed in commit `63edd6d` |
| AUD-102 | Low | ✅ Resolved | No | Fixed in commit `63edd6d` |
| AUD-103 | Medium | Accepted Risk | No | Tenant deletion not in scope |
| AUD-104 | Low | Accepted Risk | No | Cleanup script exists |

**هیچ P1 حل‌نشده‌ای بدون تصمیم رسمی باقی نمانده است.**

---

## 8. Evidence Summary

| Evidence # | Description | Command | Commit | Result |
|---|---|---|---|---|
| ۱ | TypeScript typecheck | `npx tsc --noEmit` | `63edd6d` | exit=0، clean |
| ۲ | Unit tests (13 files) | `npx tsx --test src/lib/*.test.ts` | `63edd6d` | 178/178 pass |
| ۳ | Bash syntax (12 files) | `bash -n scripts/*.sh` | `63edd6d` | 12/12 exit=0 |
| ۴ | YAML syntax (3 files) | `python3 yaml.safe_load` | `63edd6d` | 3/3 exit=0 |
| ۵ | CI run | GitHub Actions | `63edd6dc` | run_id=32702509663، conclusion=success |
| ۶ | AUD-101 fix | `grep .env.example` | `63edd6d` | 3 env vars added |
| ۷ | AUD-102 fix | `grep REDACTED_KEYS logger.ts` | `63edd6d` | 6 keys added (12→18) |
| ۸ | Secret leakage scan | `grep -rnE '(sk_\|ghp_\|...)'` | `63edd6d` | empty (no leaks) |
| ۹ | `.env` in git history | `git log --all --diff-filter=A -- '.env'` | `63edd6d` | empty (never committed) |
| ۱۰ | Files changed | `git diff --stat 6843cdb..63edd6d` | — | 3 files، +357 lines |

---

## 9. Remaining Risks

1. **AUD-009:** `private/uploads/` backup در staging/production runtime-verified نشده.
2. **Tenant deletion:** Feature وجود ندارد — وقتی اضافه شود، cascade/orphan cleanup لازم است (AUD-103، AUD-104).
3. **Backup retention در production:** cron نصب نشده — فقط scripts موجودند.
4. **Secret rotation drill:** هیچ‌گاه در production اجرا نشده.
5. **`gitleaks`/`trufflehog`:** در CI نصب نیستند — secret scanning فقط با `git grep` انجام می‌شود.
6. **GDPR/data protection:** اگر کاربر اتحادیه‌ی اروپا داشته باشد، data deletion/export feature لازم است — فعلاً در scope نیست.
7. **`notification_outbox` retention:** `status='failed'` records auto-cleanup ندارند — manual cleanup لازم است.

---

## 10. Audit Chain

```text
Audit starting commit: 6843cdb
Phase 10 final commit: 63edd6d
Working tree after commit: clean
Push status: SYNCHRONIZED with origin/main
  local HEAD:  63edd6dc8fa0d355818052e4b50ef1598b70d473
  origin/main: 63edd6dc8fa0d355818052e4b50ef1598b70d473
```

---

## 11. Authorized Statement

> **Phase 10 Privacy & Secret Lifecycle audit is complete. 4 findings
> identified: 2 fixed (AUD-101, AUD-102), 2 accepted risks (AUD-103,
> AUD-104). No P1 findings remain unresolved. Production runtime
> verification remains pending.**
