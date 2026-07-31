import type { Metadata } from "next";
import { getPublicCatalog } from "@/db/sharedCatalog";
import CatalogView from "./CatalogView";

// صفحه‌ی عمومیِ کاتالوگ برای مشتریِ نهایی — بدونِ لاگین. Server Component: مستقیم از
// DB می‌خواند، هیچ API عمومی‌ای باز نمی‌شود و هیچ JSِ کلاینتی لازم نیست. قیمت و عددِ
// دقیقِ موجودی عمداً نمایش داده نمی‌شوند.
export const dynamic = "force-dynamic"; // موجود/ناموجود باید زنده باشد، نه build-time

// این لینک امنیتش روی «حدس‌نزدنی بودنِ توکن» است، نه احراز هویت — ایندکس‌شدن در
// گوگل یعنی توکن از طریقِ نتایجِ جست‌وجو/کش قابلِ‌کشف می‌شود.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicCatalogPage(
  { params }: { params: Promise<{ slug: string; token: string }> },
) {
  const { slug, token } = await params;
  const data = await getPublicCatalog({ slug, token });

  if (!data) {
    return (
      <main style={{ maxWidth: 480, textAlign: "center" }}>
        <div className="banner banner--info" style={{ marginTop: "var(--sp-6)" }}>
          <span>این لینک معتبر نیست یا دیگر فعال نیست. لطفاً از نماینده‌ی خود لینکِ تازه بخواهید.</span>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div style={{ marginBottom: "var(--sp-4)" }}>
        <h1 style={{ marginBottom: "var(--sp-1)" }}>{data.title}</h1>
        <p className="muted" style={{ margin: 0 }}>{data.tenantName}</p>
      </div>

      {data.items.length === 0
        ? <p className="empty">این کاتالوگ فعلاً محصولی ندارد.</p>
        : <CatalogView items={data.items} />}

      <p className="muted" style={{ marginTop: "var(--sp-5)", textAlign: "center" }}>
        برای ثبتِ سفارش با نماینده‌ی خود تماس بگیرید.
      </p>
    </main>
  );
}
