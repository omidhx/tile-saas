# AUD-007: Rate-Limit Policy — Final Status

> **Status:** ✅ Resolved
> **Date:** 2026-08-23
> **Commit:** (pending)

## Policy سه‌سطحی

### سطح ۱: IP-based (global، در middleware)
- **سقف:** ۱۰۰ mutation در دقیقه per IP
- **پوشش:** همه‌ی ۵۳ mutation endpoint
- **Backend:** in-memory (Edge runtime)
- **Fail mode:** fail-open (Edge runtime نمی‌تواند به DB وصل شود)

### سطح ۲: Per-user (در httpCtx.ts)
- **سقف:** ۶۰ mutation در دقیقه per user
- **پوشش:** همه‌ی routeهایی که از `*Ctx` استفاده می‌کنند (۲۸ route)
- **Backend:** memory | postgres
- **Fail mode:** fail-open

### سطح ۳: Per-route خاص (در route handlers)
| Route | سقف | پنجره | Key | Fail mode |
|---|---|---|---|---|
| `/api/auth/login` | 20/IP + 5/identifier | 15 min | `login:ip:{ip}` + `login:id:{id}` | fail-closed |
| `/api/auth/password` | 5 | 15 min | `pwchange:{userId}` | fail-closed |
| `/api/auth/reset` | 3 request + 10 confirm | 15 min | `reset:{r/c}:{id}` | fail-closed |
| `/api/auth/logout-all` | 5 | 15 min | `logout-all:{userId}` | fail-closed |
| `/api/imports` | 10 | 1 hour | `import:{userId}` | fail-open |
| `/api/reservations` POST | 30 | 1 min | `reserve:{userId}` | fail-open |
| `/api/upload` | 10 | 1 min | `upload:{userId}` | fail-open |

### PlatformAdmin
- **سقف:** ۲۰ در دقیقه per user
- **پوشش:** `/api/platform/tenants`
- **Fail mode:** fail-open

## Inventory کامل

| Route | Rate Limit | Policy | Source |
|---|---|---|---|
| `/api/auth/login` | ✅ | 20/IP + 5/id, fail-closed | `login/route.ts` |
| `/api/auth/logout` | ❌ | نیاز ندارد (فقط کوکی پاک می‌کند) | — |
| `/api/auth/logout-all` | ✅ | 5/15min, fail-closed | `logout-all/route.ts` |
| `/api/auth/password` | ✅ | 5/15min, fail-closed | `password/route.ts` |
| `/api/auth/reset` | ✅ | 3+10/15min, fail-closed | `reset/route.ts` |
| `/api/reservations` POST | ✅ | 30/min, fail-open | `reservations/route.ts` |
| `/api/imports` POST | ✅ | 10/hour, fail-open | `imports/route.ts` |
| `/api/upload` POST | ✅ | 10/min, fail-open | `upload/route.ts` |
| `/api/platform/tenants` POST | ✅ | 20/min, fail-open | `httpCtx.ts:platformAdminCtx` |
| همه‌ی routeهای tenant-scoped | ✅ | 60/min, fail-open | `httpCtx.ts:*Ctx` |

**هیچ routeی بدون rate limit نمانده است** (به جز `logout` که فقط کوکی پاک می‌کند).

## Verdict

**AUD-007 = Resolved** — همه‌ی ۵۳ mutation endpoint با policy سه‌سطحی پوشش داده شده‌اند.
