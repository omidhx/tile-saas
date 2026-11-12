import { notFound } from "next/navigation";

/**
 * با دو root layout، آدرس ناموجود layout ندارد و Next یک html خام و static می‌سازد (بدون lang/dir و
 * بدون nonce، پس CSP اسکریپت‌هایش را می‌بندد). این catch-all آن را به همین layout می‌آورد؛ مسیرهای
 * مشخص همیشه بر catch-all می‌برند. با خالی شدن `(legacy)` همراه layout به `(app)` می‌رود.
 */
export default function Missing() {
  notFound();
}
