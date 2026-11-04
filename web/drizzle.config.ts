import { defineConfig } from "drizzle-kit";

// schema.sql منبع حقیقته (RLS/composite FK را Drizzle خوب بیان نمی‌کنه).
// `npm run db:pull` اسکیمای typed را از دیتابیس introspect می‌کنه → src/db/generated/.
// یعنی هیچ‌وقت ۲۵ جدول را دستی در TS تکرار نمی‌کنیم.
export default defineConfig({
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  out: "./src/db/generated",
});
