# DISASTER_RECOVERY — Runbook کاملِ بازیابیِ فاجعه

> **این سند سناریوهای کاملِ DR را پوشش می‌دهد:** از دست رفتنِ کاملِ VPS،
> خرابیِ داده‌ی production، حمله‌ی مهاجم، خرابیِ region.
>
> **تفاوت با `RESTORE_RUNBOOK.md`:** آن سند فقط restore دیتابیس است. این سند
> کلِ بازیابیِ سرویس را پوشش می‌دهد — VPS جدید، DNS، TLS، application،
> database، verification، postmortem.

---

## ۱. Trigger Conditions — چه زمانی DR فعال می‌شود؟

DR را فعال کنید اگر **یکی** از این شرایط برقرار است:

| # | Condition | Severity | Action |
|---|---|---|---|
| 1 | VPS از دست رفته (provider down، hardware failure) | **Critical** | Provision VPS جدید + restore کامل |
| 2 | داده‌ی production از بین رفته/خراب شده (DROP، DELETE، ransomware) | **Critical** | Restore از بکاپ (RESTORE_RUNBOOK) |
| 3 | Storage volume خراب (I/O errors، filesystem corruption) | **Critical** | Volume جدید + restore |
| 4 | مهاجم به دیتابیس دسترسی پیدا کرده | **Critical** | Rotate secrets + rebuild از بکاپ |
| 5 | Region/data center down | **Critical** | Provision در region دیگر |
| 6 | Backups هم خراب هستند (آخرینِ موفق قدیمی‌تر از ۳۰ روز) | **Catastrophic** | نجاتِ هرچه ممکن است + postmortem |
| 7 | Ransomware روی سرور | **Critical** | ترافیک قطع + rebuild کامل |
| 8 | گزارشِ data breach | **Critical** | Rotate secrets + notify affected users |

### معیارهای عدم فعال‌سازی DR

این موارد DR لازم ندارند:

- Slow query (به‌جای آن، monitoring + index tuning)
- Single container restart (Docker restart policy کافی است)
- Single tenant投诉 (به‌جای آن، customer support)
- Single user cannot login (به‌جای آن، password reset)

---

## ۲. Roles and Responsibilities

| Role | Who | Responsibility |
|---|---|---|
| **Incident Commander (IC)** | CTO یا مدیرِ فنی | تصمیم‌گیریِ نهایی، تخصیصِ منابع |
| **On-call engineer** | نفرِ تعیین‌شده در rotation | اجرایِ restore، debugging، communication با IC |
| **DBA** | On-call engineer یا متخصص | database restore، integrity checks |
| **Comms** | مدیرِ محصول یا support | ارتباط با کاربران، اعلانِ downtime |
| **Postmortem owner** | IC تعیین می‌کند | نوشتنِ postmortem در ۴۸ ساعت |

> **اگر نفرِ تعیین‌شده در دسترس نیست:** IC جایگزین تعیین می‌کند. هیچ‌وقت منتظرِ
> نفرِ خاص نمانید — RTO مهم‌تر از org chart است.

---

## ۳. Incident Classification

| Severity | Definition | Examples | Target RTO | Target RPO |
|---|---|---|---|---|
| **SEV-1 (Critical)** | Production down یا داده از دست رفته | VPS down، DB corrupted | ۲ ساعت | ۲۴ ساعت |
| **SEV-2 (High)** | Degraded service، subset of users affected | Single tenant broken، slow queries | ۸ ساعت | ۲۴ ساعت |
| **SEV-3 (Medium)** | Minor issue، workaround موجود | Staging down، single feature broken | ۲۴ ساعت | N/A |
| **SEV-4 (Low)** | Cosmetic یا non-urgent | UI bug، doc typo | ۷ روز | N/A |

> این سند فقط برایِ SEV-1 است. SEV-2 با RESTORE_RUNBOOK.md انجام می‌شود.

---

## ۴. Infrastructure Rebuild

### ۴.۱ Provision VPS جدید

```bash
# ۱. VPS جدید با مشخصاتِ مشابه (یا بهتر) provision کنید
#    Spec پیشنهادی: 2 vCPU, 4GB RAM, 80GB SSD, Ubuntu 22.04 LTS
#    در ایران: схема‌های هetzner-asia, ParsPack, Afranet, Iranserver

# ۲. SSH به VPS جدید
ssh root@NEW_VPS_IP

# ۳. به‌روزرسانیِ سیستم
apt update && apt upgrade -y

# ۴. نصبِ Docker و Docker Compose
curl -fsSL https://get.docker.com | bash
apt install -y docker-compose-plugin zstd gpg rsync postgresql-client

# ۵. کاربرِ غیرِ root برایِ application
adduser tile --disabled-password --gecos ""
usermod -aG docker tile
```

### ۴.۲ Clone repository

```bash
su - tile
cd /home/tile
git clone https://github.com/omidhx/tile-saas.git
cd tile-saas
git checkout main
git pull
```

### ۴.۳ بازیابیِ secrets

**این حساس‌ترین مرحله‌ست.** اگر secrets را گم کنید، نمی‌توانید سرویس را بالا بیاورید.

| Secret | چگونه انتقال |
|---|---|
| `AUTH_SECRET` | از password manager یا `.env` روی VPS قدیمی (اگر هنوز در دسترس است) |
| `POSTGRES_PASSWORD` | از password manager یا `.env` روی VPS قدیمی |
| `BACKUP_GPG_PASSPHRASE` | از password manager — حیاتی برایِ restore |
| `SENTRY_DSN` | از Sentry dashboard (sentry.io) |
| SMS provider keys | از داشبوردِ provider (kavenegar، ippanel، ...) |
| SSL/TLS private key | اگر Caddyfile با Let's Encrypt است، خودکار دوباره گرفته می‌شود |

```bash
# ایجادِ .env از .env.example
cp .env.example .env
nano .env  # مقادیر واقعی را پر کنید

# یا کپیِ امن از VPS قدیمی (اگر هنوز قابلِ دسترسی است)
scp root@OLD_VPS:/opt/tile-saas/.env .env
```

> **اگر VPS قدیمی از دسترس خارج شده و secrets در آن هستند:**
> 1. AUTH_SECRET را regenerate کنید (ولی این یعنی همه‌ی sessionهای فعلی invalidate می‌شوند)
> 2. POSTGRES_PASSWORD را در حین restore دوباره set کنید (مهم نیست چه مقدار، چون دیتابیس جدید است)
> 3. BACKUP_GPG_PASSPHRASE را باید داشته باشید — اگر نه، بکاپ‌ها قابلِ بازیابی نیستند

---

## ۵. Database Restore

به `docs/RESTORE_RUNBOOK.md` بخشِ ۳ مراجعه کنید. به‌طور خلاصه:

```bash
# ۱. Docker Compose را بالا بیاور (فقط postgres)
docker compose up -d postgres

# ۲. صبر تا postgres ready شود
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" 2>/dev/null; do
  echo "Waiting for postgres..."
  sleep 2
done

# ۳. آخرین بکاپ را از off-site دانلود کنید
# (یا اگر روی storage خارج از VPS قبلی بود، از آنجا)
rsync -avz user@backup.example.com:/backups/tile-saas/ backups/daily/

# ۴. Restore کامل (مطابق RESTORE_RUNBOOK.md بخش ۳)
bash scripts/restore-db.sh --test-only  # ابتدا تست
# سپس production restore:
# (دستی مطابق RESTORE_RUNBOOK.md 3.1 تا 3.10)
```

---

## ۶. Application Deployment

```bash
# ۱. Build و start
docker compose up -d --build

# ۲. صبر تا application ready شود
until curl -fsS http://localhost:3000/api/ready 2>/dev/null | grep -q '"status":"ready"'; do
  echo "Waiting for app..."
  sleep 5
done

# ۳. بررسیِ migrationها
docker compose exec -T web node --import tsx db/migrations/apply.ts
```

---

## ۷. DNS and TLS Recovery

### ۷.۱ DNS

```bash
# اگر DNS روی Cloudflare/Porkbun/Namecheap است:
# ۱. A record را به IPِ VPS جدید آپدیت کنید
# ۲. TTL را کوتاه کنید (مثلاً 60s) تا propagation سریع‌تر باشد
# ۳. صبر کنید (معمولاً ۵–۳۰ دقیقه برایِ کاربرانِ ایرانی)

# بررسیِ propagation
dig +short tile.example.com
# یا
curl -fsS https://dns.google/resolve?name=tile.example.com | jq
```

### ۷.۲ TLS

اگر Caddy استفاده می‌کنید (پیش‌فرض)، خودکار certificate می‌گیرد:

```bash
# Caddy logs را چک کنید
docker compose logs caddy | grep -i certificate

# اگر cert گرفته نشد:
docker compose restart caddy
sleep 10
docker compose logs caddy --tail 50
```

اگر Let's Encrypt rate limit خورده‌اید (۵ cert در ۷ روز برایِ همان domain):

- از certbot manual با DNS-01 challenge استفاده کنید
- یا cert قبلی را از VPS قدیمی (اگر قابلِ دسترسی است) کپی کنید

---

## ۸. Verification Checklist

بعد از restore کامل، این چک‌لیست را اجرا کنید:

```text
[ ] DNS به IP جدید resolve می‌شود
[ ] HTTPS کار می‌کند (certificate معتبر)
[ ] http://localhost:3000/api/health → 200 (liveness)
[ ] http://localhost:3000/api/ready → 200 (readiness + DB)
[ ] Login با platform admin موفق است
[ ] Login با یک کاربرِ عادی موفق است
[ ] /staff/catalog صفحه بارگذاری می‌شود
[ ] /staff/ledger داده نشان می‌دهد
[ ] یک reservation ایجاد می‌شود
[ ] یک customer ایجاد می‌شود
[ ] یک product ایجاد می‌شود
[ ] آپلود فایل کار می‌کند (POST /api/upload)
[ ] SMS provider تست می‌شود (ارسالِ پیامکِ تست)
[ ] Workerها در حالِ اجرا هستند (docker compose ps)
[ ] Sentry events در dashboard ظاهر می‌شوند
[ ] لاگ application خطای جدید ندارد
[ ] Database integrity checks پاس شدند
[ ] RPO واقعی محاسبه شد
[ ] RTO واقعی محاسبه شد
[ ] کاربران در جریان قرار گرفتند (اگر SEV-1 بود)
```

---

## ۹. Rollback Procedure

اگر VPS جدید هم مشکل دارد، به VPS قدیمی (اگر هنوز در دسترس است) برگردید:

```bash
# ۱. DNS را به IPِ قبلی برگردانید
# ۲. در VPS قدیمی، application را restart کنید
# ۳. بررسی کنید که آیا داده‌ی production روی VPS قدیمی هنوز سالم است یا نه
#    (ممکن است همین دلیلِ خرابی باشد)
```

اگر VPS قدیمی هم قابلِ استفاده نیست و VPS جدید هم مشکل دارد، **DR failure** است
و باید به fallback ساده‌تر (مثلاً static page "در حال تعمیر") منتقل شوید.

---

## ۱۰. Post-Incident Review

ظرفِ ۴۸ ساعتِ پس از stabilize شدنِ سرویس، postmortem بنویسید.

### قالبِ Postmortem

```markdown
# Postmortem: [Incident Title] — [Date]

## Summary
(یک پاراگراف — چه اتفاقی افتاد، چند کاربر تحت تأثیر، چقدر طول کشید)

## Timeline
(همه‌ی timestamps به UTC)
- 2026-08-24 10:00 UTC — First alert fired
- 2026-08-24 10:05 UTC — On-call acknowledged
- 2026-08-24 10:15 UTC — Root cause identified
- 2026-08-24 10:30 UTC — Restore started
- 2026-08-24 11:30 UTC — Service restored
- 2026-08-24 11:45 UTC — Traffic returned

## Impact
- Users affected: ~X
- Duration of downtime: 1h 45m
- Data lost: none / N hours (RPO)
- Revenue impact: ~$X (if measurable)

## Root Cause
(چرا این اتفاق افتاد؟)

## What went well
- ...

## What went poorly
- ...

## Action items
- [ ] Action 1 — Owner: NAME — Due: DATE
- [ ] Action 2 — Owner: NAME — Due: DATE
```

### Action items معمول

- اضافه‌کردنِ alert که زودتر تشخیص می‌داد
- بهبودِ runbook (این سند را به‌روزرسانی کنید)
- Backup frequency افزایش (اگر RPO بزرگ بود)
- Multi-AZ deployment (اگر region down بود)
- Penetration test (اگر data breach بود)

---

## ۱۱. Communication Plan

### Internal

- **Slack/Telegram channel:** `#incidents` (یا معادل)
- IC هر ۱۵ دقیقه update می‌دهد
- تمامِ engineers حضور دارند برایِ support

### External (users)

- **Status page:** اگر دارید، update کنید (مثل status.example.com)
- **Email/SMS:** اگر بیش از ۱ ساعت downtime، به همه‌ی active users
- **In-app banner:** بعد از restore، banner "we had an issue, please check your data"

### Regulatory

- اگر داده‌ی شخصیِ کاربران تحت تأثیر قرار گرفته، قوانینِ Iran's data protection
  و GDPR (اگر کاربر اتحادیه‌ی اروپا هست) ممکن است disclosure الزامی کند.

---

## ۱۲. Appendices

### الف) Quick Reference — مسیرهای مهم

| مسیر | توضیح |
|---|---|
| `/opt/tile-saas/` | مسیرِ پروژه روی VPS |
| `/opt/tile-saas/backups/daily/` | بکاپ‌های روزانه |
| `/opt/tile-saas/backups/status/backup-status.json` | فایلِ status |
| `/opt/tile-saas/.env` | secrets |
| `/var/log/tile-saas-backup.log` | لاگِ backup script |
| `docker compose -f /opt/tile-saas/docker-compose.yml logs web` | لاگِ app |

### ب) Off-site Backup Locations

(این بخش را با اطلاعاتِ واقعیِ off-site storage پر کنید)

```text
Primary off-site:   rsync://backup.example.com/backups/tile-saas/
Secondary (if any): S3-compatible URL
Passphrase stored:  1Password vault → "tile-saas-backup-passphrase"
SSH key for rsync:  /root/.ssh/backup_key (private), public key on backup host
```

### ج) Contacts

(این بخش را با اطلاعاتِ واقعی پر کنید)

```text
Incident Commander:  [Name] — [Telegram/Phone]
On-call engineer:    [Name] — [Telegram/Phone]
VPS provider support: [URL/Phone]
DNS provider:        [Cloudflare/Porkbun/etc] — [login URL]
```

---

## ۱۳. Exercise و Testing

DR runbook اگر تست نشده باشد، در لحظه‌ی فاجعه بی‌فایده است.

| Exercise | Frequency | Goal |
|---|---|---|
| **Restore test (CI)** | هر push | اسکریپت کار می‌کند |
| **Manual restore test** | هفتگی | مطمئن شوید operator بلد است |
| **Full DR drill** | فصلی | VPS جدید + DNS + restore کامل |
| **Tabletop exercise** | نیم‌سالانه | تیم سناریو را on paper طی می‌کند |

> **پیشنهاد:** در اولین فرصت، یک full DR drill در یک VPS staging اجرا کنید.
> این کار ناگذیر می‌کند همه‌ی مراحلِ این سند را امتحان کنید و باگ‌های پنهان
> (مثلاً DNS TTL طولانی، missing secret، نسخه‌ی ناسازگار) را پیدا کنید.
