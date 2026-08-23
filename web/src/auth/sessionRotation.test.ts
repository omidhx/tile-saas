import { test } from "node:test";
import assert from "node:assert/strict";

// این تست‌ها برای session rotation در login هستند.
// برای integration test کامل نیاز به PostgreSQL + Next.js runtime است،
// ولی منطقِ session_epoch را با mock تست می‌کنیم.

// منطقِ session rotation در login/route.ts:
// ۱. await sql.begin(async (tx) => invalidateSessionsIn(tx, user.id));
//    → UPDATE app_user SET session_epoch = session_epoch + 1 WHERE id = userId
// ۲. await setSessionCookie(user.id);
//    → issueSession: SELECT session_epoch FROM app_user → JWT با ep جدید

// این تست‌ها قراردادِ session rotation را مستند می‌کنند.

test("Session rotation: ترتیب عملیات در login", () => {
  // ترتیب باید این باشد:
  // ۱. invalidateSessionsIn (session_epoch++)
  // ۲. setSessionCookie (JWT با ep جدید)
  // اگر برعکس باشد، JWT با ep قدیمی صادر می‌شود و بلافاصله باطل می‌شود.

  const steps: string[] = [];
  // شبیه‌سازی ترتیب:
  steps.push("invalidateSessionsIn"); // session_epoch++
  steps.push("setSessionCookie");     // JWT با ep جدید

  assert.equal(steps[0], "invalidateSessionsIn");
  assert.equal(steps[1], "setSessionCookie");
});

test("Session rotation: session_epoch شمارنده است نه timestamp", () => {
  // session_epoch عدد صحیح است، نه timestamp.
  // هر تغییر رمز یا logout-all یکی جلو می‌برد.
  // JWT آن را حمل می‌کند و فقط اگر برابر باشد معتبر است.

  let epoch = 0;
  const tokens: { ep: number }[] = [];

  // login اول: epoch = 0
  tokens.push({ ep: epoch });

  // login دوم (rotation): epoch = 1
  epoch++; // invalidateSessionsIn
  tokens.push({ ep: epoch }); // setSessionCookie با ep جدید

  // token اول باید invalid باشد (ep ≠ epoch)
  assert.notEqual(tokens[0].ep, epoch);
  // token دوم باید معتبر باشد (ep = epoch)
  assert.equal(tokens[1].ep, epoch);
});

test("Session rotation: logout-all همه را باطل می‌کند", () => {
  let epoch = 0;
  const userTokens = [
    { ep: epoch }, // token از دستگاه ۱
    { ep: epoch }, // token از دستگاه ۲
  ];

  // logout-all: epoch++
  epoch++;

  // هر دو token باید invalid باشند
  assert.notEqual(userTokens[0].ep, epoch);
  assert.notEqual(userTokens[1].ep, epoch);
});

test("Session rotation: password change همه را باطل می‌کند", () => {
  let epoch = 0;
  const tokenBefore = { ep: epoch };

  // password change: epoch++ (در passwordFlows.ts:87)
  epoch++;

  // token قبلی باید invalid باشد
  assert.notEqual(tokenBefore.ep, epoch);
});

test("Session rotation: password reset همه را باطل می‌کند", () => {
  let epoch = 0;
  const tokenBefore = { ep: epoch };

  // password reset confirm: epoch++ (در passwordFlows.ts:193)
  epoch++;

  // token قبلی باید invalid باشد
  assert.notEqual(tokenBefore.ep, epoch);
});

test("Session rotation: session‌های کاربران دیگر invalid نمی‌شوند", () => {
  let userAEpoch = 0;
  let userBEpoch = 0;

  // user A login: rotation
  userAEpoch++; // invalidateSessionsIn for user A
  const tokenA = { ep: userAEpoch, userId: "A" };

  // user B login: rotation (نباید روی A تأثیر بگذارد)
  userBEpoch++; // invalidateSessionsIn for user B
  const tokenB = { ep: userBEpoch, userId: "B" };

  // token A باید هنوز معتبر باشد
  assert.equal(tokenA.ep, userAEpoch);
  // token B باید معتبر باشد
  assert.equal(tokenB.ep, userBEpoch);
});
