import { getPublicCatalog } from "@/db/sharedCatalog";

// صفحه‌ی عمومیِ کاتالوگ برای مشتریِ نهایی — بدونِ لاگین. Server Component: مستقیم از
// DB می‌خواند، هیچ API عمومی‌ای باز نمی‌شود و هیچ JSِ کلاینتی لازم نیست. قیمت و عددِ
// دقیقِ موجودی عمداً نمایش داده نمی‌شوند.
export const dynamic = "force-dynamic"; // موجود/ناموجود باید زنده باشد، نه build-time

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

      {data.items.length === 0 && <p className="empty">این کاتالوگ فعلاً محصولی ندارد.</p>}

      <div className="catalog-grid">
        {data.items.map((it) => (
          <div className="card" key={it.code} style={{ margin: 0 }}>
            {it.imageUrl
              ? <img src={it.imageUrl} alt={it.name} loading="lazy" className="catalog-img" />
              : <div className="catalog-img catalog-img--empty" aria-hidden="true" />}
            <div style={{ marginTop: "var(--sp-2)" }}>
              <div className="row">
                <strong>{it.name}</strong>
                <span className={`badge ${it.inStock ? "badge--ok" : "badge--warn"}`}>
                  {it.inStock ? "موجود" : "ناموجود"}
                </span>
              </div>
              <div className="subtle num">{it.code}</div>
              {[it.color, it.glaze, it.punch, it.body].filter(Boolean).length > 0 && (
                <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
                  {[it.color, it.glaze, it.punch, it.body].filter(Boolean).join(" · ")}
                </div>
              )}
              {it.customerPrice != null && (
                <div className="muted" style={{ marginTop: "var(--sp-1)" }}>
                  <span className="metric">{it.customerPrice.toLocaleString("fa-IR")}</span> ریال / مترمربع
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="muted" style={{ marginTop: "var(--sp-5)", textAlign: "center" }}>
        برای ثبتِ سفارش با نماینده‌ی خود تماس بگیرید.
      </p>
    </main>
  );
}
