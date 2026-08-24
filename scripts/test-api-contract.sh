#!/bin/bash
# =============================================================================
# scripts/test-api-contract.sh — Verify OpenAPI spec covers all API routes
# =============================================================================
# Checks that every route.ts file in web/src/app/api/ has a corresponding
# path entry in docs/openapi.yaml — at both the path AND method level.
#
# Usage:
#   bash scripts/test-api-contract.sh
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

# Find all route.ts files and check each HTTP method
while IFS= read -r -d '' route_file; do
  relative="${route_file#${API_DIR}/}"
  api_path="/api/$(dirname "${relative}")"

  # Convert Next.js dynamic routes [param] → {param} for OpenAPI
  api_path_openapi=$(echo "${api_path}" | \
    sed 's|\[id\]|{id}|g; s|\[itemId\]|{itemId}|g; s|\[slug\]|{slug}|g; s|\[token\]|{token}|g')

  # Check each HTTP method
  for method in GET POST PATCH DELETE; do
    if grep -q "export async function ${method}" "${route_file}" 2>/dev/null; then
      lower=$(echo "${method}" | tr '[:upper:]' '[:lower:]')

      # Check if this method exists under the path in openapi.yaml
      # The path line looks like: "  /api/catalog:"
      # The method line looks like: "    get:" or "    post:"
      if grep -A30 "^  ${api_path_openapi}:" "${OPENAPI_FILE}" 2>/dev/null | \
         grep -q "^\s\{4,\}${lower}:" 2>/dev/null; then
        PASS=$((PASS + 1))
      else
        echo "  ❌ MISSING: ${method} ${api_path_openapi}"
        FAIL=$((FAIL + 1))
      fi
    fi
  done
done < <(find "${API_DIR}" -name "route.ts" -print0)

echo ""
echo "═══════════ API Contract Summary ═══════════"
echo "Documented operations: ${PASS}"
echo "Missing operations:    ${FAIL}"
echo ""

if [ "${FAIL}" -gt 0 ]; then
  echo "❌ API Contract check FAILED — ${FAIL} operations missing from openapi.yaml"
  exit 1
fi

echo "✅ API Contract check PASSED — all ${PASS} operations documented in openapi.yaml"
exit 0
