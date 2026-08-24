#!/bin/bash
# =============================================================================
# scripts/scan-secrets.sh — Secret scanning with git grep patterns
# =============================================================================
# This script scans the repository for potential secret leaks using
# git grep with common secret patterns. It's a lightweight alternative
# to gitleaks/trufflehog that works without external dependencies.
#
# Usage:
#   bash scripts/scan-secrets.sh
#
# Exit codes:
#   0 — no secrets found
#   1 — potential secrets detected (review output)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0
FAIL=0

echo "═══════════ Secret Scanning ═══════════"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Patterns that indicate potential secrets
# Each pattern is tested against tracked files only (not node_modules, .next, etc.)
PATTERNS=(
  # API keys
  '(sk_live_|sk_test_|sk_)[a-zA-Z0-9]{20,}'
  # AWS
  'AKIA[0-9A-Z]{16}'
  # GitHub tokens
  'ghp_[a-zA-Z0-9]{36}'
  # JWT (header. payload.signature — base64)
  'eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}'
  # Private keys
  'BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY'
  # Generic password assignment (not in .env.example or docs)
  '(password|passwd|pwd)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]'
  # Generic API key assignment
  '(api_key|apikey|api-key)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]'
  # Generic secret assignment
  '(secret|token|auth_token)\s*[:=]\s*["\x27][^"\x27]{16,}["\x27]'
  # Database URLs with passwords
  'postgresql?://[^:]+:[^@]+@[^/]+/\w+'
  # Redis URLs with passwords
  'redis://:[^@]+@'
)

# Files/directories to exclude from scanning
EXCLUDES=(
  "node_modules"
  ".next"
  "test-results"
  "playwright-report"
  ".git"
  "*.tsbuildinfo"
  "CHANGELOG.md"
  "docs/ERROR_REGISTRY.md"
  "docs/ALERTING.md"
  "docs/BACKUP_POLICY.md"
  "docs/RESTORE_RUNBOOK.md"
  "docs/DISASTER_RECOVERY.md"
  "docs/STAGING_VERIFICATION_CHECKLIST.md"
  "docs/STAGING_EXECUTION_RUNBOOK.md"
  "docs/runbooks/*"
  "docs/audits/*"
  "docs/FINAL_AUDIT_REPORT.md"
  "docs/GOLIVE_PLAN.md"
  "docs/PHASE10_AUDIT.md"
  "README.md"
  "CLAUDE.md"
  "MEMORY.md"
  "tile-saas-comprehensive-spec.md"
)

EXCLUDE_ARGS=""
for ex in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=" :(exclude)$ex"
done

for pattern in "${PATTERNS[@]}"; do
  # Use git grep to search tracked files only
  matches=$(git -C "${PROJECT_ROOT}" grep -InE "${pattern}" -- . $EXCLUDE_ARGS 2>/dev/null || true)

  if [ -n "${matches}" ]; then
    # Filter out known safe patterns (test-only, placeholders, CI test credentials, etc.)
    filtered=$(echo "${matches}" | grep -vE \
      "change-me-in-prod|replace-with|test-passphrase|stagingpw|TEMPORARY_CHANGE|ci-test-passphrase|ci-secret|staging-secret|test_only|\.env\.example|\.env\.test|placeholder|dummy|example\.com|not-for-production|0{32,}|REDACTED|\[REDACTED\]|postgres:pw@localhost|postgres://postgres:pw" || true)

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

# Also check for .env files accidentally committed
echo "Checking for .env files in git history..."
ENV_IN_GIT=$(git -C "${PROJECT_ROOT}" log --all --diff-filter=A --name-only --pretty=format: -- ".env" 2>/dev/null | grep -v "^$" || true)
if [ -n "${ENV_IN_GIT}" ]; then
  echo "  ❌ .env file found in git history!"
  echo "${ENV_IN_GIT}"
  FAIL=$((FAIL + 1))
else
  echo "  ✅ No .env files in git history"
  PASS=$((PASS + 1))
fi

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
