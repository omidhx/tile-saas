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
