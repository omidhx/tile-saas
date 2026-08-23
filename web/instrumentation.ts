export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // DB-001: در production، در startup بررسی کن که اپ با non-superuser وصل شده.
    // اگر superuser یا BYPASSRLS باشد، fail-loud — اپ بالا نمی‌آید.
    // این تابع در dev و test نادیده گرفته می‌شود.
    if (process.env.NODE_ENV === "production") {
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
