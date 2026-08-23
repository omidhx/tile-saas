# ALERTING — Thresholds و Runbook

> این فایل thresholdهای alerting را تعریف می‌کند. برای MVP، alerting با
> Sentry error tracking + manual monitoring (مطالعه‌ی `/api/metrics`) انجام
> می‌شود. در آینده می‌توان به Prometheus/Grafana منتقل شد.

---

## Alert Thresholds

| Metric | Threshold | Severity | Action |
|---|---|---|---|
| 5xx rate | > 5% در ۵ دقیقه | **Critical** | بررسی Sentry + restart اپ |
| `/api/ready` failure | ۳ پشت سر هم | **Critical** | بررسی DB connection + restart |
| `/api/health` failure | ۳ پشت سر هم | **Critical** | Restart container |
| DB unavailable | `/api/ready` = 503 | **Critical** | بررسی PostgreSQL + volume |
| outbox backlog | > ۱۰۰ پیام pending > ۱۰ دقیقه | **High** | بررسی worker-outbox + SMS provider |
| worker-expire failure | worker log خطا دارد | **Medium** | بررسی `expire_due_reservations()` |
| disk usage | > ۸۰% | **High** | پاک‌سازی `private/uploads/` با `cleanup-orphan-uploads.ts` |
| TLS certificate | < ۳۰ روز تا انقضا | **Medium** | تمدید Let's Encrypt |
| 401 spike | > ۵۰ در دقیقه | **Medium** | احتمال brute-force — بررسی rate limit |
| 403 spike | > ۵۰ در دقیقه | **Medium** | احتمال IDOR attempt — بررسی Sentry tags |
| 429 spike | > ۱۰۰ در دقیقه | **Low** | احتمال DoS — بررسی IP در logs |
| upload failures | > ۵ در ساعت | **Medium** | بررسی disk space + permissions |
| **backup_last_success_age** (Phase 8) | > ۲۶ ساعت | **Critical** | بررسی cron + script + disk space |
| **backup_last_failure_at** (Phase 8) | وجود دارد (not null) | **Critical** | بررسی backup script log |
| **backup_size_bytes** (Phase 8) | < ۱ KB یا کمتر از ۵۰% میانگینِ ۷ روز | **High** | احتمال partial backup |
| **restore_test_last_success_age** (Phase 8) | > ۸ روز | **High** | اجرای دستی `scripts/restore-db.sh --test-only` |
| **backup_status file missing** (Phase 8) | `configured: false` در `/api/metrics` | **High** | بررسی mount + script هرگز اجرا نشده |
| **uploads_backup_last_success_age** (Phase 9) | > ۲۶ ساعت | **Critical** | بررسی cron + script + uploads volume |
| **uploads_backup_last_failure_at** (Phase 9) | وجود دارد (not null) | **Critical** | بررسی uploads backup script log |
| **uploads_backup_size_bytes** (Phase 9) | صفر یا نصف میانگینِ ۷ روز | **High** | احتمال partial backup یا uploads volume empty |
| **uploads_backup_file_count** (Phase 9) | صفر | **Medium** | اگر production فایل دارد ولی backup صفر است → مشکل |
| **uploads_restore_test_last_success_age** (Phase 9) | > ۸ روز | **High** | اجرای دستی `scripts/restore-uploads.sh --test-only` |
| **uploads_backup_status file missing** (Phase 9) | `configured: false` در `/api/metrics` | **High** | بررسی mount + script هرگز اجرا نشده |

---

## Manual Monitoring Checklist (هفتگی)

۱. `/api/metrics` را چک کن — error rate و latency
۲. `/api/ready` را چک کن — DB در دسترس است؟
۳. Sentry dashboard را چک کن — خطاهای جدید؟
۴. `notification_outbox` با `status='failed'` را چک کن
۵. `import_row` با `processing_status='error'` را چک کن
۶. `/staff/ledger` را چک کن — drift detection
۷. Disk usage را چک کن — `df -h`
۸. Worker logs را چک کن — خطا یا هنگی؟
۹. **Phase 8:** `/api/metrics` بخش `backup` را چک کن — `last_success_at` و `restore_test_last_success_at` هر دو جدید هستند
۱۰. **Phase 8:** `ls -lh backups/daily/` را چک کن — فایلِ امروز موجود است؟ size معقول است؟
۱۱. **Phase 8:** اگر restore test هفتگی اجرا نشده، دستی اجرا کن: `bash scripts/restore-db.sh --test-only`
۱۲. **Phase 9:** `/api/metrics` بخش `uploads_backup` را چک کن — `last_success_at` و `last_success_file_count` جدید هستند
۱۳. **Phase 9:** `ls -lh backups/uploads/` را چک کن — فایلِ امروز موجود است؟ size و file_count معقول است؟
۱۴. **Phase 9:** اگر uploads restore test هفتگی اجرا نشده، دستی اجرا کن: `bash scripts/restore-uploads.sh --test-only`
۱۵. **Phase 9:** بررسیِ orphan files: `node --import tsx scripts/cleanup-orphan-uploads.ts` (dry-run)

---

## Alert Channels (برای MVP)

| Channel | کاربرد |
|---|---|
| Sentry | error tracking با tenant/user tags |
| `/api/metrics` | manual monitoring (JSON endpoint) |
| Worker logs | `docker compose logs worker-expire` |
| DB logs | `docker compose logs postgres` |
| Caddy logs | `docker compose logs caddy` |

---

## Upgrade Path (آینده)

وقتی مقیاس از چند ده نماینده فراتر رفت:
- **Prometheus** برای metrics collection
- **Grafana** برای dashboards و alerting
- **Loki** برای log aggregation
- **Alertmanager** برای notification (Telegram/Slack)
