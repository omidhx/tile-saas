# Incident Classification & Severity Matrix

> **هدف:** تعریف استاندارد شفاف برای رده‌بندی رخدادها، فرایند escalation،
> نقش‌ها و کانال‌های ارتباطی در زمان بحران.
>
> **مخاطب:** تمام اعضای تیم (engineers, on-call, product, support)

---

## ۱. Severity Matrix

| Severity | تعریف | مثال | Response Time | Escalation |
|---|---|---|---|---|
| **SEV-1 (Critical)** | قطعی کامل سرویس، خرابی یا قفل دیتابیس، Data Corruption، رخنه امنیتی فعال | PostgreSQL down، app 502 برای همه، ransomware، backup schema ناقص | **۱۵ دقیقه** — on-call باید acknowledge کند | IC → CTO → همه‌ی engineers |
| **SEV-2 (Major)** | از کار افتادن بخش‌های حیاتی بدون قطعی کامل core | آپلود خراب است، SMS worker متوقف شده، auth کار نمی‌کند برای برخی کاربران، rate limit اشتباه همه را block کرده | **۱ ساعت** | On-call → Tech Lead |
| **SEV-3 (Minor)** | خطاهای مقطعی، کندی عملکرد، افزایش نرخ خطاهای غیربحرانی | latency بالا، 4xx spike، orphan files انباشته شده | **۴ ساعت** (یا next business day) | On-call log + weekly review |
| **SEV-4 (Low)** | Cosmetic، non-urgent، todo | UI bug، doc typo، warning در KNOWN-WARNINGS | **۷ روز** | Backlog |

---

## ۲. Roles & Responsibilities

### ۲.۱. نقش‌ها

| نقش | مسئولیت | چه کسی |
|---|---|---|
| **Incident Commander (IC)** | تصمیم‌گیری نهایی، تخصیص منابع، ارتباط بین تیم‌ها، اعلام پایان incident | CTO یا مدیر فنی تعیین‌شده |
| **Tech Lead** | تحلیل فنی root cause، اجرای restore/rollback، debugging | On-call engineer ارشد |
| **On-call Engineer** | پاسخ اولیه، triage، اجرای runbookها | نفر تعیین‌شده در rotation |
| **Comms** | ارتباط با کاربران، اعلان downtime، status page | مدیر محصول یا support |
| **Scribe** | ثبت timeline (timestamps، actions، decisions) | هر نفر موجود |

### ۲.۲. Escalation Flow

```text
Alert Fires (Sentry / /api/metrics / manual report)
      │
      ▼
On-call Engineer acknowledges (≤ SLA)
      │
      ├── SEV-3/4 → On-call handles, logs in worklog
      │
      ├── SEV-2 → On-call → Tech Lead (within 1h)
      │         └── If not resolved in 2h → IC
      │
      └── SEV-1 → IC immediately
                ├── IC declares incident
                ├── IC assigns Tech Lead
                ├── IC notifies Comms
                └── All engineers on standby
```

---

## ۳. Communication Channels

| Channel | کاربرد |
|---|---|
| **Telegram group: `#tile-saas-incidents`** | ارشد — همه‌ی discussion و updates در اینجا |
| **Phone call** | SEV-1 — اگر on-call در Telegram پاسخ نداد |
| **Status page** (آینده) | اطلاع‌رسانی به کاربران |
| **Email** | post-incident notification (اگر داده‌ی کاربر تحت تأثیر باشد) |

### قالب update در Telegram

```text
[INCIDENT-YYYYMMDD-NN] SEV-X
Status: Investigating / Mitigating / Resolved
Summary: (یک جمله)
Impact: (کاربران تحت تأثیر، مدت زمان)
Action: (چه کاری در حال انجام است)
Next update: (زمان)
```

---

## ۴. Incident Lifecycle

```text
1. Detection      — Alert fires یا user report
2. Acknowledge     — On-call confirms (≤ SLA)
3. Triage          — Severity assignment + IC notification (if SEV-1)
4. Investigate     — Root cause analysis
5. Mitigate        — Apply fix / restore / rollback
6. Resolve         — Verify service is healthy
7. Post-incident   — Postmortem within 48h (SEV-1/2)
```

### Postmortem قالب

```markdown
# Postmortem: [INCIDENT-YYYYMMDD-NN] — [Title]

## Summary
(یک پاراگراف)

## Timeline (UTC)
- HH:MM — First alert
- HH:MM — On-call acknowledged
- HH:MM — Root cause identified
- HH:MM — Mitigation applied
- HH:MM — Service restored
- HH:MM — Incident closed

## Impact
- Users affected: X
- Duration: Yh Ym
- Data lost: (none / description)
- RPO actual: (hours)
- RTO actual: (hours)

## Root Cause
(توضیح فنی)

## What went well
- ...

## What went poorly
- ...

## Action Items
- [ ] Action 1 — Owner: NAME — Due: DATE
- [ ] Action 2 — Owner: NAME — Due: DATE
```

---

## ۵. Contacts

> ⚠️ قبل از go-live باید با اطلاعات واقعی پر شود.

| نقش | نام | تماس (Telegram/Phone) |
|---|---|---|
| Incident Commander | [填写] | [填写] |
| Tech Lead | [填写] | [填写] |
| On-call Engineer | [填写] | [填写] |
| Comms | [填写] | [填写] |
| VPS Provider Support | [填写] | [填写] |
| DNS Provider | [填写] | [填写] |
| Backup Host Admin | [填写] | [填写] |

---

## ۶. Alert Mapping

| Alert (از `/api/metrics` یا Sentry) | Severity | Runbook |
|---|---|---|
| 5xx rate > 5% in 5 min | SEV-1 | `dr-database-outage.md` یا `emergency-rollback.md` |
| `/api/ready` failure × 3 | SEV-1 | `dr-database-outage.md` |
| `/api/health` failure × 3 | SEV-1 | Restart container |
| DB unavailable | SEV-1 | `dr-database-outage.md` |
| outbox backlog > 100 pending > 10 min | SEV-2 | Check worker-outbox |
| disk usage > 80% | SEV-2 | `disk-pressure-and-cleanup.md` |
| TLS cert < 30 days | SEV-3 | Renew Let's Encrypt |
| 401 spike > 50/min | SEV-3 | Check rate limit |
| backup age > 26h | SEV-1 | Run `backup-db.sh` manually |
| uploads backup age > 26h | SEV-2 | Run `backup-uploads.sh` manually |
| restore test age > 8 days | SEV-3 | Run restore test manually |
