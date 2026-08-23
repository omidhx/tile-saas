# AUD-007: Rate-Limit Policy Inventory

> **وضعیت:** Open
> **تاریخ:** 2026-08-23
> **روش:** تحلیل کد (`grep -rn checkRateAsync`)

## ۱. Routes با Rate Limit (۵ از ۳۳ mutation)

| Route | Method | Policy | Key | Window | Limit | Backend | Fail Mode | 429 Contract |
|---|---|---|---|---|---|---|---|---|
| `/api/auth/login` | POST | per-IP + per-identifier | `login:ip:{ip}` + `login:id:{identifier}` | 15 min | 20/IP + 5/identifier | memory\|postgres | fail-closed | `{error:"too_many_requests"}` + `Retry-After` |
| `/api/auth/password` | POST | per-userId | `pwchange:{userId}` | 15 min | 5 | memory\|postgres | fail-closed | `{error:"too_many"}` + `Retry-After` |
| `/api/auth/reset` | POST | per-identifier (request + confirm جدا) | `reset:r:{identifier}` + `reset:c:{identifier}` | 15 min | 3 request + 10 confirm | memory\|postgres | fail-closed | `{error:"too_many"}` + `Retry-After` |
| `/api/imports` | POST | per-userId | `import:{userId}` | 1 hour | 10 | memory\|postgres | fail-open | `{error:"too_many_requests"}` + `Retry-After` |
| `/api/reservations` | POST | per-userId | `reserve:{userId}` | 1 min | 30 | memory\|postgres | fail-open | `{error:"too_many_requests"}` + `Retry-After` |

## ۲. Routes بدون Rate Limit (۲۸ از ۳۳ mutation)

| Route | Methods | نقش لازم | ریسک بدون Rate Limit |
|---|---|---|---|
| `/api/agent-overrides` | POST, PATCH, DELETE | admin | DoS — کاربر admin مخرب می‌تواند hammer کند |
| `/api/agents` | POST, PATCH, DELETE | admin | DoS — همان |
| `/api/alerts` | POST, DELETE | agent | DoS — نماینده می‌تواند spam کند |
| `/api/auth/logout` | POST | userId | پایین — فقط کوکی پاک می‌کند |
| `/api/auth/logout-all` | POST | userId | پایین — فقط session_epoch++ |
| `/api/backorders/[itemId]/status` | POST | staff | DoS — staff مخرب |
| `/api/customers` | POST, PATCH, DELETE | staff | DoS — staff مخرب |
| `/api/incoming` | POST, PATCH | staff | DoS — staff مخرب |
| `/api/platform/tenants` | POST | platformAdmin | پایین — فقط platform admin |
| `/api/price-lists` | POST | staff | DoS — staff مخرب |
| `/api/prices` | POST | staff | DoS — staff مخرب |
| `/api/prices/import` | POST | staff | DoS — staff مخرب |
| `/api/product-images` | POST, PATCH, DELETE | staff | DoS — staff مخرب |
| `/api/products` | POST, PATCH | staff | DoS — staff مخرب |
| `/api/reservations/[id]/approve` | POST | staff | DoS — staff مخرب |
| `/api/reservations/[id]/cancel` | POST | staff/agent | DoS |
| `/api/sales-dispatches` | POST | staff | DoS |
| `/api/sales-dispatches/[id]/status` | POST | staff | DoS |
| `/api/settings/auto-approve` | PUT | staff/admin | DoS |
| `/api/settings/sms` | PATCH | admin | DoS |
| `/api/settings/tenant` | PATCH | admin | DoS |
| `/api/shared-catalog` | POST, PATCH, DELETE | agent | DoS — نماینده |
| `/api/substitutes` | POST, DELETE | staff | DoS |
| `/api/team` | POST, PATCH, DELETE | accessManager | DoS |
| `/api/upload` | POST | staff | DoS — staff می‌تواند فایل spam کند |
| `/api/volume-discounts` | POST, PATCH, DELETE | staff | DoS |
| `/api/waitlist` | POST, DELETE | agent | DoS — نماینده |
| `/api/warehouses` | POST, PATCH, DELETE | admin | DoS |

## ۳. Policy پیشنهادی

| دسته | Policy پیشنهادی | دلیل |
|---|---|---|
| auth (login, password, reset) | فعلی — fail-closed | حفاظت از brute-force |
| reservations POST | فعلی — fail-open | حفاظت از inventory hammer |
| imports POST | فعلی — fail-open | حفاظت از heavy tx |
| upload POST | 10/min per-userId, fail-open | حفاظت از disk fill |
| settings PATCH/PUT | 10/min per-userId, fail-open | حفاظت از audit_log spam |
| team/agents/warehouses CRUD | 20/min per-userId, fail-open | حفاظت از DoS |
| other mutations | 60/min per-userId, fail-open | baseline protection |

## ۴. توصیه

اضافه‌کردن rate limit global در middleware برای همه‌ی mutation routes با policy
پایه (`60/min per-userId, fail-open`)، به‌علاوه‌ی policy‌های خاص که در بالا هست.
این کار در فاز ۵ یا ۶ انجام شود.
