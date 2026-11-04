import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * قبل از بالا آمدن سرور e2e اجرا می‌شود (playwright.config.ts): DB جدا، seed، نقش محدود.
 * جدا از globalSetup چون Playwright سرور را قبل از globalSetup بالا می‌آورد و استارتاپ
 * اپ نقش را چک می‌کند.
 */
const appUrl = new URL(process.env.DATABASE_URL!);
const adminUrl = new URL(process.env.E2E_ADMIN_DATABASE_URL!);
const dbName = appUrl.pathname.slice(1);

// seed کل schema را DROP می‌کند؛ این اسکریپت فقط روی DB تست اجرا می‌شود، هرچه web/.env بگوید.
if (!dbName.endsWith("_test") || adminUrl.pathname !== appUrl.pathname || appUrl.username !== "app_user") {
  throw new Error(`e2e فقط روی DB با نام *_test و با نقش app_user اجرا می‌شود؛ الان «${dbName}» با «${appUrl.username}».`);
}

const maintenanceUrl = new URL(adminUrl);
maintenanceUrl.pathname = "/postgres";
const maintenance = postgres(maintenanceUrl.href, { max: 1, onnotice: () => {} });
const [exists] = await maintenance`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
if (!exists) await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
await maintenance.end();

execSync("npm run seed:dev", { stdio: "inherit", env: { ...process.env, DATABASE_URL: adminUrl.href } });

const admin = postgres(adminUrl.href, { max: 1, onnotice: () => {} });
await admin.unsafe(readFileSync(new URL("../../db/create-app-user.sql", import.meta.url), "utf8"));
await admin.unsafe(`ALTER ROLE app_user PASSWORD '${decodeURIComponent(appUrl.password).replaceAll("'", "''")}'`);
await admin.end();
