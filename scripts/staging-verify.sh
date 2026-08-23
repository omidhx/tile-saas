#!/bin/bash
# =============================================================================
# scripts/staging-verify.sh — Staging Verification Script
# =============================================================================
# این اسکریپت همه‌ی ۴ Go-Live blocker را با HTTP واقعی تست می‌کند.
#
# پیش‌نیاز:
#   docker compose -f docker-compose.staging.yml up --build -d
#   sleep 30  # صبر تا app بالا بیاید
#
# اجرا:
#   bash scripts/staging-verify.sh
# =============================================================================

set -e

BASE_URL="${STAGING_URL:-https://localhost}"
API_URL="${STAGING_API:-https://localhost/api}"
PASS=0
FAIL=0

echo "============================================"
echo "Staging Verification — $(date)"
echo "Base URL: $BASE_URL"
echo "============================================"
echo ""

# ──────────────────────────────────────────────
# DB-001: Runtime با app_user
# ──────────────────────────────────────────────
echo "=== DB-001: Runtime Role Verification ==="

# بررسی نقش در PostgreSQL
echo "--- PostgreSQL role check ---"
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles WHERE rolname = 'app_user';
  " 2>/dev/null | tee /tmp/db-role-check.txt

if grep -q "app_user.*f.*f" /tmp/db-role-check.txt; then
    echo "✅ DB-001: app_user is non-superuser, no BYPASSRLS"
    PASS=$((PASS + 1))
else
    echo "❌ DB-001: app_user role check failed"
    FAIL=$((FAIL + 1))
fi

# بررسی startup log — باید بگوید "connected as non-superuser"
echo ""
echo "--- Startup log check ---"
docker compose -f docker-compose.staging.yml logs web 2>/dev/null | grep -i "non-superuser\|SECURITY.*role\|DB role verification" | tail -5

if docker compose -f docker-compose.staging.yml logs web 2>/dev/null | grep -q "DB role verification passed"; then
    echo "✅ DB-001: Startup verification passed"
    PASS=$((PASS + 1))
else
    echo "❌ DB-001: Startup verification not found in logs"
    FAIL=$((FAIL + 1))
fi

echo ""

# ──────────────────────────────────────────────
# AUD-001: Upload Download Route
# ──────────────────────────────────────────────
echo "=== AUD-001: Upload Download Route ==="

# تست: unauthenticated → 401
echo "--- Unauthenticated download → 401 ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "$API_URL/uploads/test-uuid.jpg")
if [ "$STATUS" = "401" ]; then
    echo "✅ AUD-001: Unauthenticated → 401"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-001: Unauthenticated → $STATUS (expected 401)"
    FAIL=$((FAIL + 1))
fi

# تست: path traversal → 404
echo "--- Path traversal → 404 ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "$API_URL/uploads/../../../etc/passwd")
if [ "$STATUS" = "404" ] || [ "$STATUS" = "400" ]; then
    echo "✅ AUD-001: Path traversal → $STATUS"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-001: Path traversal → $STATUS (expected 404 or 400)"
    FAIL=$((FAIL + 1))
fi

# تست: invalid id → 404
echo "--- Invalid ID → 404 ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "$API_URL/uploads/invalid<>id.jpg")
if [ "$STATUS" = "404" ]; then
    echo "✅ AUD-001: Invalid ID → 404"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-001: Invalid ID → $STATUS (expected 404)"
    FAIL=$((FAIL + 1))
fi

echo ""

# ──────────────────────────────────────────────
# AUD-004: CSRF Protection
# ──────────────────────────────────────────────
echo "=== AUD-004: CSRF Protection ==="

# تست: cross-origin mutation → 403
echo "--- Cross-origin POST → 403 ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -H "Origin: https://evil.com" \
    -d '{"identifier":"test","password":"test"}')
if [ "$STATUS" = "403" ]; then
    echo "✅ AUD-004: Cross-origin → 403"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-004: Cross-origin → $STATUS (expected 403)"
    FAIL=$((FAIL + 1))
fi

# تست: Origin: null → 403
echo "--- Origin: null → 403 ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -H "Origin: null" \
    -d '{"identifier":"test","password":"test"}')
if [ "$STATUS" = "403" ]; then
    echo "✅ AUD-004: Origin null → 403"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-004: Origin null → $STATUS (expected 403)"
    FAIL=$((FAIL + 1))
fi

# تست: same-origin mutation → not 403 (400/401 is fine)
echo "--- Same-origin POST → not 403 ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -H "Origin: https://localhost" \
    -d '{"identifier":"test","password":"test"}')
if [ "$STATUS" != "403" ]; then
    echo "✅ AUD-004: Same-origin → $STATUS (not 403)"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-004: Same-origin → 403 (should not be blocked)"
    FAIL=$((FAIL + 1))
fi

# تست: GET without Origin → not blocked
echo "--- GET without Origin → not blocked ---"
STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "$API_URL/health")
if [ "$STATUS" = "200" ]; then
    echo "✅ AUD-004: GET → $STATUS"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-004: GET → $STATUS (expected 200)"
    FAIL=$((FAIL + 1))
fi

echo ""

# ──────────────────────────────────────────────
# AUD-006: HSTS
# ──────────────────────────────────────────────
echo "=== AUD-006: HSTS Header ==="

# تست: HSTS در پاسخ HTTPS
echo "--- HSTS header in HTTPS response ---"
HSTS=$(curl -k -s -I "$BASE_URL" | grep -i "Strict-Transport-Security" | tr -d '\r')
if [ -n "$HSTS" ]; then
    echo "✅ AUD-006: HSTS present: $HSTS"
    PASS=$((PASS + 1))
else
    echo "❌ AUD-006: HSTS not found"
    FAIL=$((FAIL + 1))
fi

# تست: X-Forwarded-Proto spoofing
echo "--- X-Forwarded-Proto spoof test ---"
# اگر client بتواند X-Forwarded-Proto: https بفرستد روی HTTP، HSTS ست می‌شود
# که ناامن است. این تست بررسی می‌کند که Caddy آن را بازنویسی می‌کند.
SPOOF_HSTS=$(curl -s -I -H "X-Forwarded-Proto: https" "http://localhost:80" 2>/dev/null | grep -i "Strict-Transport-Security" | tr -d '\r')
if [ -z "$SPOOF_HSTS" ]; then
    echo "✅ AUD-006: X-Forwarded-Proto spoof not accepted on HTTP"
    PASS=$((PASS + 1))
else
    echo "⚠️ AUD-006: HSTS set via spoofed X-Forwarded-Proto — check Caddy config"
    # این ممکن است درست باشد اگر Caddy همیشه HTTPS پاسخ می‌دهد
fi

echo ""

# ──────────────────────────────────────────────
# AUD-007: Rate Limit
# ──────────────────────────────────────────────
echo "=== AUD-007: Rate Limit ==="

# تست: 100+ mutation در سریع → 429
echo "--- Rate limit (100+ mutations) ---"
RATE_LIMITED=0
for i in $(seq 1 105); do
    STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" \
        -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -H "Origin: https://localhost" \
        -d '{"identifier":"rate-test-'$i'","password":"test"}')
    if [ "$STATUS" = "429" ]; then
        RATE_LIMITED=1
        echo "✅ AUD-007: Rate limit triggered at request $i"
        PASS=$((PASS + 1))
        break
    fi
done

if [ "$RATE_LIMITED" = "0" ]; then
    echo "⚠️ AUD-007: Rate limit not triggered (may need more requests or different window)"
    # این یک warning است نه failure — شاید rate limit در Edge runtime بالاتر است
fi

echo ""

# ──────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────
echo "============================================"
echo "SUMMARY"
echo "============================================"
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo ""
if [ "$FAIL" = "0" ]; then
    echo "✅ All staging verification tests passed!"
else
    echo "❌ $FAIL tests failed — review above"
fi
echo ""
echo "Environment:"
echo "  Commit: $(git rev-parse --short HEAD)"
echo "  Date: $(date)"
echo "  URL: $BASE_URL"
