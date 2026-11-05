export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // در production اپ با نقش superuser یا BYPASSRLS بالا نمی‌آید.
    // throw کافی نیست: Next با register شکست‌خورده بالا می‌ماند و هر درخواست ۵۰۰ می‌دهد.
    // خروج از پروسه را Docker با restart تکرار می‌کند، پس Postgresِ دیرآمده بعد از ریبوت هم درست می‌شود.
    if (process.env.NODE_ENV === "production") {
      const { assertNonSuperuserRole } = await import("@/db/client");
      try {
        await assertNonSuperuserRole();
        console.log("[startup] ✓ DB role verification passed — connected as non-superuser");
      } catch (err) {
        console.error("[startup] ✗ DB role verification failed:", err);
        process.exit(1);
      }
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

export const onRequestError = async (...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
