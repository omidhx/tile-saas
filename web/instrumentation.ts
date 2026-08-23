export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // DB-001: در production، در startup بررسی کن که اپ با non-superuser وصل شده.
    // اگر superuser یا BYPASSRLS باشد، fail-loud — اپ بالا نمی‌آید.
    // در dev و test نادیده گرفته می‌شود.
    // نکته: next start همیشه NODE_ENV=production ست می‌کند، حتی اگر CI
    // NODE_ENV=test ست کرده باشد. پس باید بررسی کنیم که واقعاً production است
    // نه اینکه فقط next start اجرا شده. در CI smoke test، DATABASE_URL به
    // postgres superuser وصل می‌شود، پس نباید این check اجرا شود.
    // راه‌حل: فقط اگر SKIP_ROLE_CHECK نیست و NODE_ENV=production است.
    if (process.env.NODE_ENV === "production" && !process.env.SKIP_ROLE_CHECK) {
      const { assertNonSuperuserRole } = await import("@/db/client");
      try {
        await assertNonSuperuserRole();
        console.log("[startup] ✓ DB role verification passed — connected as non-superuser");
      } catch (err) {
        console.error("[startup] ✗ SECURITY: DB role verification failed:", err);
        // fail-loud — اپ بالا نمی‌آید
        throw err;
      }
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError = async (...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
