#!/bin/bash
# =============================================================================
# scripts/test-api-contract.sh — Verify OpenAPI spec covers all API routes
# =============================================================================
# This script checks that every route.ts file in web/src/app/api/ has a
# corresponding path entry in docs/openapi.yaml.
#
# Usage:
#   bash scripts/test-api-contract.sh
#
# Exit codes:
#   0 — all routes documented
#   1 — one or more routes missing from openapi.yaml
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="${PROJECT_ROOT}/web/src/app/api"
OPENAPI_FILE="${PROJECT_ROOT}/docs/openapi.yaml"

PASS=0
FAIL=0

echo "═══════════ API Contract Drift Check ═══════════"
echo "Checking openapi.yaml against actual route.ts files..."
echo ""

# Find all route.ts files and extract their API path
while IFS= read -r -d '' route_file; do
  # Extract the API path from the file path
  # web/src/app/api/catalog/route.ts → /api/catalog
  # web/src/app/api/reservations/[id]/approve/route.ts → /api/reservations/{id}/approve
  relative="${route_file#${API_DIR}/}"
  api_path="/api/$(dirname "${relative}")"

  # Convert Next.js dynamic routes [id] → {id} for OpenAPI
  api_path_openapi=$(echo "${api_path}" | sed 's|\[id\]|{id}|g; s|\[itemId\]|{itemId}|g; s|\[slug\]|{slug}|g; s|\[token\]|{token}|g')

  # Check if this path exists in openapi.yaml
  # Look for the path key (with leading /)
  if grep -q "^  ${api_path_openapi}:" "${OPENAPI_FILE}" 2>/dev/null; then
    PASS=$((PASS + 1))
  else
    echo "  ❌ MISSING: ${api_path_openapi} (from ${relative})"
    FAIL=$((FAIL + 1))
  fi
done < <(find "${API_DIR}" -name "route.ts" -print0)

echo ""
echo "═══════════ API Contract Summary ═══════════"
echo "Documented: ${PASS}"
echo "Missing:    ${FAIL}"
echo ""

if [ "${FAIL}" -gt 0 ]; then
  echo "❌ API Contract check FAILED — ${FAIL} routes missing from openapi.yaml"
  exit 1
fi

echo "✅ API Contract check PASSED — all ${PASS} routes documented in openapi.yaml"
exit 0
