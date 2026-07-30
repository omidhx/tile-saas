import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // ponytail: DSN نبود = init بی‌اثر (Sentry خودش این حالت را پشتیبانی می‌کند)، پس dev بدون DSN می‌ماند بدون خطا
});
