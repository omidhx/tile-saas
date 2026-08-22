import { execSync } from "node:child_process";

/**
 * قبل از هر اجرای e2e، DBِ dev را با seed:dev بازمی‌سازد — همان دیتای
 * شناخته‌شده‌ای که وقتِ تستِ دستی هم استفاده می‌شود (۰۹۱۲۰۰۰۰۰۰۱ پشتیبان،
 * ۰۹۱۲۰۰۰۰۰۰۰۰ نماینده، رمزِ هردو pass1234). seed:dev خودش گاردِ
 * NODE_ENV==='production' دارد، پس این‌جا خطری نیست.
 */
export default function globalSetup() {
  execSync("npm run seed:dev", { cwd: __dirname + "/..", stdio: "inherit" });
}
