# Final Readiness Report — Tile SaaS

> **Date:** 2026-08-24 UTC
> **Commit:** `199bf31` (pre-audit) → audit fixes applied (pending commit)
> **Auditor:** Super Z (automated, evidence-oriented)

---

## 1. Code-Level Readiness

| Check | Status | Evidence |
|---|---|---|
| TypeScript typecheck (`tsc --noEmit`) | **PASS** | exit=0, clean |
| Lib tests (178 tests) | **PASS** | 178/178 pass, 0 fail |
| Bash syntax (15 scripts) | **PASS** | 15/15 exit=0 |
| YAML syntax (4 files) | **PASS** | ci.yml + 2 compose + openapi.yaml valid |
| Node 22 alignment | **PASS** | Dockerfile, .nvmrc, package.json, CI all 22 |
| PostgreSQL 16 | **PASS** | docker-compose + CI use postgres:16-alpine |
| Migration system (forward-only) | **PASS** | apply.ts + 3 migrations, idempotent |
| Upload route + magic bytes | **PASS** | /api/upload exists, matchesMagicBytes in production path |
| Idempotency + concurrency | **PASS** | ON CONFLICT DO NOTHING + FOR UPDATE + concurrencyIdempotency.test.ts |

**Code-level readiness: PASS**

---

## 2. Security Readiness

| Check | Status | Evidence |
|---|---|---|
| RLS + FORCE ROW LEVEL SECURITY | **PASS** | All 34 tenant-scoped tables, schema.sql |
| app_user NOSUPERUSER NOBYPASSRLS | **PASS** | create-app-user.sql |
| assertNonSuperuserRole in startup | **PASS** | instrumentation.ts, fail-loud |
| SECURITY DEFINER search_path lock | **PASS** | 4 functions, SET search_path = public, pg_temp |
| CSRF defense (proxy.ts) | **PASS** | Origin/Host check on all mutations |
| HSTS (proxy.ts + Caddyfile) | **PASS** | max-age=31536000; includeSubDomains |
| Rate limiting (22 routes) | **PASS** | Dual backend, fail-closed for auth |
| Secret encryption (AES-256-GCM) | **PASS** | secretBox.ts for sms_config |
| Logger redaction (18 keys) | **PASS** | REDACTED_KEYS includes backup/passphrase/sentry |
| Secret scanning (10 patterns) | **PASS** | scan-secrets.sh + adversarial self-test |
| Secret scanning: adversarial test | **PASS** | Fake Stripe key detected ✅ |
| Secret scanning: git history | **PASS** | .env never committed ✅ |
| Secret scanning: self-match safe | **PASS** | scan-secrets.sh excluded from own scan ✅ |
| OpenAPI contract (83 operations) | **PASS** | 47 paths × all HTTP methods documented |
| OpenAPI contract: method-level drift | **PASS** | test-api-contract.sh: 0 missing |
| Error registry | **PASS** | ERROR_REGISTRY.md: 21 codes documented |
| AUTH_SECRET validation (≥32 chars) | **PASS** | session.ts, fail-loud |
| Password hashing (bcrypt) | **PASS** | auth/password.ts |
| Session rotation (session_epoch) | **PASS** | invalidateSessionsIn on login/reset/logout-all |
| Upload safety (magic bytes + UUID + private) | **PASS** | upload/route.ts |
| Path traversal defense | **PASS** | fileCleanup.ts + upload/route.ts |

**Security readiness: PASS**

---

## 3. Data-Integrity Readiness

| Check | Status | Evidence |
|---|---|---|
| Inventory model (held/allocated/available) | **PASS** | held=computed, allocated=stored, no double-counting |
| State transition matrix | **PASS** | Reservation: active→cancelled/converted/expired. Dispatch: NEXT map |
| FOR UPDATE ORDER BY lot_id | **PASS** | reservations.ts, salesRequests.ts, dispatches.ts |
| Inventory ledger (append-only) | **PASS** | inventory_transaction, never UPDATE/DELETE |
| Reconciliation service | **PASS WITH LIMITATIONS** | reconciliation.ts: computed_held from source of truth, stored_allocated from column. Limitation: stored_allocated cannot be independently recomputed without ledger replay |
| Reconciliation: variable naming | **PASS** | Renamed expected_allocated → stored_allocated (semantic accuracy) |
| Reconciliation: audit_log side effect | **PASS** | Documented: CRITICAL discrepancies logged, no auto-repair |
| Reconciliation: tests (10 scenarios) | **PASS** | clean, active, expired, converted, over-allocated, negative, multi-tenant, audit_log, zero-row, idempotent |
| Cross-tenant isolation test | **PASS** | crossTenantIsolation.test.ts |
| CHECK constraints | **PASS** | allocated+blocked <= on_hand in schema |

**Data-integrity readiness: PASS WITH LIMITATIONS**
- Limitation: stored_allocated not independently verifiable without ledger replay. Risk: Low. Owner: DBA. Required action: Build ledger-vs-balance reconciliation in future phase. Acceptance: ledger replay matches stored_allocated. Severity: Low. Blocks production: No.

---

## 4. CI Readiness

| Check | Status | Evidence |
|---|---|---|
| GitHub Actions pipeline | **PASS** | ci.yml with PostgreSQL 16 service |
| CI: typecheck | **PASS** | tsc --noEmit step |
| CI: tests (with PG 16) | **PASS** | npm run test:ci |
| CI: RLS verification | **PASS** | Verify RLS with app_user step |
| CI: build | **PASS** | npm run build step |
| CI: smoke test | **PASS** | /api/health, /api/ready, /api/metrics |
| CI: Phase 8 backup test | **PASS** | ci-backup-test.sh, run_id=32661732823 success |
| CI: Phase 9 uploads test | **PASS** | ci-uploads-backup-test.sh, run_id=32697066793 success |
| CI: secret scanning | **PASS** | scan-secrets.sh in CI workflow |
| CI: API contract drift | **PASS** | test-api-contract.sh in CI workflow |
| CI: DR simulation (64 checks) | **PASS** | test-dr-simulation.sh |
| CI: postgresql-client-16 | **PASS** | PG 16 client matches server |
| CI: tool version logging | **PASS** | All versions printed before tests |

**CI readiness: PASS**

---

## 5. Operational Readiness

| Check | Status | Evidence |
|---|---|---|
| Backup scripts (db + uploads) | **PASS** | 10 scripts, all bash -n OK |
| Restore scripts (db + uploads) | **PASS** | restore-db.sh + restore-uploads.sh with integrity checks |
| Restore test: CI verified | **PASS** | Phase 8 + 9 CI green |
| Restore test: staging runtime | **PENDING EVIDENCE** | Docker host required, not available in sandbox |
| Restore test: production | **PENDING EVIDENCE** | Not attempted (by design) |
| RPO documented (24h) | **PASS** | BACKUP_POLICY.md |
| RTO documented (2h) | **PASS** | BACKUP_POLICY.md |
| RPO/RTO measured | **PENDING EVIDENCE** | Requires real restore drill on VPS |
| Off-site backup | **PENDING EVIDENCE** | Script supports rsync, not yet configured on VPS |
| Cron installation | **PENDING EVIDENCE** | Documented in GO_LIVE.md, not yet installed |
| Secret rotation runbook | **PASS** | docs/runbooks/secret-rotation.md |
| Secret rotation drill | **PENDING EVIDENCE** | Not yet executed on staging/production |
| Incident classification | **PASS** | docs/runbooks/incident-classification.md (SEV-1 to SEV-4) |
| DR runbooks (6) | **PASS** | database outage, uploads recovery, rollback, disk pressure, secret rotation, incident |
| Alert thresholds (17) | **PASS** | docs/ALERTING.md |
| Monitoring endpoints | **PASS** | /api/health, /api/ready, /api/metrics with backup + uploads_backup |
| Backup status in metrics | **PASS** | /api/metrics returns backup + uploads_backup sections |
| Staging execution runbook | **PASS** | STAGING_VERIFICATION_CHECKLIST.md (26 items) |
| Staging drill executed | **PENDING EVIDENCE** | Docker host required |
| Rollback runbook | **PASS** | docs/runbooks/emergency-rollback.md |
| Rollback drill by non-author | **PENDING EVIDENCE** | Not yet executed |
| Reconciliation CLI | **PASS** | scripts/reconcile-inventory.ts |
| Upload orphan cleanup | **PASS** | cleanup-orphan-uploads.ts (dry-run + --commit) |

**Operational readiness: PENDING EVIDENCE**

### Limitations

| # | Limitation | Risk | Owner | Required Action | Acceptance Criterion | Severity | Blocks Production |
|---|---|---|---|---|---|---|---|
| 1 | Staging runtime not verified | Docker Compose path untested | On-call engineer | Execute STAGING_VERIFICATION_CHECKLIST.md on Docker host | All 26 checklist items pass | High | **Yes** |
| 2 | First production backup not run | No restore evidence | Platform admin | Run backup-db.sh + backup-uploads.sh on VPS | Status file shows last_success_at | High | **Yes** |
| 3 | First restore drill not run | RPO/RTO unmeasured | On-call engineer | Run restore-db.sh --test-only + restore-uploads.sh --test-only on VPS | Exit 0 + integrity checks pass | High | **Yes** |
| 4 | Off-site backup not configured | Single point of failure | Platform admin | Set BACKUP_OFFSITE_TARGET + test rsync | Off-site copy verified | Medium | No (with documented risk) |
| 5 | Cron not installed | Backups not automated | Platform admin | Install cron jobs per GO_LIVE.md section 4 | Cron runs backup daily | Medium | No (manual until then) |
| 6 | Secret rotation drill not executed | Rotation procedure untested | On-call engineer | Execute secret-rotation.md on staging | Rotation completes without data loss | Medium | No |
| 7 | Rollback drill not executed by non-author | Runbook untested by others | Tech Lead | Have non-author execute emergency-rollback.md | Rollback completes successfully | Medium | No |
| 8 | stored_allocated not independently verifiable | Ledger drift undetected | DBA | Build ledger-vs-balance reconciliation | Ledger replay matches stored_allocated | Low | No |

---

## 6. Production Go-Live Decision

### Summary

| Category | Status |
|---|---|
| Code-level readiness | **PASS** |
| Security readiness | **PASS** |
| Data-integrity readiness | **PASS WITH LIMITATIONS** (1 low-severity limitation) |
| CI readiness | **PASS** |
| Operational readiness | **PENDING EVIDENCE** (3 blocking items) |

### Blocking Items for Go-Live

1. **Staging runtime not verified** — Docker Compose path (docker exec -T) untested
2. **First production backup not run** — No restore evidence on real data
3. **First restore drill not run** — RPO/RTO unmeasured

All three require a Docker-capable host (VPS or local machine). They are operational,
not code defects. All scripts, runbooks, and checklists are ready for execution.

### Non-Blocking Limitations (Accepted Risks)

- Off-site backup not configured (documented risk, script ready)
- Cron not installed (manual until then)
- Secret rotation drill not executed (runbook ready)
- Rollback drill not executed by non-author (runbook ready)
- stored_allocated not independently verifiable (low risk, future work)

---

## FINAL_DECISION:

```
NO-GO — OPERATIONAL EVIDENCE PENDING
```

**Rationale:** All code, security, data-integrity, and CI checks PASS. However,
isolated restore, upload restore, RPO/RTO measurement, and rollback evidence
have not been executed on a real Docker host. Until these operational drills
are completed successfully, Go-Live must remain pending.

**Path to Go-Live:**
1. Execute `docs/STAGING_VERIFICATION_CHECKLIST.md` on a Docker-capable host
2. Run first real backup: `bash scripts/backup-db.sh` + `bash scripts/backup-uploads.sh`
3. Run first restore drill: `bash scripts/restore-db.sh --test-only` + `bash scripts/restore-uploads.sh --test-only`
4. Measure and record RPO/RTO
5. Have a non-author execute rollback runbook
6. Install cron jobs for automated backups
7. Re-evaluate Go-Live decision

**Estimated time to Go-Live:** 2-4 hours on a Docker-capable VPS.
