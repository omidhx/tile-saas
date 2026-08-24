# Tile SaaS — پنل موجودی و رزرو نمایندگان کاشی و سرامیک

> **سیستم مدیریت موجودی، رزرو و درخواست سفارش نمایندگان، مخصوص کارخانه‌های کاشی و سرامیک.**
>
> Vertical SaaS چندمستأجری (Multi-tenant) با معماری Row-Level Security در PostgreSQL 16.
>
> **وضعیت:** Implementation Complete — آماده Go-Live با ۱-۲ tenant آزمایشی.

---

## فهرست

1. [معرفی محصول](#۱-معرفی-محصول)
2. [معماری سیستم](#۲-معماری-سیستم)
3. [تکنولوژی‌ها](#۳-تکنولوژی‌ها)
4. [ساختار پروژه](#۴-ساختار-پروژه)
5. [مدل داده](#۵-مدل-داده)
6. [امنیت و چندمستأجرنی](#۶-امنیت-و-چندمستأجرنی)
7. [احراز هویت و دسترسی](#۷-احراز-هویت-و-دسترسی)
8. [API و مسیرها](#۸-api-و-مسیرها)
9. [صفحات و رابط کاربری](#۹-صفحات-و-رابط-کاربری)
10. [Workerها و پردازش‌های پس‌زمینه](#۱۰-workerها-و-پردازشهای-پسزمینه)
11. [Observability و مانیتورینگ](#۱۱-observability-و-مانیتورینگ)
12. [Backup و Disaster Recovery](#۱۲-backup-و-disaster-recovery)
13. [Privacy و Secret Lifecycle](#۱۳-privacy-و-secret-lifecycle)
14. [Incident Response و Runbooks](#۱۴-incident-response-و-runbooks)
15. [CI/CD و Deployment](#۱۵-cicd-و-deployment)
16. [نصب و راه‌اندازی](#۱۶-نصب-و-راهاندازی)
17. [تست](#۱۷-تست)
18. [مستندات](#۱۸-مستندات)
19. [نقشه‌ی راه](#۱۹-نقشه‌ی-راه)
20. [مجوز](#۲۰-مجوز)

---

## ۱. معرفی محصول

### مشکل

کارخانه‌های کاشی و سرامیک ایران (به‌ویژه یزد/میبد) با چالش مدیریت نمایندگان
خود مواجه‌اند. نماینده‌ها نیاز دارند موجودی کارخانه را ببینند، رزرو کنند،
سفارش بدهند و حواله بارگیری دریافت کنند. روش فعلی: تلفن + اکسل + واتس‌اپ.

### راه‌حل

یک پنل آنلاین که:

- **کارخانه (Staff)**: موجودی را مدیریت می‌کند، رزروها را تأیید/رد می‌کند، حواله صادر می‌کند.
- **نماینده (Agent)**: موجودی را می‌بیند، رزرو می‌زند، وضعیت سفارش را پیگیری می‌کند.
- **مشتری نهایی**: از طریق لینک عمومی، کاتالوگ محصولات را بدون قیمت می‌بیند.

### زنجیره‌ی ارزش

```text
مشاهده موجودی → رزرو (Reservation) → درخواست سفارش (SalesRequest)
→ تأیید کارخانه → صدور حواله (SalesDispatch) → بارگیری فیزیکی
```

### بازار هدف

- کارخانه‌های کاشی و سرامیک ایران (تعداد محدود، B2B).
- هر کارخانه = ۱ Tenant.
- هر نماینده = ۱ AgentAccount.
- مقیاس مورد نظر: چند ده کارخانه × چند صد نماینده.

---

## ۲. معماری سیستم

### ۲.۱. نمای کلی

```text
                    ┌─────────────┐
                    │   Caddy     │ ← HTTPS (Let's Encrypt)
                    │  (Port 443) │ ← HSTS, CSP, Rate Limit
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Next.js 16 │ ← App Router, SSR, API Routes
                    │  (Port 3000)│ ← Node 22, non-root user
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼────┐ ┌───────▼───────┐
     │ PostgreSQL  │ │ Uploads │ │   Workers     │
     │  16 (RLS)   │ │ Volume  │ │ expire,outbox │
     │  app_user   │ │ private │ │ housekeeping  │
     └─────────────┘ └─────────┘ └───────────────┘
```

### ۲.۲. اصول طراحی

| اصل | پیاده‌سازی |
|---|---|
| **Multi-tenancy** | PostgreSQL Row-Level Security (RLS) — هر Tenant فقط داده‌ی خودش را می‌بیند |
| **Least Privilege** | `app_user` (non-superuser, no BYPASSRLS) برای runtime؛ superuser فقط برای migration |
| **Defense in Depth** | CSRF + HSTS + CSP nonce + rate limit + path traversal defense + magic bytes validation |
| **Fail-Loud** | اگر AUTH_SECRET کم باشد یا role superuser باشد، اپ بالا نمی‌آید |
| **Forward-Only Migrations** | Schema فقط با migration forward-only تغییر می‌کند — rollback ندارد |
| **Encrypted Backups** | pg_dump → zstd → GPG AES-256 → SHA-256 checksum |
| **Structured Logging** | JSON logs با request ID، redaction، ۱۸ کلید حساس |

### ۲.۳. Docker Compose Services

| Service | Image | نقش |
|---|---|---|
| `postgres` | `postgres:16-alpine` | دیتابیس با RLS، `app_user` non-superuser |
| `web` | `node:22-alpine` (custom) | اپ Next.js + API Routes، non-root user |
| `worker-expire` | همان image | انقضای رزروها (هر ۱۰ دقیقه) |
| `worker-outbox` | همان image | ارسال پیامک/ایمیل/بله (هر ۲ دقیقه) |
| `worker-housekeeping` | همان image | پاکسازی `_rate_limit_hits` (هر ۶ ساعت) |
| `caddy` (staging) | `caddy:2-alpine` | Reverse proxy با HTTPS خودکار |

---

## ۳. تکنولوژی‌ها

| لایه | تکنولوژی | نسخه |
|---|---|---|
| **Frontend** | Next.js (App Router) + React | 16.3 / 19.2 |
| **Language** | TypeScript (ES2024 target) | 5.x |
| **Database** | PostgreSQL | 16 (Alpine) |
| **ORM/Query** | postgres.js (postgres) + Drizzle (introspect) | 3.4 / 0.45 |
| **Auth** | jose (JWT) + bcryptjs | 6.2 / 3.0 |
| **Reverse Proxy** | Caddy 2 (Alpine) | 2.x |
| **Runtime** | Node.js | 22 (Active LTS) |
| **Container** | Docker + Docker Compose | — |
| **CI** | GitHub Actions | — |
| **Error Tracking** | Sentry (optional) | @sentry/nextjs |
| **Font** | Vazirmatn (فارسی) | @fontsource-variable/vazirmatn |
| **Excel** | SheetJS (xlsx) | 0.20.3 |
| **E2E** | Playwright | 1.62 |
| **Encryption** | Node.js crypto (AES-256-GCM) | built-in |
| **Backup** | pg_dump + zstd + GPG | — |

---

## ۴. ساختار پروژه

```text
tile-saas/
├── db/                          # Database schema + migrations
│   ├── schema.sql               # ۳۹ جدول + RLS policies + SECURITY DEFINER functions
│   ├── create-app-user.sql      # ساخت app_user non-superuser
│   ├── seed-dev.sql             # داده‌ی تستی
│   └── migrations/
│       ├── apply.ts             # اسکریپت idempotent اجرای migration
│       ├── 0002_migrations_table.sql
│       ├── 0003_rate_limit_table.sql
│       └── 0004_lock_definer_search_path.sql
│
├── web/                         # اپلیکیشن Next.js
│   ├── package.json             # Node >=22, scripts (dev, build, test, migrate)
│   ├── next.config.ts
│   ├── tsconfig.json            # target: ES2024, strict
│   ├── Dockerfile               # multi-stage build (deps → builder → runner)
│   ├── .nvmrc                   # 22
│   ├── instrumentation.ts       # startup role check (DB-001)
│   │
│   ├── src/
│   │   ├── app/                 # App Router pages + API routes
│   │   │   ├── api/             # ۴۷ API route file
│   │   │   ├── staff/           # صفحات کارخانه (catalog, ledger, team, ...)
│   │   │   ├── reserve/         # صفحه‌ی رزرو نماینده
│   │   │   ├── login/           # ورود
│   │   │   ├── c/[slug]/[token] # کاتالوگ عمومی مشتری
│   │   │   └── ...
│   │   │
│   │   ├── auth/                # احراز هویت
│   │   │   ├── session.ts       # JWT sign/verify + session_epoch + invalidate
│   │   │   ├── authz.ts          # authorizeAgent, authorizeStaff, authorizeAdmin
│   │   │   ├── password.ts      # bcrypt hash/verify
│   │   │   ├── passwordFlows.ts # reset/change password + SMS code
│   │   │   ├── csrf.ts          # assertSameOrigin
│   │   │   ├── rateLimit.ts     # memory + postgres backend
│   │   │   └── httpCtx.ts       # per-user rate limit in all *Ctx
│   │   │
│   │   ├── db/                  # ۲۷ module دیتابیس
│   │   │   ├── client.ts        # postgres.js + assertNonSuperuserRole
│   │   │   ├── products.ts      # CRUD + image management + deleteUploadFile
│   │   │   ├── reservations.ts  # idempotency + ON CONFLICT + FOR UPDATE
│   │   │   ├── ledger.ts        # inventory transaction log (append-only)
│   │   │   ├── outbox.ts        # notification queue (claim + retry)
│   │   │   └── ...
│   │   │
│   │   ├── lib/                 # ابزارها
│   │   │   ├── logger.ts        # JSON structured logger + ۱۸ redaction keys
│   │   │   ├── metrics.ts       # in-memory metrics collector
│   │   │   ├── secretBox.ts     # AES-256-GCM for sms_config encryption
│   │   │   ├── magicBytes.ts    # file type validation (JPG/PNG/WebP)
│   │   │   ├── fileCleanup.ts   # safe file deletion with path traversal defense
│   │   │   ├── backupStatus.ts  # read backup-status.json for /api/metrics
│   │   │   ├── uploadsBackupStatus.ts # read uploads-backup-status.json
│   │   │   ├── money.ts         # ریال/تومان conversion + numberToWords
│   │   │   └── ...
│   │   │
│   │   ├── notify/              # notification system
│   │   │   ├── sender.ts        # multi-channel (SMS/Email/Bale)
│   │   │   └── smsProviders.ts  # kavenegar/ippanel/melipayamak/sms.ir/farazsms
│   │   │
│   │   └── proxy.ts             # CSRF + rate limit + CSP nonce + HSTS + request ID
│   │
│   └── scripts/                 # worker scripts
│       ├── expire.ts            # expire_due_reservations()
│       ├── outbox.ts            # claim_pending_notifications()
│       ├── cleanup-orphan-uploads.ts
│       └── seed-dev.ts
│
├── scripts/                     # operational scripts
│   ├── backup-db.sh             # pg_dump → zstd → GPG → SHA-256 → verify
│   ├── verify-backup.sh         # decrypt + checksum + PGDMP magic
│   ├── restore-db.sh            # restore to test DB + ۸ integrity + ۵ smoke
│   ├── backup-uploads.sh        # tar → zstd → GPG → manifest
│   ├── verify-uploads.sh        # decrypt + tar --list + manifest
│   ├── restore-uploads.sh       # restore to isolated dir + per-file checksum
│   ├── cleanup-old-backups.sh   # retention policy (DB backups)
│   ├── cleanup-old-uploads-backups.sh
│   ├── ci-backup-test.sh        # CI: host-based DB backup test
│   ├── ci-uploads-backup-test.sh # CI: host-based uploads backup test
│   ├── test-dr-simulation.sh    # ۶۴-check DR readiness
│   ├── staging-verify.sh        # staging verification
│   └── prodlike-smoke.sh        # production-like smoke test
│
├── docs/                        # مستندات
│   ├── audits/
│   │   └── phase-10-privacy-secret-audit.md
│   ├── runbooks/
│   │   ├── incident-classification.md
│   │   ├── dr-database-outage.md
│   │   ├── dr-uploads-recovery.md
│   │   ├── emergency-rollback.md
│   │   ├── disk-pressure-and-cleanup.md
│   │   └── secret-rotation.md
│   ├── BACKUP_POLICY.md
│   ├── RESTORE_RUNBOOK.md
│   ├── DISASTER_RECOVERY.md
│   ├── STAGING_EXECUTION_RUNBOOK.md
│   ├── STAGING_VERIFICATION_CHECKLIST.md
│   ├── ALERTING.md
│   ├── GO_LIVE.md
│   ├── SECURITY.md
│   ├── ARCHITECTURE.md
│   ├── API_SPEC.md
│   ├── CODING_STANDARDS.md
│   ├── KNOWN_ISSUES.md
│   ├── KNOWN_WARNINGS.md
│   ├── FINAL_AUDIT_REPORT.md
│   └── ...
│
├── backups/                    # backup artifacts (gitignored)
│   ├── daily/                   # database backups
│   ├── uploads/                 # uploads backups
│   └── status/                  # status JSON files for /api/metrics
│
├── Dockerfile                   # multi-stage Node 22 Alpine
├── docker-compose.yml           # production
├── docker-compose.staging.yml   # staging
├── Caddyfile                    # reverse proxy config
├── Caddyfile.staging
├── .env.example                 # ۱۵+ env vars documented
├── .github/workflows/ci.yml     # CI pipeline
└── tile-saas-comprehensive-spec.md # product spec (۵۵KB)
```

---

## ۵. مدل داده

### ۵.۱. جداول (۳۹ جدول)

#### هویت و چندمستأجرنی (۵ جدول سراسری)

| جدول | توضیح |
|---|---|
| `app_user` | کاربر: phone (UNIQUE), email, password_hash (bcrypt), is_platform_admin, session_epoch |
| `tenant` | کارخانه: name, slug, logo_url, sms_config (encrypted JSONB), display_currency |
| `tenant_membership` | رابطه‌ی user↔tenant با role (admin/staff/agent) + allowed_pages + can_manage_access |
| `agent_account` | نماینده: legal_name, code (UNIQUE per tenant), credit_limit, is_active |
| `agent_account_user` | رابطه‌ی agent_account↔app_user (یک نماینده می‌تواند چند کاربر داشته باشد) |
| `password_reset` | کد بازیابی رمز: code_hash (bcrypt), expires_at, attempt_count |

#### محصول و کاتالوگ (۶ جدول tenant-scoped)

| جدول | توضیح |
|---|---|
| `brand` | برند محصول (مثلاً طلاسرام، خوارزم) |
| `product` | محصول: name, code, image_url (cache), brand_id, unit (carton/pallet) |
| `product_image` | گالری تصاویر محصول (چند عکس با sort_order) |
| `product_variant` | درجه کیفی (یک/دو/سه/چهار) + SKU |
| `price_list` | لیست قیمت |
| `price_list_item` | آیتم قیمت (product_id, price, min_quantity) |

#### موجودی و انبار (۴ جدول)

| جدول | توضیح |
|---|---|
| `warehouse` | انبار |
| `inventory_lot` | لات موجودی: lot_number, quantity_carton, quantity_pallet, grade, warehouse_id |
| `inventory_balance` | موجودی فعلی (available = on_hand - held) |
| `inventory_transaction` | لجر موجودی (append-only): type (receive/reserve/dispatch/return/adjust), quantity, old/new balance |

#### رزرو و سفارش (۵ جدول)

| جدول | توضیح |
|---|---|
| `reservation` | رزرو: agent_account_id, expires_at, idempotency_key (UNIQUE per tenant), status |
| `reservation_item` | آیتم رزرو: lot_id, quantity, status (active/expired/cancelled) |
| `sales_request` | درخواست سفارش: from reservation, status (held→allocated→dispatched/cancelled) |
| `sales_request_item` | آیتم سفارش |
| `sales_request_allocation` | تخصیص لات به آیتم سفارش |

#### حواله و بارگیری (۲ جدول)

| جدول | توضیح |
|---|---|
| `sales_dispatch` | حواله فروش: dispatch_code, customer_name, destination, reference_number, status |
| `sales_dispatch_item` | آیتم حواله |

#### قیمت‌گذاری (۳ جدول)

| جدول | توضیح |
|---|---|
| `volume_discount` | تخفیف حجمی (pelle‌ها: min_quantity → discount_percent) |
| `agent_price_override` | قیمت اختصاصی نماینده (override لیست قیمت) |
| `incoming_stock` | موجودی در راه (هرگز وارد available نمی‌شود) |

#### مشتری و کاتالوگ عمومی (۲ جدول)

| جدول | توضیح |
|---|---|
| `customer` | مشتری نهایی (name, phone, address) — snapshot در حواله |
| `shared_catalog` | کاتالوگ عمومی با token (مشتری بدون login می‌بیند) |
| `shared_catalog_item` | آیتم کاتالوگ عمومی |

#### جایگزین و صف انتظار (۲ جدول)

| جدول | توضیح |
|---|---|
| `product_substitute` | کالای جایگزین (همان محصول، درجه دیگر) |
| `waitlist_entry` | صف انتظار (وقتی موجودی آزاد شود، به ترتیب نوبت پیشنهاد می‌شود) |

#### اعلان و ادمین (۴ جدول)

| جدول | توضیح |
|---|---|
| `notification_outbox` | صف اعلان چندکاناله (SMS/Email/Bale) با retry (max ۵) |
| `stock_alert` | هشدار کمبود موجودی |
| `audit_log` | لاگ تغییرات (actor_user_id, action, entity, old_value, new_value) — immutable |
| `import_batch` + `import_row` + `import_template` | ورود اکسل (SheetJS) |

#### زیرساختی (۲ جدول)

| جدول | توضیح |
|---|---|
| `_migrations` | ردیابی migrationها (id, name, checksum, applied_at) |
| `_rate_limit_hits` | rate limiter با backend postgres (multi-instance) |

### ۵.۲. RLS (Row-Level Security)

```sql
-- همه‌ی جدول‌های tenant-scoped با RLS محافظت می‌شوند:
ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

- `app_user` (runtime role) `NOSUPERUSER NOBYPASSRLS` است.
- RLS در **startup** توسط `assertNonSuperuserRole()` بررسی می‌شود.
- اگر role superuser باشد، اپ fail-loud می‌شود (بالا نمی‌آید).

### ۵.۳. SECURITY DEFINER Functions (۴ تابع)

این توابع cross-tenant هستند و از RLS عبور می‌کنند (امن چون محدود هستند):

| تابع | کاربرد |
|---|---|
| `user_contexts(user_id)` | bootstrap هویت — tenant_id‌های کاربر را برمی‌گرداند |
| `expire_due_reservations()` | انقضای رزروهای منقضی‌شده (worker) |
| `claim_pending_notifications(limit, timeout)` | claim اتمیک پیام‌های pending (worker) |
| `finish_notification(id, success, attempts)` | ثبت نتیجه ارسال (worker) |

همه با `SET search_path = public, pg_temp` قفل شده‌اند (دفاع در برابر search_path injection).

---

## ۶. امنیت و چندمستأجرنی

### ۶.۱. لایه‌های امنیتی

| لایه | پیاده‌سازی |
|---|---|
| **Authentication** | JWT (jose) + bcrypt password_hash + session_epoch (invalidation) |
| **Authorization** | `authorizeAgent` / `authorizeStaff` / `authorizeAdmin` / `authorizePlatformAdmin` |
| **Tenant Isolation** | PostgreSQL RLS — `app.tenant_id` session variable |
| **CSRF** | `proxy.ts` — Origin/Host check روی تمام mutation methods |
| **HSTS** | `proxy.ts` + `Caddyfile` — `max-age=31536000; includeSubDomains` |
| **CSP** | `proxy.ts` — `script-src 'self' 'nonce-...' 'strict-dynamic'` |
| **Rate Limiting** | دو سطح: IP-based (proxy) + per-user (`checkRateAsync` در ۲۲ route) |
| **Path Traversal** | `fileCleanup.ts` + `upload/route.ts` — normalize + startsWith check |
| **File Upload** | Magic bytes validation + UUID naming + private directory + 3MB limit |
| **SQL Injection** | postgres.js parameterized queries (هیچ string concatenation) |
| **Secret Encryption** | `secretBox.ts` — AES-256-GCM برای `sms_config` |
| **Backup Encryption** | GPG symmetric AES-256 (s2k SHA-512) |

### ۶.۲. Session Management

```text
Login → setSessionCookie(userId) → JWT با session_epoch
  ↓
هر request → currentUserId() → verify JWT + check session_epoch در DB
  ↓
Password change/reset → invalidateSessionsIn(userId) → session_epoch++
  ↓
JWT قدیمی invalid می‌شود (epoch mismatch)
```

### ۶.۳. Rate Limiting

| Route | Limit | Window | Backend |
|---|---|---|---|
| `login` | ۵ | ۱۵ دقیقه | postgres (fail-closed) |
| `auth/password` | ۵ | ۱۵ دقیقه | postgres (fail-closed) |
| `auth/reset` | ۵ | ۱۵ دقیقه | postgres (fail-closed) |
| `reservations` | ۳۰ | ۱ دقیقه | postgres |
| `upload` | ۱۰ | ۱ دقیقه | postgres |
| `imports` | ۵ | ۱۵ دقیقه | postgres |
| سایر mutations | ۱۰۰ | ۱ دقیقه | IP-based (proxy) |

---

## ۷. احراز هویت و دسترسی

### ۷.۱. Roles

| Role | دسترسی | شرح |
|---|---|---|
| **Platform Admin** | همه‌ی tenantها | `is_platform_admin = true` — ساخت tenant، دیدن metrics |
| **Admin** (tenant) | tenant خودش | `role = 'admin'` — مدیریت تیم، تنظیمات، همه‌ی صفحات staff |
| **Staff** (tenant) | tenant خودش | `role = 'staff'` — صفحات مجاز (`allowed_pages`) |
| **Agent** (tenant) | tenant خودش | `role = 'agent'` — فقط رزرو و کاتالوگ |

### ۷.۲. Login Flow

```text
POST /api/auth/login { phone, password }
  ↓
verify password (bcrypt)
  ↓
invalidateSessionsIn(userId) — session_epoch++
  ↓
issueSession(userId) — JWT با epoch
  ↓
setSessionCookie — httpOnly, secure, sameSite=lax, 7 days
  ↓
return { redirect: "/staff" یا "/reserve" }
```

### ۷.۳. Password Reset Flow

```text
POST /api/auth/reset { phone }
  ↓
generate code (6 digits)
  ↓
hash code (bcrypt) → INSERT password_reset
  ↓
notification_outbox (SMS/Email/Bale)
  ↓
POST /api/auth/reset { phone, code, newPassword }
  ↓
verify code (bcrypt) + check expires_at + attempt_count
  ↓
hashPassword(newPassword) → UPDATE app_user
  ↓
invalidateSessionsIn(userId) — همه‌ی session‌ها invalid
```

---

## ۸. API و مسیرها

### ۸.۱. آمار

- **۴۷ فایل route.ts** (شامل health، ready، metrics)
- **~۵۰+ HTTP operations** (GET/POST/PATCH/DELETE)

### ۸.۲. مسیرهای اصلی

#### Auth

| Route | Method | توضیح |
|---|---|---|
| `/api/auth/login` | POST | ورود با phone + password |
| `/api/auth/logout` | POST | خروج (clear cookie) |
| `/api/auth/logout-all` | POST | خروج از همه‌ی دستگاه‌ها (session_epoch++) |
| `/api/auth/password` | POST | تغییر رمز |
| `/api/auth/reset` | POST | درخواست بازیابی رمز (ارسال کد) |
| `/api/auth/reset` | PATCH | بازیابی رمز با کد |

#### Catalog & Products

| Route | Method | توضیح |
|---|---|---|
| `/api/catalog` | GET | کاتالوگ نماینده (موجودی + قیمت) |
| `/api/products` | GET/POST/PATCH/DELETE | CRUD محصول |
| `/api/product-images` | POST/DELETE/PATCH | مدیریت گالری تصاویر |
| `/api/upload` | POST | آپلود عکس (staff-only، 3MB، magic bytes) |
| `/api/uploads/[id]` | GET | دانلود فایل (auth + tenant ownership) |
| `/api/substitutes` | GET/POST/DELETE | کالای جایگزین |
| `/api/brands` | GET | لیست برندها |

#### Inventory & Reservations

| Route | Method | توضیح |
|---|---|---|
| `/api/lots` | GET | لات‌های موجودی |
| `/api/reservations` | GET/POST | رزرو (با idempotency_key) |
| `/api/reservations/[id]/approve` | POST | تأیید رزرو (staff) |
| `/api/reservations/[id]/cancel` | POST | لغو رزرو |
| `/api/incoming` | GET/POST | موجودی در راه |
| `/api/backorders` | GET/POST | سفارش محصول ناموجود |
| `/api/backorders/[itemId]/status` | PATCH | تغییر وضعیت backorder |

#### Sales & Dispatch

| Route | Method | توضیح |
|---|---|---|
| `/api/sales-requests` | GET/POST | درخواست سفارش |
| `/api/sales-dispatches` | GET/POST | حواله فروش |
| `/api/sales-dispatches/[id]` | GET/PATCH | جزئیات حواله |
| `/api/sales-dispatches/[id]/status` | PATCH | تغییر وضعیت (loaded) |

#### Pricing

| Route | Method | توضیح |
|---|---|---|
| `/api/prices` | GET/POST/PATCH | قیمت‌گذاری |
| `/api/prices/import` | POST | ورود قیمت از اکسل |
| `/api/price-lists` | GET/POST | لیست قیمت |
| `/api/volume-discounts` | GET/POST/PATCH/DELETE | تخفیف حجمی |
| `/api/agent-overrides` | GET/POST/PATCH/DELETE | قیمت اختصاصی نماینده |

#### Team & Settings

| Route | Method | توضیح |
|---|---|---|
| `/api/team` | GET/POST/PATCH/DELETE | مدیریت تیم (invite، role، allowed_pages) |
| `/api/agents` | GET/POST/PATCH/DELETE | مدیریت نمایندگان |
| `/api/warehouses` | GET/POST/PATCH/DELETE | انبارها |
| `/api/settings/tenant` | GET/PATCH | تنظیمات tenant (logo، currency، reservation TTL) |
| `/api/settings/sms` | GET/PATCH | تنظیمات SMS (encrypted) |
| `/api/settings/auto-approve` | GET/PATCH | سقف تأیید خودکار |
| `/api/customers` | GET/POST | مشتریان |
| `/api/imports` | POST | ورود اکسل موجودی |

#### Reports & Audit

| Route | Method | توضیح |
|---|---|---|
| `/api/dashboard` | GET | KPI داشبورد |
| `/api/reports` | GET | گزارش‌های مدیریتی |
| `/api/ledger` | GET | لجر موجودی |
| `/api/audit` | GET | لاگ تغییرات |
| `/api/alerts` | GET | هشدارهای موجودی |

#### Platform Admin

| Route | Method | توضیح |
|---|---|---|
| `/api/platform/tenants` | POST | ساخت tenant جدید + admin اولیه |
| `/api/metrics` | GET | metrics عملیاتی (platform admin only در production) |
| `/api/health` | GET | liveness probe (بدون auth) |
| `/api/ready` | GET | readiness probe (DB check، بدون auth) |

---

## ۹. صفحات و رابط کاربری

### ۹.۱. صفحات Staff (کارخانه)

| صفحه | توضیح |
|---|---|
| `/staff` | داشبورد اصلی (KPI، صف رزرو/درخواست، اعلان صوتی) |
| `/staff/catalog` | مدیریت محصولات + قیمت‌گذاری + ورود اکسل + عکس |
| `/staff/prices` | قیمت‌ها + تخفیف حجمی |
| `/staff/incoming` | موجودی در راه |
| `/staff/customers` | مشتریان |
| `/staff/reports` | گزارش‌ها + لجر + audit |
| `/staff/team` | تیم + نمایندگان + انبارها + تنظیمات + SMS |
| `/staff/agents` | نمایندگان |
| `/staff/warehouses` | انبارها |
| `/staff/substitutes` | کالای جایگزین |
| `/staff/auto-approve` | سقف تأیید خودکار |
| `/staff/audit` | لاگ تغییرات |
| `/staff/ledger` | لجر موجودی |
| `/staff/import` | ورود اکسل |
| `/staff/dispatch/[id]/print` | چاپ حواله (بدون sidebar) |

### ۹.۲. صفحات Agent (نماینده)

| صفحه | توضیح |
|---|---|
| `/reserve` | مشاهده موجودی + رزرو (سبد خرید) |
| `/reservations` | رزروهای من + polling خودکار + اعلان صوتی |
| `/catalogs` | کاتالوگ‌های عمومی (لینک اشتراکی) |

### ۹.۳. صفحات عمومی

| صفحه | توضیح |
|---|---|
| `/login` | ورود (phone + password) |
| `/reset` | بازیابی رمز |
| `/c/[slug]/[token]` | کاتالوگ عمومی مشتری (بدون login، بدون قیمت) |
| `/account/password` | تغییر رمز |

### ۹.۴. صفحات Platform Admin

| صفحه | توضیح |
|---|---|
| `/platform/tenants` | ساخت tenant جدید |

### ۹.۵. ویژگی‌های UI

- **RTL** کامل با فونت Vazirmatn
- **تم روشن/تیره** با toggle + localStorage (no-flash)
- **PWA** (manifest.json + service worker + offline)
- **Sidebar** فیلترشده با role + allowed_pages
- **Jalali تاریخ** (تبدیل میلادی ↔ شمسی)
- **پول**: ریال/تومان + مبلغ به حروف فارسی
- **اعلان صوتی** برای رزرو/درخواست جدید در /staff
- **Polling خودکار** (هر ۶۰ ثانیه) در /reservations و /staff

---

## ۱۰. Workerها و پردازش‌های پس‌زمینه

### ۱۰.۱. Worker Expire (هر ۱۰ دقیقه)

```text
expire_due_reservations()
  → پیدا کردن رزروهای منقضی‌شده (expires_at <= now)
  → تغییر status: active → expired
  → آزادسازی موجودی (held → available)
  → بررسی صف انتظار (waitlist)
  → ارسال اعلان به نماینده بعدی در صف
```

### ۱۰.۲. Worker Outbox (هر ۲ دقیقه)

```text
claim_pending_notifications(limit, timeout)
  → claim اتمیک پیام‌های pending (SELECT FOR UPDATE SKIP LOCKED)
  → ارسال از طریق provider (SMS/Email/Bale)
  → ثبت نتیجه (success/failure)
  → retry (max ۵، dead-letter بعد از آن)
```

### ۱۰.۳. Worker Housekeeping (هر ۶ ساعت)

```text
DELETE FROM _rate_limit_hits WHERE hit_at < now() - interval '24 hours'
  → پاکسازی ردیف‌های قدیمی rate limiter
```

---

## ۱۱. Observability و مانیتورینگ

### ۱۱.۱. Endpoints

| Endpoint | کاربرد | Auth |
|---|---|---|
| `GET /api/health` | Liveness — process زنده است | بدون auth |
| `GET /api/ready` | Readiness — DB در دسترس است | بدون auth |
| `GET /api/metrics` | Metrics عملیاتی | Platform admin (production) |

### ۱۱.۲. Metrics خروجی

```json
{
  "uptime_seconds": 3600,
  "total_requests": 5000,
  "count_4xx": 50,
  "count_5xx": 2,
  "error_rate": "1.04%",
  "routes": { "GET /api/catalog": { "count": 500, "avgMs": 45 } },
  "backup": {
    "last_success_at": "2026-08-24T03:00:00Z",
    "backup_age_seconds": 3600,
    "restore_test_last_success_at": "2026-08-24T05:00:00Z"
  },
  "uploads_backup": {
    "last_success_at": "2026-08-24T03:30:00Z",
    "last_success_file_count": 42
  }
}
```

### ۱۱.۳. Structured Logging

```json
{
  "timestamp": "2026-08-24T03:00:00Z",
  "level": "info",
  "service": "web",
  "message": "Request completed",
  "requestId": "abc-123",
  "userId": "uuid",
  "tenantId": "uuid",
  "route": "/api/catalog",
  "method": "GET",
  "statusCode": 200,
  "durationMs": 45
}
```

### ۱۱.۴. Redaction

۱۸ کلید حساس در logger redact می‌شوند:
`password`, `token`, `authorization`, `cookie`, `session`, `secret`, `apiKey`,
`database_url`, `DATABASE_URL`, `AUTH_SECRET`, `jwt`, `refresh_token`,
`backup_gpg_passphrase`, `BACKUP_GPG_PASSPHRASE`, `postgres_password`,
`POSTGRES_PASSWORD`, `sentry_dsn`, `SENTRY_DSN`

### ۱۱.۵. Alert Thresholds

۱۷ alert در `docs/ALERTING.md` تعریف شده، از جمله:
- 5xx rate > ۵% → SEV-1
- `/api/ready` failure × ۳ → SEV-1
- backup age > ۲۶h → SEV-1
- outbox backlog > ۱۰۰ → SEV-2
- disk usage > ۸۰% → SEV-2

---

## ۱۲. Backup و Disaster Recovery

### ۱۲.۱. RPO/RTO

| معیار | مقدار |
|---|---|
| RPO | ۲۴ ساعت (backup روزانه) |
| RTO | ۲ ساعت (restore + verify + restart) |
| Retention | ۳۰ روز (configurable) |
| Encryption | GPG symmetric AES-256 (s2k SHA-512) |
| Off-site | rsync (optional) |

### ۱۲.۲. Database Backup Pipeline

```text
pg_dump --format=custom
  → zstd -19
  → GPG symmetric AES-256
  → SHA-256 checksum
  → sanity check (decrypt + PGDMP magic)
  → rsync to off-site (optional)
  → write backup-status.json
```

### ۱۲.۳. Uploads Backup Pipeline

```text
tar (inside container)
  → zstd -19
  → GPG symmetric AES-256
  → SHA-256 checksum
  → manifest (JSON: per-file path, size, sha256, mtime)
  → rsync to off-site (optional)
  → write uploads-backup-status.json
```

### ۱۲.۴. Restore Test

Restore به دیتابیس/مسیر ایزوله (`tile_restore_test` / `uploads_restore_test`) با:
- ۸ integrity check (table count، migrations، tenant، admin، FK، RLS، SECURITY DEFINER)
- ۵ smoke query (user_contexts، expire، claim_notifications، _rate_limit_hits، app_user schema)
- Transactional test (BEGIN/INSERT/ROLLBACK)
- Per-file checksum verification (uploads)
- Cleanup با DROP DATABASE WITH (FORCE)

### ۱۲.۵. DR Runbooks

| Runbook | سناریو |
|---|---|
| `dr-database-outage.md` | PostgreSQL unavailable |
| `dr-uploads-recovery.md` | Uploads volume lost |
| `emergency-rollback.md` | Bad deployment |
| `disk-pressure-and-cleanup.md` | Disk full |
| `secret-rotation.md` | Secret rotation |
| `incident-classification.md` | SEV-1 to SEV-4 matrix |

---

## ۱۳. Privacy و Secret Lifecycle

### ۱۳.۱. Secret Inventory (۱۲ secret)

همه در `docs/audits/phase-10-privacy-secret-audit.md` با detail کامل مستند شده‌اند.

### ۱۳.۲. Privacy Data

| داده | حساسیت | Retention | Backup |
|---|---|---|---|
| Account (phone, email, password_hash) | High | Indefinite | ✅ DB backup (encrypted) |
| SMS config (API keys) | High | Indefinite | ✅ DB backup (AES-256-GCM encrypted) |
| Audit log | Medium | Indefinite (immutable) | ✅ DB backup |
| Upload files | Medium | Indefinite | ✅ Uploads backup (GPG encrypted) |
| Sessions (JWT) | Medium | ۷ days | N/A (ephemeral) |
| Backups | Critical | ۳۰ days | N/A (is backup) |

### ۱۳.۳. Findings (Phase 10)

| Finding | Status | توضیح |
|---|---|---|
| AUD-101 | ✅ Resolved | `.env.example` تکمیل شد |
| AUD-102 | ✅ Resolved | REDACTED_KEYS تکمیل شد |
| AUD-103 | Accepted Risk | Tenant deletion not in scope |
| AUD-104 | Accepted Risk | Orphan files (cleanup script exists) |

---

## ۱۴. Incident Response و Runbooks

### ۱۴.۱. Severity Matrix

| Severity | تعریف | Response |
|---|---|---|
| SEV-1 | قطعی کامل، data corruption، security breach | ۱۵ دقیقه |
| SEV-2 | بخش حیاتی از کار افتاده | ۱ ساعت |
| SEV-3 | خطای مقطعی، کندی | ۴ ساعت |
| SEV-4 | Cosmetic، non-urgent | ۷ روز |

### ۱۴.۲. Roles

- **Incident Commander** — تصمیم نهایی
- **Tech Lead** — تحلیل فنی، restore/rollback
- **On-call Engineer** — پاسخ اولیه، اجرای runbook
- **Comms** — ارتباط با کاربران

### ۱۴.۳. DR Simulation

`scripts/test-dr-simulation.sh` — ۶۴ بررسی برای آمادگی DR:
- Runbooks موجودند
- Scripts موجودند و syntax درست
- Consistency بین runbooks و scripts
- env vars مستند شده‌اند
- Alert thresholds موجودند
- RPO/RTO مستند شده‌اند
- Incident classification موجود
- Secret rotation مستند

---

## ۱۵. CI/CD و Deployment

### ۱۵.۱. CI Pipeline (GitHub Actions)

```text
Checkout → Setup Node 22 → npm ci → tsc --noEmit
  → Run migrations (apply.ts)
  → Run tests (PostgreSQL 16-alpine service)
  → Verify RLS with app_user
  → Build
  → Smoke test /api/health, /api/ready, /api/metrics
  → Install backup tools (postgresql-client-16, zstd, gpg, rsync, flock)
  → Phase 8: Backup + Verify + Restore test (ci-backup-test.sh)
  → Phase 9: Uploads Backup + Verify + Restore test (ci-uploads-backup-test.sh)
  → Upload artifacts (on failure)
```

### ۱۵.۲. Deployment

```bash
# Production
docker compose -f docker-compose.yml up -d --build

# Staging
docker compose -f docker-compose.staging.yml up -d --build

# Cron jobs (on host, not in container)
30 23 * * *  cd /opt/tile-saas && bash scripts/backup-db.sh
00 00 * * *  cd /opt/tile-saas && bash scripts/backup-uploads.sh
00 00 * * 0  cd /opt/tile-saas && bash scripts/restore-db.sh --test-only
30 01 * * 0  cd /opt/tile-saas && bash scripts/restore-uploads.sh --test-only
00 01 * * *  cd /opt/tile-saas && bash scripts/cleanup-old-backups.sh
30 01 * * *  cd /opt/tile-saas && bash scripts/cleanup-old-uploads-backups.sh
```

---

## ۱۶. نصب و راه‌اندازی

### ۱۶.۱. پیش‌نیازها

- Docker Engine + Docker Compose v2
- VPS با حداقل ۲vCPU / ۴GB RAM
- دامنه (برای Let's Encrypt) یا localhost (برای staging)

### ۱۶.۲. Production Setup

```bash
git clone https://github.com/omidhx/tile-saas.git
cd tile-saas

# ایجاد .env با مقادیر واقعی
cp .env.example .env
nano .env  # تنظیم POSTGRES_PASSWORD, AUTH_SECRET, BACKUP_GPG_PASSPHRASE

# Build و start
docker compose up -d --build

# صبر تا PostgreSQL healthy شود
docker compose exec -T postgres pg_isready -U postgres

# Migration
cd web
DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/tile_saas" \
  AUTH_SECRET="..." NODE_PATH="$(pwd)/node_modules" \
  node --import tsx ../db/migrations/apply.ts
cd ..

# ساخت اولین tenant
docker compose exec -T postgres psql -U postgres -d tile_saas \
  -f db/create-app-user.sql
# سپس از POST /api/platform/tenants برای ساخت tenant استفاده کن
```

### ۱۶.۳. Staging Setup

```bash
# مطابق docs/STAGING_VERIFICATION_CHECKLIST.md
docker compose -f docker-compose.staging.yml up -d --build
bash scripts/staging-verify.sh
```

---

## ۱۷. تست

### ۱۷.۱. آمار

| نوع | تعداد | وضعیت |
|---|---|---|
| Lib tests (no DB) | ۱۷۸ | ✅ 178/178 pass |
| DB tests (PostgreSQL) | ۵۳ فایل | ✅ (CI verified) |
| E2E (Playwright) | ۱ spec | ✅ (critical path) |
| DR simulation | ۶۴ check | ✅ 64/64 pass |
| Bash syntax | ۱۳ script | ✅ 13/13 OK |
| Hardening tests | ۹۸ | ✅ (security patterns) |

### ۱۷.۲. اجرای تست‌ها

```bash
# Lib tests (بدون PostgreSQL)
cd web
npx tsx --test src/lib/*.test.ts

# Full test suite (نیاز به PostgreSQL)
npm test

# CI mode
npm run test:ci

# E2E
npm run test:e2e

# DR simulation
bash scripts/test-dr-simulation.sh
```

---

## ۱۸. مستندات

### ۱۸.۱. فهرست مستندات

| سند | توضیح |
|---|---|
| `tile-saas-comprehensive-spec.md` | سند جامع محصول (۵۵KB) |
| `docs/ARCHITECTURE.md` | معماری سیستم |
| `docs/SECURITY.md` | امنیت و RLS |
| `docs/API_SPEC.md` | مشخصات API |
| `docs/DATABASE_SCHEMA.md` | schema و migrationها |
| `docs/BACKUP_POLICY.md` | سیاست backup (RPO/RTO/retention/encryption) |
| `docs/RESTORE_RUNBOOK.md` | دستورالعمل restore |
| `docs/DISASTER_RECOVERY.md` | DR runbook کامل |
| `docs/GO_LIVE.md` | چک‌لیست Go-Live |
| `docs/ALERTING.md` | alert thresholds و monitoring |
| `docs/KNOWN_ISSUES.md` | مسائل شناخته‌شده |
| `docs/CODING_STANDARDS.md` | استانداردهای کدنویسی |
| `docs/STAGING_EXECUTION_RUNBOOK.md` | دستورالعمل staging |
| `docs/STAGING_VERIFICATION_CHECKLIST.md` | چک‌لیست staging |
| `docs/audits/phase-10-privacy-secret-audit.md` | ممیزی Privacy/Secret |
| `docs/runbooks/secret-rotation.md` | دستورالعمل rotation |
| `docs/runbooks/incident-classification.md` | رده‌بندی رخداد |
| `docs/runbooks/dr-database-outage.md` | DR: قطعی دیتابیس |
| `docs/runbooks/dr-uploads-recovery.md` | DR: بازیابی uploads |
| `docs/runbooks/emergency-rollback.md` | rollback اضطراری |
| `docs/runbooks/disk-pressure-and-cleanup.md` | پاکسازی دیسک |
| `docs/FINAL_AUDIT_REPORT.md` | گزارش نهایی ممیزی |
| `.env.example` | نمونه‌ی متغیرهای محیطی |
| `CHANGELOG.md` | تاریخچه‌ی تغییرات |

---

## ۱۹. نقشه‌ی راه

### ۱۹.۱. فوری (پیش از Go-Live)

- [ ] اجرای staging روی Docker host (`STAGING_VERIFICATION_CHECKLIST.md`)
- [ ] اولین backup واقعی production
- [ ] اولین restore drill واقعی
- [ ] نصب cron روی VPS

### ۱۹.۲. کوتاه‌مدت (هفته‌ی اول)

- [ ] SMS provider واقعی (kavenegar/ippanel)
- [ ] اولین tenant واقعی
- [ ] Secret rotation drill روی staging

### ۱۹.۳. میان‌مدت (۱-۳ ماه)

- [ ] Load test (k6/Artillery)
- [ ] WAL archiving + PITR (RPO < ۲۴h)
- [ ] openapi.yaml
- [ ] WebSocket برای اعلان real-time
- [ ] Bale bot webhook

### ۱۹.۴. بلندمدت (۳+ ماه)

- [ ] PostgreSQL replication (standby)
- [ ] S3-compatible storage برای uploads
- [ ] Multi-region failover
- [ ] GDPR data export/delete

---

## ۲۰. مجوز

این پروژه خصوصی است و متعلق به صاحب آن است.

---

> **آخرین به‌روزرسانی:** 2026-08-24
> **Commit:** `bfa27b7`
> **وضعیت:** Implementation Complete — آماده Go-Live با operational evidence
