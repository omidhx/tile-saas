# scripts/scan-secrets.sh — Secret Scanning with Adversarial Verification
# =============================================================================
# Scans repository for potential secret leaks using git grep patterns.
# Includes working tree scan, git history scan, and self-test.
#
# Usage:
#   bash scripts/scan-secrets.sh           # normal scan
#   bash scripts/scan-secrets.sh --self-test # run adversarial self-test
#
# Exit codes:
#   0 — no secrets found (or self-test passed)
#   1 — potential secrets detected
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SELF_TEST=false

if [ "${1:-}" = "--self-test" ]; then
  SELF_TEST=true
fi

PASS=0
FAIL=0

echo "═══════════ Secret Scanning ═══════════"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ──────────────────────────────────────────────
# Secret patterns (10 patterns)
# ──────────────────────────────────────────────
PATTERNS=(
  '(sk_live_|sk_test_|sk_)[a-zA-Z0-9]{20,}'
  'AKIA[0-9A-Z]{16}'
  'ghp_[a-zA-Z0-9]{36}'
  'eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}'
  'BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY'
  '(password|passwd|pwd)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]'
  '(api_key|apikey|api-key)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]'
  '(secret|token|auth_token)\s*[:=]\s*["\x27][^"\x27]{16,}["\x27]'
  'postgresql?://[^:]+:[^@]+@[^/]+/\w+'
  'redis://:[^@\s]+@'
)

# ──────────────────────────────────────────────
# Excluded files — each with explicit reason
# ──────────────────────────────────────────────
# Format: "path|reason"
EXCLUDES=(
  "node_modules|dependency code — not our source"
  ".next|build output — regenerated, not source"
  "test-results|test artifacts — ephemeral"
  "playwright-report|test artifacts — ephemeral"
  ".git|git internals — not source"
  "*.tsbuildinfo|build cache — ephemeral"
  "CHANGELOG.md|documentation — may reference old config patterns"
  "docs/ERROR_REGISTRY.md|documentation — error code names only"
  "docs/ALERTING.md|documentation — alert threshold descriptions"
  "docs/BACKUP_POLICY.md|documentation — passphrase patterns as examples"
  "docs/RESTORE_RUNBOOK.md|documentation — command examples with test creds"
  "docs/DISASTER_RECOVERY.md|documentation — runbook examples"
  "docs/STAGING_VERIFICATION_CHECKLIST.md|documentation — staging commands"
  "docs/STAGING_EXECUTION_RUNBOOK.md|documentation — staging commands"
  "docs/runbooks/*|documentation — operational runbooks"
  "docs/audits/*|documentation — audit reports"
  "docs/FINAL_AUDIT_REPORT.md|documentation — audit summary"
  "docs/GOLIVE_PLAN.md|documentation — remediation plan"
  "docs/PHASE10_AUDIT.md|documentation — privacy audit"
  "docs/FINAL_READINESS_REPORT.md|documentation — readiness report"
  "README.md|documentation — may reference config patterns"
  "CLAUDE.md|documentation — project notes"
  "MEMORY.md|documentation — project memory"
  "tile-saas-comprehensive-spec.md|documentation — product spec"
  "scripts/scan-secrets.sh|self — contains pattern definitions that match themselves"
)

EXCLUDE_ARGS=""
for entry in "${EXCLUDES[@]}"; do
  path="${entry%%|*}"
  EXCLUDE_ARGS+=" :(exclude)${path}"
done

# Known-safe patterns to filter from results (test-only, placeholders, CI creds)
SAFE_FILTERS="change-me-in-prod|replace-with|test-passphrase|stagingpw|TEMPORARY_CHANGE|ci-test-passphrase|ci-secret|staging-secret|test_only|\.env\.example|\.env\.test|placeholder|dummy|example\.com|not-for-production|0{32,}|REDACTED|\[REDACTED\]|postgres:pw@localhost|postgres://postgres:pw"

# ──────────────────────────────────────────────
# Phase 1: Scan tracked files (working tree)
# ──────────────────────────────────────────────
echo "--- Phase 1: Working tree scan (tracked files) ---"
for pattern in "${PATTERNS[@]}"; do
  matches=$(git -C "${PROJECT_ROOT}" grep -InE "${pattern}" -- . $EXCLUDE_ARGS 2>/dev/null || true)

  if [ -n "${matches}" ]; then
    filtered=$(echo "${matches}" | grep -vE "${SAFE_FILTERS}" || true)
    if [ -n "${filtered}" ]; then
      echo "  ❌ Pattern matched: ${pattern}"
      echo "${filtered}" | head -5
      echo ""
      FAIL=$((FAIL + 1))
    else
      PASS=$((PASS + 1))
    fi
  else
    PASS=$((PASS + 1))
  fi
done

# ──────────────────────────────────────────────
# Phase 2: Git history scan (.env files committed)
# ──────────────────────────────────────────────
echo "--- Phase 2: Git history scan (.env in history) ---"
ENV_IN_GIT=$(git -C "${PROJECT_ROOT}" log --all --diff-filter=A --name-only --pretty=format: -- ".env" 2>/dev/null | grep -v "^$" || true)
if [ -n "${ENV_IN_GIT}" ]; then
  echo "  ❌ .env file found in git history!"
  echo "${ENV_IN_GIT}"
  FAIL=$((FAIL + 1))
else
  echo "  ✅ No .env files in git history"
  PASS=$((PASS + 1))
fi

# ──────────────────────────────────────────────
# Phase 3: Adversarial self-test (optional)
# ──────────────────────────────────────────────
if [ "${SELF_TEST}" = true ]; then
  echo ""
  echo "--- Phase 3: Adversarial self-test ---"

  # Create a temporary file with a fake secret
  TEST_FILE=$(mktemp "${PROJECT_ROOT}/.scan-test-XXXXXX.txt")
  trap "rm -f ${TEST_FILE}" EXIT

  # Write a fake Stripe key that should be detected
  echo 'sk_live_1234567890abcdefghijklmnop' > "${TEST_FILE}"

  # git add the file so it's tracked
  git -C "${PROJECT_ROOT}" add -f "${TEST_FILE}" 2>/dev/null || true

  # Run the pattern check against this file
  test_match=$(git -C "${PROJECT_ROOT}" grep -InE '(sk_live_|sk_test_|sk_)[a-zA-Z0-9]{20,}' -- "$(basename ${TEST_FILE})" 2>/dev/null || true)

  if [ -n "${test_match}" ]; then
    echo "  ✅ Intentional secret detection: PASS (fake Stripe key detected)"
    PASS=$((PASS + 1))
  else
    echo "  ❌ Intentional secret detection: FAIL (fake Stripe key NOT detected)"
    FAIL=$((FAIL + 1))
  fi

  # Clean up
  git -C "${PROJECT_ROOT}" reset -q HEAD "${TEST_FILE}" 2>/dev/null || true
  rm -f "${TEST_FILE}"
fi

# ──────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────
echo ""
echo "═══════════ Secret Scanning Summary ═══════════"
echo "Patterns checked: ${#PATTERNS[@]}"
echo "Passed: ${PASS}"
echo "Failed: ${FAIL}"
echo ""

if [ "${FAIL}" -gt 0 ]; then
  echo "❌ Secret scanning FAILED — ${FAIL} issues found"
  exit 1
fi

echo "✅ Secret scanning PASSED — no secrets detected"
exit 0
