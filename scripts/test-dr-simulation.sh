#!/bin/bash
# =============================================================================
# scripts/test-dr-simulation.sh — DR Readiness Simulation (CI-safe, no Docker)
# =============================================================================
# این اسکریپت آمادگی Disaster Recovery را شبیه‌سازی می‌کند — بدون نیاز به
# Docker یا PostgreSQL. فقط بررسی می‌کند که:
#   ۱. همه‌ی runbookها موجودند
#   ۲. همه‌ی backup scripts موجودند و syntax درست دارند
#   ۳. هیچ تضادی بین runbookها و scripts نیست
#   ۴. env vars ضروری در .env.example مستند شده‌اند
#   ۵. alert thresholds در ALERTING.md موجودند
#
# Usage:
#   bash scripts/test-dr-simulation.sh
#
# Exit codes:
#   0 — همه‌ی بررسی‌ها PASS
#   1 — یک یا چند بررسی FAIL
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local condition="$2"
  if [ "${condition}" = "true" ]; then
    echo "  ✅ ${desc}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════ DR Readiness Simulation ═══════════"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Commit: $(cd "${PROJECT_ROOT}" && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo ""

# ──────────────────────────────────────────────
echo "=== 1. Runbooks exist ==="
# ──────────────────────────────────────────────
RUNBOOKS=(
  "docs/runbooks/incident-classification.md"
  "docs/runbooks/dr-database-outage.md"
  "docs/runbooks/dr-uploads-recovery.md"
  "docs/runbooks/emergency-rollback.md"
  "docs/runbooks/disk-pressure-and-cleanup.md"
  "docs/runbooks/secret-rotation.md"
)

for rb in "${RUNBOOKS[@]}"; do
  check "Runbook exists: ${rb}" "$([ -f "${PROJECT_ROOT}/${rb}" ] && echo true || echo false)"
done

# ──────────────────────────────────────────────
echo ""
echo "=== 2. Backup/Restore scripts exist ==="
# ──────────────────────────────────────────────
SCRIPTS=(
  "scripts/backup-db.sh"
  "scripts/verify-backup.sh"
  "scripts/restore-db.sh"
  "scripts/cleanup-old-backups.sh"
  "scripts/backup-uploads.sh"
  "scripts/verify-uploads.sh"
  "scripts/restore-uploads.sh"
  "scripts/cleanup-old-uploads-backups.sh"
  "scripts/ci-backup-test.sh"
  "scripts/ci-uploads-backup-test.sh"
)

for s in "${SCRIPTS[@]}"; do
  check "Script exists: ${s}" "$([ -f "${PROJECT_ROOT}/${s}" ] && echo true || echo false)"
done

# ──────────────────────────────────────────────
echo ""
echo "=== 3. Script syntax valid ==="
# ──────────────────────────────────────────────
for s in "${SCRIPTS[@]}"; do
  if bash -n "${PROJECT_ROOT}/${s}" 2>/dev/null; then
    check "Syntax OK: ${s}" true
  else
    check "Syntax OK: ${s}" false
  fi
done

# ──────────────────────────────────────────────
echo ""
echo "=== 4. Consistency: runbooks reference correct scripts ==="
# ──────────────────────────────────────────────
# Check that dr-database-outage.md references backup/restore workflow
check "dr-database-outage.md references backup workflow" \
  "$(grep -qE 'backup|verify-backup|restore' "${PROJECT_ROOT}/docs/runbooks/dr-database-outage.md" && echo true || echo false)"

check "dr-database-outage.md references restore workflow" \
  "$(grep -qE 'restore|pg_restore|gpg.*decrypt' "${PROJECT_ROOT}/docs/runbooks/dr-database-outage.md" && echo true || echo false)"

# Check that dr-uploads-recovery.md references backup/restore workflow
check "dr-uploads-recovery.md references uploads backup workflow" \
  "$(grep -qE 'backup-uploads|backups/uploads|verify-uploads' "${PROJECT_ROOT}/docs/runbooks/dr-uploads-recovery.md" && echo true || echo false)"

check "dr-uploads-recovery.md references restore-uploads.sh" \
  "$(grep -q 'restore-uploads.sh\|restore-uploads' "${PROJECT_ROOT}/docs/runbooks/dr-uploads-recovery.md" && echo true || echo false)"

check "dr-uploads-recovery.md references verify-uploads.sh" \
  "$(grep -q 'verify-uploads.sh\|verify-uploads' "${PROJECT_ROOT}/docs/runbooks/dr-uploads-recovery.md" && echo true || echo false)"

# Check that disk-pressure-and-cleanup.md references cleanup scripts
check "disk-pressure-and-cleanup.md references cleanup-old-backups.sh" \
  "$(grep -q 'cleanup-old-backups.sh' "${PROJECT_ROOT}/docs/runbooks/disk-pressure-and-cleanup.md" && echo true || echo false)"

check "disk-pressure-and-cleanup.md references cleanup-old-uploads-backups.sh" \
  "$(grep -q 'cleanup-old-uploads-backups.sh' "${PROJECT_ROOT}/docs/runbooks/disk-pressure-and-cleanup.md" && echo true || echo false)"

check "disk-pressure-and-cleanup.md references cleanup-orphan-uploads.ts" \
  "$(grep -q 'cleanup-orphan-uploads' "${PROJECT_ROOT}/docs/runbooks/disk-pressure-and-cleanup.md" && echo true || echo false)"

# ──────────────────────────────────────────────
echo ""
echo "=== 5. .env.example documents all required secrets ==="
# ──────────────────────────────────────────────
REQUIRED_ENVS=(
  "AUTH_SECRET"
  "POSTGRES_PASSWORD"
  "POSTGRES_USER"
  "POSTGRES_DB"
  "DATABASE_URL"
  "BACKUP_GPG_PASSPHRASE"
  "BACKUP_RETENTION_DAYS"
  "BACKUP_OFFSITE_TARGET"
)

for env in "${REQUIRED_ENVS[@]}"; do
  check "Env documented: ${env}" \
    "$(grep -q "^${env}=" "${PROJECT_ROOT}/.env.example" && echo true || echo false)"
done

# ──────────────────────────────────────────────
echo ""
echo "=== 6. Alert thresholds documented ==="
# ──────────────────────────────────────────────
ALERTS=(
  "5xx rate"
  "backup.*age"
  "disk usage"
  "uploads_backup"
  "restore.*test.*age"
)

for alert in "${ALERTS[@]}"; do
  check "Alert documented: ${alert}" \
    "$(grep -qi "${alert}" "${PROJECT_ROOT}/docs/ALERTING.md" && echo true || echo false)"
done

# ──────────────────────────────────────────────
echo ""
echo "=== 7. RPO/RTO documented ==="
# ──────────────────────────────────────────────
check "RPO documented in BACKUP_POLICY.md" \
  "$(grep -qi 'RPO.*24' "${PROJECT_ROOT}/docs/BACKUP_POLICY.md" && echo true || echo false)"

check "RTO documented in BACKUP_POLICY.md" \
  "$(grep -qi 'RTO.*2' "${PROJECT_ROOT}/docs/BACKUP_POLICY.md" && echo true || echo false)"

check "RPO referenced in dr-database-outage.md" \
  "$(grep -qi 'RPO' "${PROJECT_ROOT}/docs/runbooks/dr-database-outage.md" && echo true || echo false)"

check "RTO referenced in dr-database-outage.md" \
  "$(grep -qi 'RTO' "${PROJECT_ROOT}/docs/runbooks/dr-database-outage.md" && echo true || echo false)"

# ──────────────────────────────────────────────
echo ""
echo "=== 8. Incident classification exists ==="
# ──────────────────────────────────────────────
check "SEV-1 defined" \
  "$(grep -qi 'SEV-1' "${PROJECT_ROOT}/docs/runbooks/incident-classification.md" && echo true || echo false)"

check "SEV-2 defined" \
  "$(grep -qi 'SEV-2' "${PROJECT_ROOT}/docs/runbooks/incident-classification.md" && echo true || echo false)"

check "SEV-3 defined" \
  "$(grep -qi 'SEV-3' "${PROJECT_ROOT}/docs/runbooks/incident-classification.md" && echo true || echo false)"

check "Incident Commander role defined" \
  "$(grep -qi 'Incident Commander' "${PROJECT_ROOT}/docs/runbooks/incident-classification.md" && echo true || echo false)"

check "Escalation flow documented" \
  "$(grep -qi 'Escalation' "${PROJECT_ROOT}/docs/runbooks/incident-classification.md" && echo true || echo false)"

# ──────────────────────────────────────────────
echo ""
echo "=== 9. Secret rotation runbook exists ==="
# ──────────────────────────────────────────────
check "AUTH_SECRET rotation documented" \
  "$(grep -qi 'AUTH_SECRET.*rotation\|rotation.*AUTH_SECRET' "${PROJECT_ROOT}/docs/runbooks/secret-rotation.md" && echo true || echo false)"

check "BACKUP_GPG_PASSPHRASE rotation documented" \
  "$(grep -qi 'BACKUP_GPG_PASSPHRASE.*rotation\|rotation.*BACKUP_GPG_PASSPHRASE' "${PROJECT_ROOT}/docs/runbooks/secret-rotation.md" && echo true || echo false)"

check "POSTGRES_PASSWORD rotation documented" \
  "$(grep -qi 'POSTGRES_PASSWORD.*rotation\|rotation.*POSTGRES_PASSWORD' "${PROJECT_ROOT}/docs/runbooks/secret-rotation.md" && echo true || echo false)"

check "Emergency revoke documented" \
  "$(grep -qi 'Emergency.*revoke\|revoke.*emergency\|Emergency Revoke' "${PROJECT_ROOT}/docs/runbooks/secret-rotation.md" && echo true || echo false)"

# ──────────────────────────────────────────────
echo ""
echo "=== 10. DR docs (existing) still present ==="
# ──────────────────────────────────────────────
check "DISASTER_RECOVERY.md exists" \
  "$([ -f "${PROJECT_ROOT}/docs/DISASTER_RECOVERY.md" ] && echo true || echo false)"

check "RESTORE_RUNBOOK.md exists" \
  "$([ -f "${PROJECT_ROOT}/docs/RESTORE_RUNBOOK.md" ] && echo true || echo false)"

check "STAGING_EXECUTION_RUNBOOK.md exists" \
  "$([ -f "${PROJECT_ROOT}/docs/STAGING_EXECUTION_RUNBOOK.md" ] && echo true || echo false)"

check "STAGING_VERIFICATION_CHECKLIST.md exists" \
  "$([ -f "${PROJECT_ROOT}/docs/STAGING_VERIFICATION_CHECKLIST.md" ] && echo true || echo false)"

# ──────────────────────────────────────────────
echo ""
echo "═══════════ DR Simulation Summary ═══════════"
echo "Pass: ${PASS}"
echo "Fail: ${FAIL}"
echo ""

if [ "${FAIL}" -gt 0 ]; then
  echo "❌ DR Simulation FAILED — ${FAIL} checks failed"
  exit 1
fi

echo "✅ DR Simulation PASSED — all ${PASS} checks passed"
exit 0
