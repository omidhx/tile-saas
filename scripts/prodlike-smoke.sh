#!/usr/bin/env bash
# اجرای اپ با نقشِ production (non-superuser، RLS واقعاً فعال) + تست دودِ GO_LIVE.
set -uo pipefail
cd "W:/Claude Site/tile-saas/web"
PORT=3311
T=11111111-1111-1111-1111-111111111111
AG=a5555555-5555-5555-5555-555555555555
WH=a3333333-3333-3333-3333-333333333333
fail(){ echo "FAIL: $1"; cleanup; exit 1; }
cleanup(){ [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null; docker rm -f tile_prod >/dev/null 2>&1; }

echo "== pg + schema (as owner) =="
docker rm -f tile_prod >/dev/null 2>&1
docker run -d --name tile_prod -p 55434:5432 -e POSTGRES_PASSWORD=pw postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec tile_prod pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec -i tile_prod psql -U postgres -v ON_ERROR_STOP=1 -q < ../db/schema.sql || fail "schema"

HASH=$(node -e "console.log(require('bcryptjs').hashSync('pass1234',12))")
docker exec -i tile_prod psql -U postgres -v ON_ERROR_STOP=1 -q <<SQL || fail "roles+seed"
CREATE ROLE app_user LOGIN PASSWORD 'apppw';
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO app_user;
GRANT EXECUTE ON FUNCTION expire_due_reservations() TO app_user;
GRANT EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) TO app_user;
GRANT EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) TO app_user;

INSERT INTO tenant(id,name,slug) VALUES('$T','کارخانه','f');
INSERT INTO app_user(id,phone,password_hash) VALUES
 ('44444444-4444-4444-4444-444444444444','09120000000','$HASH'),
 ('55555555-5555-5555-5555-555555555556','09120000001','$HASH');
INSERT INTO tenant_membership(tenant_id,user_id,role,is_active) VALUES
 ('$T','44444444-4444-4444-4444-444444444444','agent',true),
 ('$T','55555555-5555-5555-5555-555555555556','staff',true);
INSERT INTO agent_account(id,tenant_id,legal_name,code) VALUES('$AG','$T','نمایندگی','AG1');
INSERT INTO agent_account_user(tenant_id,agent_account_id,user_id,role) VALUES('$T','$AG','44444444-4444-4444-4444-444444444444','op');
INSERT INTO warehouse(id,tenant_id,name,code,type) VALUES('$WH','$T','انبار','W1','main');
INSERT INTO product(id,tenant_id,code,name) VALUES('66666666-6666-6666-6666-666666666666','$T','GB-6060','گرانیت');
INSERT INTO product_variant(id,tenant_id,product_id,sku,boxes_per_pallet) VALUES('77777777-7777-7777-7777-777777777777','$T','66666666-6666-6666-6666-666666666666','GB1',96);
SQL

echo "== build =="
npx next build >/tmp/prodbuild.log 2>&1 || fail "build ($(tail -5 /tmp/prodbuild.log))"

echo "== app up AS app_user (RLS enforced, next start) =="
DATABASE_URL="postgres://app_user:apppw@localhost:55434/postgres" AUTH_SECRET="0123456789abcdef0123456789abcdef" \
  npx next start -p $PORT >/tmp/prod.log 2>&1 &
APP_PID=$!
for i in $(seq 1 90); do curl -s "localhost:$PORT/login" >/dev/null 2>&1 && break; sleep 1; done
curl -s "localhost:$PORT/login" >/dev/null 2>&1 || fail "app never came up ($(tail -5 /tmp/prod.log))"

api(){ curl -s -o /tmp/pb -w "%{http_code}" "$@"; }
DB="postgres://app_user:apppw@localhost:55434/postgres"

echo "== 1. login (agent + staff) =="
# NODE_ENV=production → کوکی Secure است و curl روی HTTP پسش نمی‌فرستد (هشدار GO_LIVE).
# پس توکن را صریح از Set-Cookie برمی‌داریم.
AT=$(curl -s -D - -o /dev/null -X POST "localhost:$PORT/api/auth/login" -H 'content-type: application/json' -d '{"phone":"09120000000","password":"pass1234"}' | grep -i '^set-cookie: session=' | sed -E 's/.*session=([^;]*).*/\1/' | tr -d '\r')
SK=$(curl -s -D - -o /dev/null -X POST "localhost:$PORT/api/auth/login" -H 'content-type: application/json' -d '{"phone":"09120000001","password":"pass1234"}' | grep -i '^set-cookie: session=' | sed -E 's/.*session=([^;]*).*/\1/' | tr -d '\r')
[ -n "$AT" ] || fail "agent login: no session cookie"
[ -n "$SK" ] || fail "staff login: no session cookie"
AH="Cookie: session=$AT"; SH="Cookie: session=$SK"
echo "  both sessions issued OK (user_contexts works under RLS)"

echo "== 2. import snapshot (staff) =="
c=$(api -H "$SH" -X POST "localhost:$PORT/api/imports" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$T\",\"idempotencyKey\":\"p1\",\"scope\":{\"type\":\"warehouse\",\"warehouseId\":\"$WH\"},\"rows\":[{\"sku\":\"GB1\",\"warehouseCode\":\"W1\",\"batchNumber\":\"B1\",\"onHand\":100}]}")
[ "$c" = 201 ] || fail "import $c ($(cat /tmp/pb))"
grep -q '"applied":1' /tmp/pb || fail "applied!=1: $(cat /tmp/pb)"
echo "  import 201 applied=1 OK"

echo "== 3. agent sees stock =="
c=$(api -H "$AH" "localhost:$PORT/api/lots?tenantId=$T&agentAccountId=$AG")
[ "$c" = 200 ] || fail "lots $c ($(cat /tmp/pb))"
grep -q '"available":100' /tmp/pb || fail "expected 100: $(cat /tmp/pb)"
echo "  available=100 OK"

LOT=$(docker exec tile_prod psql -U postgres -tAc "SELECT id FROM inventory_lot LIMIT 1" | tr -d '[:space:]')

echo "== 4. reserve -> approve -> dispatch -> loaded =="
c=$(api -H "$AH" -X POST "localhost:$PORT/api/reservations" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$T\",\"agentAccountId\":\"$AG\",\"idempotencyKey\":\"pr1\",\"items\":[{\"lotId\":\"$LOT\",\"quantityBoxes\":30}]}")
[ "$c" = 201 ] || fail "reserve $c ($(cat /tmp/pb))"
RID=$(grep -o '"reservationId":"[^"]*"' /tmp/pb | cut -d'"' -f4)
c=$(api -H "$SH" -X POST "localhost:$PORT/api/reservations/$RID/approve" -H 'content-type: application/json' -d "{\"tenantId\":\"$T\"}")
[ "$c" = 201 ] || fail "approve $c ($(cat /tmp/pb))"
SRID=$(grep -o '"salesRequestId":"[^"]*"' /tmp/pb | cut -d'"' -f4)
c=$(api -H "$SH" -X POST "localhost:$PORT/api/sales-dispatches" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$T\",\"salesRequestId\":\"$SRID\",\"dispatchCode\":\"D-P1\"}")
[ "$c" = 201 ] || fail "dispatch $c ($(cat /tmp/pb))"
DID=$(grep -o '"dispatchId":"[^"]*"' /tmp/pb | cut -d'"' -f4)
api -H "$SH" -X POST "localhost:$PORT/api/sales-dispatches/$DID/status" -H 'content-type: application/json' -d "{\"tenantId\":\"$T\",\"toStatus\":\"ready_for_loading\"}" >/dev/null
c=$(api -H "$SH" -X POST "localhost:$PORT/api/sales-dispatches/$DID/status" -H 'content-type: application/json' -d "{\"tenantId\":\"$T\",\"toStatus\":\"loaded\"}")
[ "$c" = 200 ] || fail "loaded $c ($(cat /tmp/pb))"
ON=$(docker exec tile_prod psql -U postgres -tAc "SELECT on_hand_qty_boxes FROM inventory_balance WHERE lot_id='$LOT'" | tr -d '[:space:]')
[ "$ON" = 70 ] || fail "on_hand expected 70 got $ON"
echo "  chain OK, on_hand 100->70"

echo "== 5. ledger drift must be zero =="
c=$(api -H "$SH" "localhost:$PORT/api/ledger?tenantId=$T")
[ "$c" = 200 ] || fail "ledger $c"
grep -q '"drift":\[\]' /tmp/pb || fail "expected zero drift: $(head -c 300 /tmp/pb)"
echo "  drift=[] OK"

echo "== 6. outbox worker under RLS (the bug we just fixed) =="
docker exec -i tile_prod psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO notification_outbox(tenant_id,channel,recipient,payload) VALUES('$T','sms','0912','{\"type\":\"restock\",\"product\":\"granite\",\"code\":\"GB-6060\"}')"
OUT=$(DATABASE_URL="$DB" npm run worker:outbox 2>&1 | grep -E "\[outbox\]")
echo "  $OUT"
echo "$OUT" | grep -q "sent=1" || fail "worker sent nothing under RLS: $OUT"
STAT=$(docker exec tile_prod psql -U postgres -tAc "SELECT status FROM notification_outbox LIMIT 1" | tr -d '[:space:]')
[ "$STAT" = "sent" ] || fail "outbox status expected sent got $STAT"
echo "  outbox sent=1 and row marked sent OK"

echo "== 7. expiry worker under RLS =="
OUT=$(DATABASE_URL="$DB" npm run worker:expire 2>&1 | grep -E "\[expire\]")
echo "  $OUT"
echo "$OUT" | grep -q "expired" || fail "expire worker failed: $OUT"

echo ""
echo "ALL PROD-LIKE (RLS ENFORCED) CHECKS PASSED"
cleanup
