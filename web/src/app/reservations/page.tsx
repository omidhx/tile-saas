"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../Icon";
import { getJson, postJson, actionError, loadError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import ContextSwitcher from "../ContextSwitcher";
import { formatJalaliDateTime } from "@/lib/date";

type Item = { name: string; code: string; quantityBoxes: number };
type Resv = { id: string; status: string; expiresAt: string; items: Item[] };

const STATUS_FA: Record<string, string> = {
  active: "در انتظار تأیید پشتیبان", converted: "تأییدشده", expired: "منقضی", cancelled: "لغوشده",
};
const n = (v: number) => v.toLocaleString("fa-IR");

/** هر چند وقت از سرور دوباره بخوان — رزروِ فعال ممکن است تأیید یا منقضی شود. */
const REFRESH_MS = 60_000;

export default function MyReservationsPage() {
  const { contexts, ctx, state, select } = useContexts("agent");
  const [rows, setRows] = useState<Resv[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState("");
  // فقط برای اینکه شمارنده‌ی زنده هر دقیقه دوباره رندر شود؛ مقدارش مهم نیست.
  const [, setTick] = useState(0);

  const load = useCallback(async (c: Ctx) => {
    const res = await getJson<{ reservations: Resv[] }>(
      `/api/reservations?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`);
    if (res.ok) { setRows(res.data.reservations); setLoadErr(""); }
    else setLoadErr(loadError(res.status)); // «رزروی نداری» نباید روی خطا نشان داده شود
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) { setLoadErr(""); load(ctx); } }, [ctx, load]);

  // تازه‌سازیِ خودکار: هم شمارنده را زنده نگه می‌دارد، هم تغییرِ وضعیت (تأیید/انقضا)
  // را بدونِ refreshِ دستی می‌آورد. رزروِ فعال یعنی چیزی در جریان است که نماینده
  // منتظرش است — صفحه‌ی یخ‌زده همان انتظار را کور می‌کند.
  useEffect(() => {
    if (!ctx) return;
    const iv = setInterval(() => {
      setTick((t) => t + 1);       // شمارنده‌ها هر دقیقه به‌روز
      if (rows.some((r) => r.status === "active")) load(ctx); // فقط وقتی چیزی زنده است
    }, REFRESH_MS);
    return () => clearInterval(iv);
  }, [ctx, rows, load]);

  async function cancel(reservationId: string) {
    if (!ctx) return;
    setCancelling(reservationId); setCancelErr("");
    // نتیجه باید چک شود، نه اینکه فقط load() بزنیم — وگرنه ۴۰۳/۵۰۰ بی‌سروصدا رد
    // می‌شود و نماینده فکر می‌کند لغو انجام شد در حالی که رزرو هنوز فعال است.
    const res = await postJson(`/api/reservations/${reservationId}/cancel`,
      { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId });
    if (!res.ok) setCancelErr(actionError(res.status));
    else await load(ctx);
    setCancelling(null);
  }

  /** مهلتِ باقی‌مانده + اینکه آیا کم است (برای هشدارِ بصری). */
  const remaining = (iso: string) => {
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (min <= 0) return { text: "منقضی", low: true };
    if (min < 60) return { text: `${n(min)} دقیقه`, low: true }; // زیر یک ساعت = کم
    return { text: `${n(Math.floor(min / 60))} ساعت`, low: false };
  };

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" />
          <span>این کاربر به نمایندگی‌ای وصل نیست. اگر پشتیبان هستی، <Link href="/staff">به پنل پشتیبان برو</Link>.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  // فعال‌ها کارِ نماینده‌اند (منتظر یا لغو)؛ بقیه تاریخچه‌اند. جدا کردنشان یعنی
  // نماینده کارِ باز را زیرِ انبوهِ رزروهای تمام‌شده گم نمی‌کند.
  const active = rows.filter((r) => r.status === "active");
  const history = rows.filter((r) => r.status !== "active");

  const card = (r: Resv) => {
    const rem = r.status === "active" ? remaining(r.expiresAt) : null;
    return (
      <div className="card" key={r.id}>
        <div className="row">
          <span className={`badge${r.status === "converted" ? " badge--ok" : r.status === "active" ? " badge--warn" : ""}`}>
            {STATUS_FA[r.status] ?? r.status}
          </span>
          {rem && (
            <span className={rem.low ? "err" : "subtle"} style={{ display: "inline-flex", gap: ".3em", alignItems: "center" }}>
              <Icon name="clock" size={13} />{rem.text}{!rem.low ? " مانده" : ""}
            </span>
          )}
        </div>
        <div className="muted">
          {r.items.map((i) => `${i.name} (${i.code}) ×${n(i.quantityBoxes)}`).join("، ")}
        </div>
        {r.status === "active" && (
          <>
            <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
              تا {formatJalaliDateTime(r.expiresAt)} معتبر است
            </div>
            <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
              <button className="ghost" disabled={cancelling === r.id} aria-busy={cancelling === r.id}
                onClick={() => cancel(r.id)}>
                {cancelling === r.id && <span className="spinner" aria-hidden="true" />}لغو رزرو
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>رزروهای من</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName} — {ctx.agentLegalName}</p>
        </div>
        <nav>
          <ContextSwitcher contexts={contexts} ctx={ctx} onSelect={select} mode="agent" />
          <Link href="/reserve">+ رزرو جدید</Link>
        </nav>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {cancelErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{cancelErr}</span></div>}
      {loaded && !loadErr && rows.length === 0 && (
        <p className="empty">هنوز رزروی ثبت نکرده‌ای. <Link href="/reserve">رزرو جدید</Link>.</p>
      )}

      {active.length > 0 && (
        <>
          <h2>در جریان</h2>
          {active.map(card)}
        </>
      )}

      {history.length > 0 && (
        <>
          <h2>تاریخچه</h2>
          {history.map(card)}
        </>
      )}
    </main>
  );
}
