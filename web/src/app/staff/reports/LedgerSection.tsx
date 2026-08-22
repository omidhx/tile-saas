"use client";
import { useState } from "react";
import Icon from "../../Icon";
import { getJson } from "@/lib/api";
import { usePaginatedSearch } from "@/lib/usePaginatedSearch";
import type { Ctx } from "@/lib/useContexts";
import { formatJalaliDateTime } from "@/lib/date";
import { exportXlsx } from "@/lib/exportXlsx";

type Movement = {
  id: string; type: string; onHandDelta: number; allocatedDelta: number;
  refType: string | null; createdAt: string; note: string | null;
  name: string; code: string; batch: string | null; actor: string | null;
};
type Drift = {
  lotId: string; name: string; code: string; batch: string | null;
  onHand: number; ledgerOnHand: number; allocated: number; ledgerAllocated: number;
};

const TYPE_FA: Record<string, string> = {
  import_snapshot: "ورود از اکسل",
  import_snapshot_zero: "صفرشدن (غایب در اکسل)",
  reservation_hold: "رزرو (نگه‌داشت)",
  reservation_convert: "تأیید → تخصیص",
  reservation_cancel: "لغوِ رزرو (آزادسازی)",
  dispatch_load: "بارگیری",
  dispatch_cancel: "لغو حواله (آزادسازی)",
  incoming_arrival: "رسیدنِ محموله‌ی در راه",
  initial_stock: "موجودیِ اولیه (هنگامِ ساختِ محصول)",
};

const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

// append-only: هر چه کارخانه بیشتر کار کند، این جدول فقط بزرگ‌تر می‌شود — بدونِ
// صفحه‌بندی، حرکتِ چند ماه پیش زیرِ LIMIT ثابت از دیدِ پشتیبان بیرون می‌افتاد.
const fetchMovements = (tenantId: string, query: string, offset: number) =>
  getJson<{ movements: Movement[]; drift: Drift[]; hasMore: boolean }>(
    `/api/ledger?tenantId=${tenantId}&offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ""}`);

export default function LedgerSection({ ctx }: { ctx: Ctx }) {
  // این صفحه یک ادعای ایمنی می‌کند («تراز است»). پس باید «بارگذاری موفق و خالی» را از
  // «بارگذاری ناموفق» تفکیک کند — وگرنه fail-open می‌شود و روی خطای ۴۰۳ هم می‌گوید تراز است.
  const [drift, setDrift] = useState<Drift[]>([]);
  const { rows: movements, q, hasMore, moreBusy, loadErr, loaded, search, loadMore } =
    usePaginatedSearch(ctx.tenantId, fetchMovements, (raw) => raw.movements, {
      // drift فقط رویِ بارگذاریِ اولیه/reload به‌روز می‌شود، نه جستجو — تراز خاصیتِ
      // کلِ داده است، نه چیزی که با یک فیلترِ متنی معنا داشته باشد به‌روز شود.
      onInitialLoad: (raw) => setDrift(raw.drift),
    });

  const [exporting, setExporting] = useState(false);
  /** خروجی همیشه همه‌ی نتیجه‌ی جستجوی فعلی را می‌گیرد، نه فقط صفحه‌ی بارگذاری‌شده روی صفحه. */
  async function exportAll() {
    setExporting(true);
    try {
      const res = await getJson<{ movements: Movement[] }>(
        `/api/ledger?tenantId=${ctx.tenantId}&offset=0&limit=20000${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      if (!res.ok) return;
      exportXlsx(`دفتر-حرکات-${ctx.tenantId.slice(0, 8)}.xlsx`, {
        "حرکات": res.data.movements.map((m) => ({
          "تاریخ": formatJalaliDateTime(m.createdAt), "کالا": m.name, "کد": m.code, "بچ": m.batch ?? "",
          "نوع": TYPE_FA[m.type] ?? m.type, "موجودی": m.onHandDelta, "تخصیص": m.allocatedDelta,
          "عامل": m.actor ?? "", "یادداشت": m.note ?? "",
        })),
      });
    } finally { setExporting(false); }
  }

  return (
    <>
      <h2>تطبیق لجر با موجودی</h2>
      {loadErr ? (
        <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr} — وضعیت ترازی نامشخص است.</span></div>
      ) : !loaded ? (
        <div className="card"><span className="muted"><span className="spinner" aria-hidden="true" /> در حال بررسی…</span></div>
      ) : drift.length === 0 ? (
        <div className="banner banner--ok" role="status">
          <Icon name="check" /><span>تراز است — جمع لجر با موجودی هر Lot می‌خواند.</span>
        </div>
      ) : (
        <>
          <div className="banner banner--error" role="alert">
            <Icon name="alert" />
            <span>
              {drift.length.toLocaleString("fa-IR")} Lot ناتراز: موجودی از مسیری عوض شده که لجر
              ننوشته (مثلاً UPDATE دستی روی دیتابیس).
            </span>
          </div>
          {drift.map((d) => (
            <div className="card" key={d.lotId}>
              <div className="row">
                <strong>{d.name} <span className="muted">({d.code}{d.batch ? ` · بچ ${d.batch}` : ""})</span></strong>
              </div>
              <div className="muted">
                on_hand: {d.onHand} ولی جمع لجر {d.ledgerOnHand} (اختلاف {sign(d.onHand - d.ledgerOnHand)})
                {d.allocated !== d.ledgerAllocated &&
                  ` · allocated: ${d.allocated} ولی جمع لجر ${d.ledgerAllocated} (اختلاف ${sign(d.allocated - d.ledgerAllocated)})`}
              </div>
            </div>
          ))}
        </>
      )}

      <h2>حرکات اخیر</h2>
      <div className="row row--start no-print" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
        <button onClick={exportAll} aria-busy={exporting} disabled={exporting}>
          {exporting && <span className="spinner" aria-hidden="true" />}<Icon name="download" size={13} />خروجیِ اکسل (کلِ نتیجه)
        </button>
        <button onClick={() => window.print()}><Icon name="printer" size={13} />خروجیِ PDF (چاپ)</button>
      </div>
      <input type="search" aria-label="جستجوی حرکات" placeholder="جستجو: کالا، کد، بچ…" className="no-print"
        value={q} onChange={(e) => search(e.target.value)} style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && !loadErr && movements.length === 0 && <p className="empty">{q ? "چیزی پیدا نشد." : "حرکتی ثبت نشده."}</p>}
      {movements.map((m) => (
        <div className="card" key={m.id}>
          <div className="row">
            <strong>{m.name} <span className="muted">({m.code}{m.batch ? ` · بچ ${m.batch}` : ""})</span></strong>
            <span className="muted">{formatJalaliDateTime(m.createdAt)}</span>
          </div>
          <div className="muted">
            {TYPE_FA[m.type] ?? m.type}
            {m.onHandDelta !== 0 && ` · موجودی ${sign(m.onHandDelta)}`}
            {m.allocatedDelta !== 0 && ` · تخصیص ${sign(m.allocatedDelta)}`}
            {m.actor && ` · ${m.actor}`}
          </div>
        </div>
      ))}
      {hasMore && (
        <button className="no-print" onClick={loadMore} aria-busy={moreBusy} disabled={moreBusy} style={{ width: "100%" }}>
          {moreBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}
    </>
  );
}
