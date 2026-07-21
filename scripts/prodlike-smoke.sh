#!/usr/bin/env bash
# اجرای اپ با نقشِ production (non-superuser، RLS واقعاً فعال) + تست دودِ GO_LIVE.
set -uo pipefail
cd "W:/Claude Site/tile-saas/web"
PORT=3311
T=11111111-1111-1111-1111-111111111111
AG=a5555555-5555-5555-5555-555555555555
WH=a3333333-3333-3333-3333-333333333333
fail(){ echo "FAIL: $1"; cleanup; exit 1; }

# هرچه روی $PORT گوش می‌دهد را می‌کشد.
# چرا لازم است: `npx next start` یک فرزند spawn می‌کند و kill کردنِ $APP_PID فقط
# پوسته‌ی npx را می‌کشد — سرورِ واقعی زنده می‌ماند. نتیجه‌اش بدترین حالتِ ممکن بود:
# اجرای بعدی نمی‌توانست پورت را بگیرد، ولی اسکریپت به همان سرورِ **قدیمی** curl
# می‌زد و سبز می‌شد. یعنی تست به‌جای کدِ جدید، باینریِ قبلی را تأیید می‌کرد.
kill_port(){
  local pids
  pids=$(netstat -ano 2>/dev/null | grep "LISTENING" | grep ":$1 " | awk '{print $NF}' | sort -u)
  for p in $pids; do taskkill //PID "$p" //F >/dev/null 2>&1; done
}
cleanup(){ [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null; kill_port "$PORT"; docker rm -f tile_prod >/dev/null 2>&1; }

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
# پورت باید **قبل** از شروع خالی باشد، وگرنه به سرورِ قبلی وصل می‌شویم و تست دروغ می‌گوید
kill_port "$PORT"
sleep 1
curl -s -o /dev/null "localhost:$PORT/login" 2>/dev/null && fail "پورت $PORT هنوز اشغال است — سرورِ قبلی را بکش"

DATABASE_URL="postgres://app_user:apppw@localhost:55434/postgres" AUTH_SECRET="0123456789abcdef0123456789abcdef" \
  npx next start -p $PORT >/tmp/prod.log 2>&1 &
APP_PID=$!
for i in $(seq 1 90); do curl -s "localhost:$PORT/login" >/dev/null 2>&1 && break; sleep 1; done
curl -s "localhost:$PORT/login" >/dev/null 2>&1 || fail "app never came up ($(tail -5 /tmp/prod.log))"
# تأییدِ اینکه سرورِ پاسخ‌دهنده همین build است، نه یک zombie
BID=$(cat .next/BUILD_ID 2>/dev/null)
echo "  build id: $BID"

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
# v2 چندانباره: پاسخ حالا آرایه است (سفارشِ دوانباره دو حواله می‌شود)
DID=$(grep -o '"dispatchIds":\["[^"]*"' /tmp/pb | cut -d'"' -f4)
[ -n "$DID" ] || fail "no dispatchIds in response: $(cat /tmp/pb)"
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
echo "$OUT" | grep -q "waitlist offer" || fail "expire worker failed: $OUT"

# ---------------------------------------------------------------------------
# از اینجا به بعد: هرچه بعد از اجرای قبلیِ این اسکریپت اضافه شد.
# همه‌ی این مسیرها جدولِ RLSدار لمس می‌کنند و هیچ‌کدام قبلاً زیر نقشِ واقعیِ اپ
# اجرا نشده بودند.
# ---------------------------------------------------------------------------

echo "== 8. بازیابی رمز: کد باید واقعاً به Outbox برسد (RLS) =="
# این دقیقاً همان تله‌ی workerِ پیامک است: notification_outbox و tenant_membership
# هر دو tenant_id دارند، پس بدونِ app.tenant_id این INSERT صفر ردیف می‌درج می‌کرد —
# بدون خطا، فقط سکوت، و نماینده تا ابد منتظرِ پیامکی که نمی‌آید.
docker exec tile_prod psql -U postgres -q -c "DELETE FROM notification_outbox" >/dev/null
c=$(api -X POST "localhost:$PORT/api/auth/reset" -H 'content-type: application/json' \
  -d '{"phone":"09120000000"}')
[ "$c" = 200 ] || fail "reset request $c ($(cat /tmp/pb))"
NROW=$(docker exec tile_prod psql -U postgres -tAc \
  "SELECT count(*) FROM notification_outbox WHERE payload->>'type'='password_reset'" | tr -d '[:space:]')
[ "$NROW" = 1 ] || fail "کدِ بازیابی به Outbox نرفت (RLS): rows=$NROW"
PRROW=$(docker exec tile_prod psql -U postgres -tAc \
  "SELECT count(*) FROM password_reset WHERE used_at IS NULL" | tr -d '[:space:]')
[ "$PRROW" = 1 ] || fail "ردیف password_reset ساخته نشد: $PRROW"
echo "  کد ساخته شد و پیامکش صف شد OK"

echo "== 9. بازیابی رمز: کد درست واقعاً رمز را عوض می‌کند =="
CODE=$(docker exec tile_prod psql -U postgres -tAc \
  "SELECT payload->>'code' FROM notification_outbox WHERE payload->>'type'='password_reset' LIMIT 1" | tr -d '[:space:]')
[ -n "$CODE" ] || fail "کد از payload خوانده نشد"
c=$(api -X POST "localhost:$PORT/api/auth/reset" -H 'content-type: application/json' \
  -d "{\"phone\":\"09120000000\",\"code\":\"$CODE\",\"newPassword\":\"prodlike12345\"}")
[ "$c" = 200 ] || fail "reset confirm $c ($(cat /tmp/pb))"
# نشستِ قدیمیِ نماینده باید مرده باشد (sessions_valid_from جلو رفته)
c=$(api -H "$AH" "localhost:$PORT/api/me")
[ "$c" = 401 ] || fail "نشستِ قدیمی بعد از بازیابی رمز باید ۴۰۱ می‌گرفت، گرفت $c"
echo "  رمز عوض شد و نشستِ قدیمی باطل شد OK"

# نماینده را با رمزِ تازه دوباره وارد می‌کنیم (بقیه‌ی تست‌ها به نشستش نیاز دارند)
AT=$(curl -s -D - -o /dev/null -X POST "localhost:$PORT/api/auth/login" -H 'content-type: application/json' \
  -d '{"phone":"09120000000","password":"prodlike12345"}' | grep -i '^set-cookie: session=' | sed -E 's/.*session=([^;]*).*/\1/' | tr -d '\r')
[ -n "$AT" ] || fail "ورود با رمزِ جدید ناموفق"
AH="Cookie: session=$AT"

echo "== 10. صف انتظار زیر RLS (لغو → پیشنهادِ خودکار) =="
# waitlist_entry ستون tenant_id دارد؛ advanceWaitlist داخلِ تراکنشِ لغو اجرا می‌شود.
docker exec tile_prod psql -U postgres -q -c "DELETE FROM notification_outbox" >/dev/null
VAR=77777777-7777-7777-7777-777777777777
# همه‌ی موجودیِ باقیمانده را می‌گیریم تا کالا ناموجود شود
c=$(api -H "$AH" -X POST "localhost:$PORT/api/reservations" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$T\",\"agentAccountId\":\"$AG\",\"idempotencyKey\":\"pw-hog\",\"items\":[{\"lotId\":\"$LOT\",\"quantityBoxes\":70}]}")
[ "$c" = 201 ] || fail "hog reserve $c ($(cat /tmp/pb))"
HOG=$(grep -o '"reservationId":"[^"]*"' /tmp/pb | cut -d'"' -f4)
c=$(api -H "$AH" -X POST "localhost:$PORT/api/waitlist" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$T\",\"agentAccountId\":\"$AG\",\"variantId\":\"$VAR\",\"quantityBoxes\":25}")
[ "$c" = 201 ] || fail "join waitlist $c ($(cat /tmp/pb))"
c=$(api -H "$SH" -X POST "localhost:$PORT/api/reservations/$HOG/cancel" -H 'content-type: application/json' -d "{\"tenantId\":\"$T\"}")
[ "$c" = 200 ] || fail "cancel $c ($(cat /tmp/pb))"
LEFT=$(docker exec tile_prod psql -U postgres -tAc "SELECT count(*) FROM waitlist_entry" | tr -d '[:space:]')
[ "$LEFT" = 0 ] || fail "نوبت مصرف نشد — صف زیر RLS جلو نرفت (باقی‌مانده: $LEFT)"
OFFER=$(docker exec tile_prod psql -U postgres -tAc \
  "SELECT count(*) FROM notification_outbox WHERE payload->>'type'='waitlist_offer'" | tr -d '[:space:]')
[ "$OFFER" = 1 ] || fail "پیامِ پیشنهادِ صف صف نشد: $OFFER"
NEWR=$(docker exec tile_prod psql -U postgres -tAc \
  "SELECT count(*) FROM reservation WHERE status='active'" | tr -d '[:space:]')
[ "$NEWR" = 1 ] || fail "رزروِ پیشنهادیِ صف ساخته نشد: $NEWR"
echo "  صف جلو رفت، رزرو ساخته شد، پیام صف شد OK"

echo "== 11. تأیید هیبریدی زیر RLS =="
# سقف و قیمت را می‌گذاریم؛ سفارشِ کوچک باید بدونِ تأییدِ staff قطعی شود.
docker exec -i tile_prod psql -U postgres -v ON_ERROR_STOP=1 -q <<SQL || fail "pricing seed"
INSERT INTO price_list(id,tenant_id,name) VALUES('aaaa1111-1111-1111-1111-111111111111','$T','L');
UPDATE agent_account SET price_list_id='aaaa1111-1111-1111-1111-111111111111' WHERE id='$AG';
INSERT INTO price_list_item(tenant_id,price_list_id,variant_id,price)
  VALUES('$T','aaaa1111-1111-1111-1111-111111111111','$VAR',1000000);
UPDATE tenant SET auto_approve_limit = 50000000 WHERE id='$T';
SQL
# رزروِ فعلیِ صف را لغو می‌کنیم تا موجودی آزاد شود
RID2=$(docker exec tile_prod psql -U postgres -tAc "SELECT id FROM reservation WHERE status='active' LIMIT 1" | tr -d '[:space:]')
api -H "$SH" -X POST "localhost:$PORT/api/reservations/$RID2/cancel" -H 'content-type: application/json' -d "{\"tenantId\":\"$T\"}" >/dev/null
c=$(api -H "$AH" -X POST "localhost:$PORT/api/reservations" -H 'content-type: application/json' \
  -d "{\"tenantId\":\"$T\",\"agentAccountId\":\"$AG\",\"idempotencyKey\":\"pw-auto\",\"items\":[{\"lotId\":\"$LOT\",\"quantityBoxes\":10}]}")
[ "$c" = 201 ] || fail "auto-approve reserve $c ($(cat /tmp/pb))"
grep -q '"autoApproved":{' /tmp/pb || fail "زیرِ سقف بود ولی خودکار تأیید نشد: $(cat /tmp/pb)"
MODE=$(docker exec tile_prod psql -U postgres -tAc \
  "SELECT approval_mode FROM sales_request ORDER BY created_at DESC LIMIT 1" | tr -d '[:space:]')
[ "$MODE" = "auto" ] || fail "approval_mode باید auto می‌بود: $MODE"
echo "  سفارشِ زیرِ سقف خودکار تأیید شد و approval_mode=auto ثبت شد OK"

echo "== 12. گزارش‌ها و قیمت‌گذاری زیر RLS =="
c=$(api -H "$SH" "localhost:$PORT/api/reports?tenantId=$T")
[ "$c" = 200 ] || fail "reports $c ($(cat /tmp/pb))"
grep -q '"agents"' /tmp/pb || fail "گزارش ساختار درست ندارد: $(head -c 200 /tmp/pb)"
c=$(api -H "$SH" "localhost:$PORT/api/settings/auto-approve?tenantId=$T")
[ "$c" = 200 ] || fail "auto-approve settings $c"
c=$(api -H "$AH" "localhost:$PORT/api/waitlist?tenantId=$T&agentAccountId=$AG")
[ "$c" = 200 ] || fail "waitlist list $c"
echo "  reports + settings + waitlist همه ۲۰۰ OK"

echo ""
echo "ALL PROD-LIKE (RLS ENFORCED) CHECKS PASSED"
cleanup
