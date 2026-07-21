"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import { formatJalaliDateTime } from "@/lib/date";

type Ctx = { tenantId: string; tenantName: string };
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
  dispatch_load: "بارگیری",
  dispatch_cancel: "لغو حواله (آزادسازی)",
};

const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function LedgerPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [drift, setDrift] = useState<Drift[]>([]);
  // این صفحه یک ادعای ایمنی می‌کند («تراز است»). پس باید «بارگذاری موفق و خالی» را از
  // «بارگذاری ناموفق» تفکیک کند — وگرنه fail-open می‌شود و روی خطای ۴۰۳ هم می‌گوید تراز است.
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const { contexts } = await res.json();
      const staffCtx = contexts?.find((c: { role?: string }) => c.role === "staff" || c.role === "admin") ?? contexts?.[0];
      if (!staffCtx) return;
      setCtx(staffCtx);
      const l = await fetch(`/api/ledger?tenantId=${staffCtx.tenantId}`);
      if (l.ok) {
        const d = await l.json();
        setMovements(d.movements); setDrift(d.drift); setLoaded(true);
      } else {
        setLoadErr(l.status === 403 ? "این گزارش فقط برای پشتیبان است (نقش staff)." : `بارگذاری ناموفق (${l.status})`);
      }
    })();
  }, [router]);

  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>دفتر حرکات موجودی</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <h2>تطبیق لجر با موجودی</h2>
      {loadErr ? (
        <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr} — وضعیت ترازی نامشخص است.</span></div>
      ) : !loaded ? (
        <div className="card"><span className="muted">در حال بررسی…</span></div>
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
      {loaded && movements.length === 0 && <p className="muted">حرکتی ثبت نشده.</p>}
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
    </main>
  );
}
