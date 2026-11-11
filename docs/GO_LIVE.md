# GO_LIVE: نصب، بکاپ و بازیابی روی VPS ایران

فقط یک مسیر دیپلوی داریم: همین فایل. `scripts/docker-smoke.sh` همین مراحل را در CI روی هر PR اجرا می‌کند،
پس اگر دستوری اینجا عوض شد، آن اسکریپت هم باید عوض شود. تست آن روی سرور واقعی ایران هنوز انجام نشده؛
وضعیت در `docs/PHASES.md` است.

## مسدودکننده‌ها

- **پنل پیامک واقعی.** تا وصل نشود، پیامک فقط در لاگ چاپ می‌شود و بازیابی رمز کار نمی‌کند.
- **کلید طبیعی Lot برای ایمپورت.** پیش‌فرض فاز ۵: کالا + انبار + بچ + شید + کالیبر، و `track_shade_caliber` کارخانه شید و کالیبر را خاموش یا اجباری می‌کند. اگر دو Lot با یک کلید باشد، ایمپورت آن ردیف را رد می‌کند و دلبخواه انتخاب نمی‌کند. قبل از اولین ایمپورت واقعی با کارخانه تأیید شود (فاز ۹).

## ۱. ساخت فایل نصب

روی سیستمی که Docker آن به اینترنت می‌رسد، از روی commit موردنظر:

```bash
bash scripts/release.sh
```

خروجی یک فایل است، مثل `tile-saas-31fbfba.tar`: ایمیج اپ، Postgres و Caddy به‌همراه فایل‌های اجرا.
سرور چیزی از Docker Hub یا npm دانلود نمی‌کند، چون این دو از داخل ایران پایدار نیستند.

## ۲. نیازهای سرور

Ubuntu با Docker و Compose v2، پورت‌های ۸۰ و ۴۴۳ باز، و ابزارهای بکاپ:

```bash
apt-get install -y docker.io docker-compose-v2 gnupg zstd rsync util-linux python3 file
```

نصب Docker روی سرور ایرانی آزموده نشده است. اگر مخزن‌ها در دسترس نبودند، از mirror یا ایمیج آماده‌ی هاستینگ استفاده کنید.
برای گواهی HTTPS، دامنه باید به IP سرور اشاره کند و سرور به Let's Encrypt برسد. در قطعی اینترنت بین‌الملل سایت با گواهی فعلی کار می‌کند،
ولی تمدید فقط وقتی انجام می‌شود که دسترسی برگردد. Caddy از ۳۰ روز قبل از انقضا تلاش می‌کند.
گواهی‌ها در بکاپ نیستند، پس نصب روی سرور تازه در زمان قطعی تا برگشت دسترسی HTTPS معتبر ندارد.

## ۳. نصب تازه

```bash
scp tile-saas-<tag>.tar root@<سرور>:/opt/
ssh root@<سرور>
cd /opt && tar -xf tile-saas-<tag>.tar
gunzip -c images.tar.gz | docker load
cd tile-saas
bash scripts/init-env.sh <دامنه یا IP>
docker compose up -d
docker compose ps
```

بدون دامنه می‌توانید IP بدهید؛ Caddy گواهی داخلی می‌سازد و مرورگر هشدار می‌دهد. این حالت فقط برای تست است.

**یک کپی از `.env` را بیرون از سرور نگه دارید.** بدون `BACKUP_GPG_PASSPHRASE` هیچ بکاپی باز نمی‌شود،
و بدون `AUTH_SECRET` کلیدهای پیامکی که در تنظیمات کارخانه‌ها ذخیره شده‌اند.

سرویس `migrate` با هر `up` یک‌بار اجرا می‌شود: روی دیتابیس خالی `schema.sql`، بعد migrationها، بعد نقش `app_user`.
دو نقش بیشتر نداریم: superuser فقط برای migrate و بکاپ، و `app_user` برای اپ و workerها زیر RLS.
اپ با superuser اصلاً بالا نمی‌آید. پورت Postgres منتشر نمی‌شود.

**این‌ها را هرگز پاک نکنید:** `docker compose down -v`، volumeهای `pgdata` و `uploads`، و فایل `.env`.

## ۴. اولین مدیر

فرم ثبت‌نام نداریم. مدیر پلتفرم یک‌بار از اینجا ساخته می‌شود و بقیه را از `/platform/tenants` و پنل هر کارخانه می‌سازد:

```bash
read -rs -p "رمز مدیر (حداقل ۱۲ کاراکتر): " ADMIN_PASSWORD && export ADMIN_PASSWORD
docker compose run --rm --no-deps -e ADMIN_PHONE=<موبایل> -e ADMIN_PASSWORD migrate node dist-scripts/create-admin.js
unset ADMIN_PASSWORD
```

## ۵. بکاپ

برای کپی بیرون از سرور، `BACKUP_OFFSITE_TARGET` را در `.env` پر کنید (مقصد rsync). اگر مسیر خارج از کشور ناپایدار است،
اول به یک VPS ایرانی در دیتاسنتر دیگر کپی کنید. کلید SSH را این‌طور بسازید و `.pub` را در `authorized_keys` مقصد بگذارید:
`ssh-keygen -t ed25519 -N '' -f /root/.ssh/tile_backup` و بعد `BACKUP_OFFSITE_SSH_KEY=/root/.ssh/tile_backup`.
سرور فقط بکاپ‌های خودش را پاک می‌کند؛ بکاپ‌های مقصد بیرونی را باید جدا روی همان مقصد پاک کنید.

این خطوط را با `crontab -e` روی خود سرور اضافه کنید (ساعت‌ها UTC است):

```cron
30 23 * * *  cd /opt/tile-saas && bash scripts/backup-db.sh >> /var/log/tile-backup.log 2>&1
0  0  * * *  cd /opt/tile-saas && bash scripts/backup-uploads.sh >> /var/log/tile-backup.log 2>&1
0  1  * * *  cd /opt/tile-saas && bash scripts/cleanup-old-backups.sh >> /var/log/tile-backup.log 2>&1
30 1  * * *  cd /opt/tile-saas && bash scripts/cleanup-old-uploads-backups.sh >> /var/log/tile-backup.log 2>&1
0  2  * * 0  cd /opt/tile-saas && bash scripts/restore-db.sh --test-only >> /var/log/tile-backup.log 2>&1
30 2  * * 0  cd /opt/tile-saas && bash scripts/restore-uploads.sh --test-only >> /var/log/tile-backup.log 2>&1
```

`restore-*.sh --test-only` بکاپ را در جای موقت باز و بررسی می‌کند و به داده‌ی اصلی دست نمی‌زند.
`restore-db.sh` تا وقتی اولین کارخانه ساخته نشده با «No tenants found» شکست می‌خورد؛ این برای نصب خالی طبیعی است.
نتیجه‌ی آخرین بکاپ را مدیر پلتفرم در `/api/metrics` می‌بیند.

## ۶. بازیابی واقعی

روی سرور تازه: مرحله‌ی ۳ را انجام دهید، `.env` قبلی را جای `.env` تازه بگذارید و بکاپ‌ها را از مقصد بیرونی با `scp` به `backups/daily` و `backups/uploads` بیاورید.
روی همین سرور فقط دستور زیر لازم است:

```bash
bash scripts/restore-prod.sh --overwrite-production backups/daily/<فایل>.gpg backups/uploads/<فایل>.gpg
```

فایل `.sha256` باید کنار هر بکاپ باشد. بکاپ قبل از توقف سایت کامل باز و بررسی می‌شود، پس بکاپ خراب یا رمز اشتباه سایت را از کار نمی‌اندازد.
دیتابیس فعلی پاک نمی‌شود و با نام `<db>_before_restore_<زمان>` می‌ماند. آخر کار، اسکریپت دستور حذف آن را چاپ می‌کند؛ بعد از اطمینان اجرایش کنید.

## ۷. ارتقا

اول بکاپ بگیرید. migrationها فقط رو به جلو هستند، پس برگشت به نسخه‌ی قبل یعنی بازیابی همین بکاپ.

```bash
bash scripts/backup-db.sh
cd /opt && tar -xf tile-saas-<tag>.tar && gunzip -c images.tar.gz | docker load
cd tile-saas
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$(cat IMAGE_TAG)/" .env
docker compose up -d
```

برگشت به نسخه‌ی قبل: اول `IMAGE_TAG` را در `.env` به نسخه‌ی قبل برگردانید، بعد بکاپ را با مرحله‌ی ۶ بازیابی کنید.
برای آزاد کردن دیسک، بعد از اطمینان از نسخه‌ی تازه، `images.tar.gz` را پاک کنید و `docker image prune -a` بزنید.

تغییر schema فقط با فایل تازه در `db/migrations/`؛ `db/schema.sql` برای نصب تازه است و باید هم‌زمان به‌روز شود. راهنما: `db/migrations/README.md`.

## ۸. عوض کردن رمزها

| رمز | روش |
|---|---|
| `APP_USER_PASSWORD` | در `.env` عوض کنید و `docker compose up -d`. سرویس migrate آن را اعمال می‌کند. |
| `POSTGRES_PASSWORD` | **اول** `docker compose exec postgres psql -U postgres -c "ALTER ROLE postgres PASSWORD '<رمز تازه>'"`، بعد در `.env`. به‌ترتیب برعکس، migrate دیگر وصل نمی‌شود. |
| `BACKUP_GPG_PASSPHRASE` | در `.env` عوض کنید. بکاپ‌های قدیمی فقط با رمز قدیمی باز می‌شوند، پس آن را هم نگه دارید. |
| `AUTH_SECRET` | در `.env` عوض کنید و `docker compose up -d`. همه خارج می‌شوند و کلیدهای پیامک باید در تنظیمات هر کارخانه دوباره وارد شوند. |

## ۹. پایش

- `docker compose ps`: همه باید `running` باشند و `migrate` با کد ۰ خارج شده باشد. worker خراب `Restarting` نشان داده می‌شود.
- `docker compose logs worker-expire worker-outbox worker-housekeeping --tail=20`
- هفتگی، پیامک‌های ناموفق. worker پیامک با خطای پنل خراب نشان داده نمی‌شود، پس این را نگاه کنید (ایمپورتِ خراب هیچ ردیفی نمی‌نویسد و خطایش همان لحظه روی صفحه است):
  ```bash
  docker compose exec postgres psql -U postgres -d tile_saas -c "SELECT count(*) FROM notification_outbox WHERE status='failed'"
  ```
- worker انقضا برای درستی موجودی حیاتی نیست، چون held همیشه از روی زمان انقضا حساب می‌شود. worker پیامک اگر بایستد، اعلان‌ها فقط عقب می‌افتند.

## ۱۰. تست دسترسی از VPS ایرانی

بعد از مرحله‌ی ۳ روی سرور ایرانی، این‌ها را اجرا کنید و نتیجه را در `docs/PHASES.md` بنویسید:

```bash
docker compose ps
curl -sS -o /dev/null -w '%{http_code}\n' https://<دامنه>/api/ready
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://registry-1.docker.io/v2/
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' https://acme-v02.api.letsencrypt.org/directory
```

بعد از یک موبایل با اینترنت داخلی و بدون VPN سایت را باز کنید و وارد شوید.

## ۱۱. تصمیم‌های باز با کارخانه (spec بخش ۷)

- شید و کالیبر دیجیتال ثبت می‌شوند؟ `track_shade_caliber` پیش‌فرض `optional` است.
- برند در سطح Product یا Lot.
- فایل اکسل کارخانه «snapshot» است یا «فقط تغییرات». الان فقط snapshot پیاده شده.
- تأیید خودکار پیش‌فرض خاموش است و عمداً خاموش می‌ماند. قبل از روشن‌کردن، قیمت همه‌ی کالاهای فعال ثبت شده باشد و هفته‌ی اول `sales_request` با `approval_mode='auto'` مرور شود.
- عکس محصول روی دیسک سرور است و در بکاپ آپلودها می‌آید. Object Storage داخل ایران (آروان/چابکان) فعلاً لازم نیست؛ `next/image` را به هاست خارجی وصل نکنید.
