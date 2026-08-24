# Secret Rotation Runbook

> **هدف:** پروسه‌های گام‌به‌گام برای چرخش (rotation) تمام secret‌های پروژه‌ی
> tile-saas با حداقل downtime و حفظ قابلیت بازیابی.
>
> **مخاطب:** On-call engineer، platform admin
>
> **پیش‌نیاز:** دسترسی SSH به VPS، دسترسی superuser به PostgreSQL،
> password manager / vault برای ذخیره‌ی secret‌های جدید.

---

## ۱. AUTH_SECRET Rotation

### ۱.۱. توضیح

`AUTH_SECRET` برای امضای JWT (session) و مشتق‌سازی کلید رمزنگاری `secretBox.ts`
(برای `sms_config`) استفاده می‌شود. rotation آن **تمام session‌های فعال را
invalidate می‌کند** (کاربران باید دوباره login کنند) و **sms_config‌های
رمزنگاری‌شده با کلید قدیمی غیرقابل decrypt می‌شوند**.

### ۱.۲. پیش‌نیازها

- [ ] تأیید با تیم که session invalidation قابل‌قبول است (ترجیحاً در ساعت کم‌ترافیک).
- [ ] backup از دیتابیس گرفته شده (برای recovery در صورت نیاز).
- [ ] دسترسی به password manager برای ذخیره‌ی secret جدید.

### ۱.۳. مراحل

```bash
# ۱. تولید secret جدید (حداقل ۳۲ کاراکتر)
NEW_SECRET=$(openssl rand -base64 32)
echo "New AUTH_SECRET generated (NOT printed here for security)"

# ۲. ذخیره در password manager (دستی)

# ۳. آپدیت .env روی VPS
ssh root@vps
cd /opt/tile-saas
# backup از .env فعلی
cp .env .env.backup.$(date +%Y%m%d)
# آپدیت AUTH_SECRET
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=${NEW_SECRET}|" .env
# verify (نباید مقدار چاپ شود — فقط طول)
grep "^AUTH_SECRET=" .env | wc -c

# ۴. Re-encrypt sms_config (CRITICAL — sms_config با کلید قدیمی رمزنگاری شده)
# اگر این مرحله انجام نشود، tenant‌ها نمی‌توانند پیامک بفرستند.
# راه‌حل: برای هر tenant، sms_config را با کلید جدید re-encrypt کن.
# این نیاز به script دارد — فعلاً دستی:
docker compose exec -T postgres psql -U postgres -d tile_saas -c "
  SELECT id, sms_config IS NOT NULL as has_sms FROM tenant WHERE sms_config IS NOT NULL;
"
# برای هر tenant با sms_config:
#   ۱. Decrypt با کلید قدیمی (نیاز به secretBox با AUTH_SECRET قدیمی)
#   ۲. Encrypt با کلید جدید
#   ۳. UPDATE tenant SET sms_config = new_encrypted WHERE id = ...
# TODO: script برای automate این فرآیند

# ۵. Restart application
docker compose restart web worker-expire worker-outbox

# ۶. Verify
curl -s http://localhost:3000/api/health
# انتظار: {"status":"ok"}

# ۷. تست login (دستی)
# - یک کاربر باید بتواند login کند
# - session‌های قدیمی باید invalid باشند (کاربران قبلی باید دوباره login کنند)

# ۸. پاک‌سازی backup
rm .env.backup.*  # فقط پس از تأیید موفقیت
```

### ۱.۴. Rollback

```bash
# اگر مشکلی پیش آمد:
cp .env.backup.* .env
docker compose restart web worker-expire worker-outbox
# نکته: session‌های بین rotation و rollback از دست رفته‌اند
```

### ۱.۵. Impact

- **Session invalidation:** تمام کاربران باید دوباره login کنند.
- **sms_config:** اگر re-encrypt نشود، tenant‌ها نمی‌توانند پیامک بفرستند.
- **Downtime:** ~۳۰ ثانیه (restart).
- **Recovery:** `.env.backup` برای rollback.

---

## ۲. BACKUP_GPG_PASSPHRASE Rotation

### ۲.۱. توضیح

`BACKUP_GPG_PASSPHRASE` برای رمزنگاری symmetric (AES-256) تمام backup‌ها
استفاده می‌شود. rotation آن **backup‌های قدیمی با passphrase قدیمی باقی می‌مانند**
— برای restore آن‌ها به passphrase قدیمی نیاز است.

### ۲.۲. پیش‌نیازها

- [ ] لیست تمام backup‌های موجود (محلی و off-site).
- [ ] Password manager برای ذخیره‌ی passphrase قدیمی (برای restore backup‌های قدیمی).
- [ ] فضای دیسک کافی برای re-encrypt (در صورت انتخاب).

### ۲.۳. استراتژی

دو گزینه وجود دارد:

**گزینه A (ساده، توصیه‌شده):** passphrase جدید برای backup‌های آینده. passphrase
قدیمی در vault نگه‌داری می‌شود برای restore backup‌های قدیمی. پس از انقضای
retention (۳۰ روز)، passphrase قدیمی قابل حذف است.

**گزینه B (پرکار):** re-encrypt تمام backup‌های موجود با passphrase جدید.

### ۲.۴. مراحل (گزینه A)

```bash
# ۱. تولید passphrase جدید
NEW_PASSPHRASE=$(openssl rand -base64 32)
echo "New BACKUP_GPG_PASSPHRASE generated (NOT printed)"

# ۲. ذخیره passphrase قدیمی در vault (دستی)
#    نام: tile-saas-backup-gpg-passphrase-old-YYYYMMDD
#    مقدار: (passphrase قدیمی از .env فعلی)

# ۳. آپدیت .env روی VPS
ssh root@vps
cd /opt/tile-saas
cp .env .env.backup.$(date +%Y%m%d)
sed -i "s|^BACKUP_GPG_PASSPHRASE=.*|BACKUP_GPG_PASSPHRASE=${NEW_PASSPHRASE}|" .env

# ۴. تست backup با passphrase جدید
bash scripts/backup-db.sh
bash scripts/verify-backup.sh
# انتظار: exit 0

# ۵. تست restore یک backup قدیمی با passphrase قدیمی
BACKUP_GPG_PASSPHRASE="old-passphrase-from-vault" bash scripts/verify-backup.sh backups/daily/oldest-backup.sql.zstd.gpg
# انتظار: exit 0 (backup قدیمی با passphrase قدیمی هنوز قابل restore است)

# ۶. آپدیت staging و CI (اگر passphrase جداگانه دارند)
# - staging .env
# - CI secrets (GitHub Actions)

# ۷. بعد از انقضای retention (۳۰ روز):
#    - passphrase قدیمی را از vault حذف کن (برای backup‌های قدیمی دیگر قابل restore نیست)
#    - backup‌های قدیمی با cleanup-old-backups.sh حذف می‌شوند
```

### ۲.۵. مراحل (گزینه B — re-encrypt)

```bash
# برای هر backup file در backups/daily/ و backups/uploads/:
for f in backups/daily/*.gpg backups/uploads/*.gpg; do
  # ۱. decrypt با passphrase قدیمی
  echo "old-passphrase" | gpg --decrypt "$f" > "${f%.gpg}.decrypted"
  # ۲. re-encrypt با passphrase جدید
  echo "new-passphrase" | gpg --symmetric --output "${f}.new" "${f%.gpg}.decrypted"
  # ۳. verify
  echo "new-passphrase" | gpg --decrypt "${f}.new" > /dev/null
  # ۴. replace
  mv "${f}.new" "$f"
  rm "${f%.gpg}.decrypted"
done
# ۵. آپدیت checksum files
for f in backups/daily/*.gpg backups/uploads/*.gpg; do
  sha256sum "$f" > "${f}.sha256"
done
```

### ۲.۶. Rollback

```bash
cp .env.backup.* .env
# نکته: backup‌های جدید با passphrase جدید ساخته شده‌اند — با passphrase قدیمی قابل restore نیستند
```

### ۲.۷. Impact

- **Backup‌های قدیمی:** با passphrase قدیمی قابل restore (تا انقضای retention).
- **Backup‌های جدید:** با passphrase جدید.
- **Downtime:** ۰ (بدون restart لازم — backup scripts passphrase را از env می‌خوانند).
- **Recovery:** `.env.backup` برای rollback.

---

## ۳. POSTGRES_PASSWORD Rotation

### ۳.۱. توضیح

`POSTGRES_PASSWORD` برای اتصال اپلیکیشن و backup scripts به PostgreSQL استفاده
می‌شود. rotation آن نیاز به `ALTER ROLE` + آپدیت `.env` + restart دارد.

### ۳.۲. پیش‌نیازها

- [ ] دسترسی superuser به PostgreSQL.
- [ ] تأیید با تیم که restart قابل‌قبول است.

### ۳.۳. مراحل

```bash
# ۱. تولید password جدید
NEW_PASSWORD=$(openssl rand -base64 24)
echo "New POSTGRES_PASSWORD generated (NOT printed)"

# ۲. آپدیت PostgreSQL password
ssh root@vps
docker compose exec -T postgres psql -U postgres -c "ALTER ROLE tile_app PASSWORD '${NEW_PASSWORD}';"
# اگر app_user استفاده می‌شود:
docker compose exec -T postgres psql -U postgres -c "ALTER ROLE app_user PASSWORD '${NEW_PASSWORD}';"

# ۳. آپدیت .env
cd /opt/tile-saas
cp .env .env.backup.$(date +%Y%m%d)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PASSWORD}|" .env
# اگر DATABASE_URL هم password دارد:
sed -i "s|://tile_app:[^@]*@|://tile_app:${NEW_PASSWORD}@|" .env
# یا:
# sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://tile_app:${NEW_PASSWORD}@localhost:5432/tile_saas|" .env

# ۴. Restart application (برای pickup کردن password جدید)
docker compose restart web worker-expire worker-outbox

# ۵. Verify
docker compose exec -T postgres pg_isready -U tile_app
curl -s http://localhost:3000/api/ready
# انتظار: {"status":"ready"}

# ۶. تست backup با password جدید
bash scripts/backup-db.sh
# انتظار: exit 0

# ۷. پاک‌سازی
rm .env.backup.*
```

### ۳.۴. Rollback

```bash
# اگر مشکلی پیش آمد:
docker compose exec -T postgres psql -U postgres -c "ALTER ROLE tile_app PASSWORD 'old-password';"
cp .env.backup.* .env
docker compose restart web worker-expire worker-outbox
```

### ۳.۵. Impact

- **Downtime:** ~۳۰ ثانیه (restart).
- **Session‌ها:** Invalid نمی‌شوند (JWT با AUTH_SECRET امضا می‌شود، نه با POSTGRES_PASSWORD).
- **Recovery:** `.env.backup` + `ALTER ROLE` برای rollback.

---

## ۴. BACKUP_OFFSITE_SSH_KEY Rotation

### ۴.۱. توضیح

SSH key برای rsync به backup host. rotation نیاز به generate key جدید + update
`authorized_keys` روی backup host دارد.

### ۴.۲. مراحل

```bash
# ۱. تولید SSH key جدید
ssh-keygen -t ed25519 -f /root/.ssh/tile-saas-backup-key-new -N ""

# ۲. اضافه‌کردن public key جدید به authorized_keys روی backup host
ssh backup-host
echo "$(cat /root/.ssh/tile-saas-backup-key-new.pub) $(whoami)@$(hostname)" >> ~/.ssh/authorized_keys
exit

# ۳. تست با key جدید
rsync -e "ssh -i /root/.ssh/tile-saas-backup-key-new" -avz /tmp/test-file backup-host:/tmp/
# انتظار: موفق

# ۴. آپدیت .env
cd /opt/tile-saas
cp .env .env.backup.$(date +%Y%m%d)
sed -i "s|^BACKUP_OFFSITE_SSH_KEY=.*|BACKUP_OFFSITE_SSH_KEY=/root/.ssh/tile-saas-backup-key-new|" .env

# ۵. تست backup با key جدید
bash scripts/backup-db.sh
# انتظار: exit 0 + "rsync OK"

# ۶. حذف key قدیمی از authorized_keys (بعد از تأیید موفقیت)
ssh backup-host
# ویرایش authorized_keys و حذف خط key قدیمی
exit

# ۷. حذف key file قدیمی
rm /root/.ssh/tile-saas-backup-key
rm /root/.ssh/tile-saas-backup-key.pub
```

### ۴.۳. Rollback

```bash
cp .env.backup.* .env
# نکته: key قدیمی هنوز در /root/.ssh/ است اگر حذف نشده باشد
```

### ۴.۴. Impact

- **Downtime:** ۰ (بدون restart لازم).
- **Backup‌های قدیمی:** تحت تأثیر قرار نمی‌گیرند (SSH key فقط برای rsync است).
- **Recovery:** `.env.backup` + key file قدیمی.

---

## ۵. Emergency Revoke و Rollback

### ۵.۱. سناریوی نشت کلید

اگر هر secret به‌طور مشکوکی نشت کرده باشد:

```bash
# ۱. فوراً secret را rotate کن (طبق runbook‌های بالا)
# ۲. بررسی کن آیا نشت در log‌ها قابل مشاهده است:
docker compose logs --since=24h | grep -i "secret\|password\|passphrase" | head -20
# ۳. بررسی GitHub Actions logs برای نشت:
#    https://github.com/omidhx/tile-saas/actions
# ۴. اگر BACKUP_GPG_PASSPHRASE نشت کرده:
#    - تمام backup‌های موجود را با passphrase جدید re-encrypt کن (گزینه B در بخش ۲)
#    - passphrase قدیمی را از vault حذف کن
# ۵. اگر AUTH_SECRET نشت کرده:
#    - session‌های همه invalidated می‌شوند (by design)
#    - sms_config‌ها باید re-encrypt شوند
# ۶. اگر POSTGRES_PASSWORD نشت کرده:
#    - password را فوراً تغییر بده
#    - بررسی کن آیا دسترسی غیرمجاز به DB بوده:
docker compose exec -T postgres psql -U postgres -c "
  SELECT pid, usename, client_addr, state, query_start
  FROM pg_stat_activity WHERE state = 'active';
"
# ۷. اگر SSH key نشت کرده:
#    - key قدیمی را از authorized_keys روی backup host حذف کن
#    - backup host را بررسی کن برای دسترسی غیرمجاز
```

### ۵.۲. تماس با تیم

- **Incident Commander:** [نام و شماره تماس]
- **On-call engineer:** [نام و شماره تماس]
- **Backup host admin:** [نام و شماره تماس]

### ۵.۳. Post-incident

- [ ] Postmortem در ۴۸ ساعت (طبق `docs/DISASTER_RECOVERY.md` بخش ۱۰).
- [ ] بررسی اینکه چطور نشت رخ داد.
- [ ] action items برای جلوگیری از تکرار.
- [ ] اگر داده‌ی کاربران تحت تأثیر قرار گرفته، اطلاع‌رسانی (طبق قوانین ایران/GDPR).

---

## ۶. Key Versioning

### ۶.۱. وضعیت فعلی

پروژه فعلاً **key versioning ندارد** — هر secret فقط یک نسخه دارد. این برای
MVP قابل‌قبول است، ولی اگر rotation مکرر لازم باشد (مثلاً quarterly)، باید
key versioning اضافه شود:

```text
AUTH_SECRET_V1=old-secret
AUTH_SECRET_V2=new-secret
# session.ts: اگر V2 موجود است از V2 استفاده کن، وگرنه V1
# برای verify JWT: هر دو V1 و V2 را امتحان کن (برای session‌های قدیمی)
```

### ۶.۲. توصیه

- فعلاً **بدون key versioning** — rotation rotation نیست (اولین rotation است).
- بعد از اولین production rotation، اگر نیاز به rotation مکرر بود، key versioning اضافه شود.
- `BACKUP_GPG_PASSPHRASE` نیازی به versioning ندارد — passphrase قدیمی در vault نگه‌داری می‌شود.

---

## ۷. contacts

| نقش | نام | تماس |
|---|---|---|
| Incident Commander | [填写] | [填写] |
| On-call engineer | [填写] | [填写] |
| Backup host admin | [填写] | [填写] |
| Password manager admin | [填写] | [填写] |

> **نکته:** این فیلدها باید قبل از go-live با اطلاعات واقعی پر شوند.
