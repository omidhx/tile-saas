import Icon from "../Icon";

const money = (v: number) => v.toLocaleString("fa-IR");

/** کارتِ چسبانِ سبد: جمعِ زنده + هشدارهای نرم (شیدِ مخلوط/چندانباره) + دکمه‌ی ثبت. صرفاً presentational. */
export default function CartSummary({
  itemCount, cartBoxes, cartValue, anyUnpriced, mixedShade, mixedWarehouse, cartWarehouses, pending, onSubmit,
}: {
  itemCount: number; cartBoxes: number; cartValue: number; anyUnpriced: boolean;
  mixedShade: boolean; mixedWarehouse: boolean; cartWarehouses: Set<string | undefined>;
  pending: boolean; onSubmit: () => void;
}) {
  return (
    <div className="card card--raised" style={{ position: "sticky", bottom: "var(--sp-3)" }}>
      <div className="row">
        <strong>سبد رزرو</strong>
        <span className="badge">{money(itemCount)} قلم · {money(cartBoxes)} کارتن</span>
      </div>

      {/* جمعِ ریالیِ تقریبی — «تقریبی» چون تخفیفِ حجمی و قیمتِ قطعی در لحظه‌ی تأیید */}
      {cartValue > 0 && (
        <div className="row" style={{ marginTop: "var(--sp-2)" }}>
          <span className="muted">جمعِ تقریبی</span>
          <span className="metric">{money(cartValue)} ریال</span>
        </div>
      )}
      {anyUnpriced && (
        <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
          بعضی اقلام قیمتِ ثبت‌شده ندارند و در این جمع نیستند — قیمتِ نهایی را پشتیبان تأیید می‌کند.
        </div>
      )}

      {/* هشدارِ نرم، نه منع: تصمیم با نماینده است ولی باید پیامدش را بداند */}
      {mixedShade && (
        <div className="banner banner--warn" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
          <Icon name="alert" /><span>شیدهای متفاوت در سبد — برای یک سطحِ پیوسته توصیه نمی‌شود.</span>
        </div>
      )}
      {mixedWarehouse && (
        <div className="banner banner--warn" style={{ marginTop: "var(--sp-2)", marginBottom: 0 }}>
          <Icon name="warehouse" />
          <span>
            سبد از {money(cartWarehouses.size)} انبار است ({[...cartWarehouses].join("، ")}) — این سفارش به{" "}
            {money(cartWarehouses.size)} حواله‌ی جدا تقسیم می‌شود، چون هر کامیون از یک انبار بار می‌زند.
          </span>
        </div>
      )}

      <div className="row row--stack-mobile" style={{ marginTop: "var(--sp-3)", justifyContent: "flex-start" }}>
        <button className="primary" onClick={onSubmit} disabled={pending} aria-busy={pending}>
          {pending && <span className="spinner" aria-hidden="true" />}
          {pending ? "در حال ثبت…" : "ثبت رزرو (همه یا هیچ)"}
        </button>
      </div>
    </div>
  );
}
