"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { formatMoney, type CurrencyUnit } from "@/lib/money";

type Settings = { ttlHours: number; logoUrl: string | null; currencyUnit: CurrencyUnit };

export default function SettingsSection({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<Settings | null>(null);
  const [ttlDraft, setTtlDraft] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<Settings>(`/api/settings/tenant?tenantId=${tenantId}`);
    if (res.ok) { setS(res.data); setTtlDraft(String(res.data.ttlHours)); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function saveTtl() {
    const hours = Number(ttlDraft);
    if (!Number.isInteger(hours) || hours <= 0) { setMsg({ kind: "err", text: "مدتِ اعتبار باید عددِ صحیحِ مثبت باشد." }); return; }
    setSaving(true); setMsg(null);
    const res = await postJson("/api/settings/tenant", { tenantId: ctx.tenantId, ttlHours: hours }, "PATCH");
    if (res.ok) { setMsg({ kind: "ok", text: "ذخیره شد." }); await load(ctx.tenantId); }
    else setMsg({ kind: "err", text: actionError(res.status) });
    setSaving(false);
  }

  async function uploadLogo(file: File) {
    setUploading(true); setMsg(null);
    try {
      const form = new FormData();
      form.append("tenantId", ctx.tenantId);
      form.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: form });
      if (!up.ok) { setMsg({ kind: "err", text: actionError(up.status) }); return; }
      const { url } = await up.json();
      const res = await postJson("/api/settings/tenant", { tenantId: ctx.tenantId, logoUrl: url }, "PATCH");
      if (res.ok) { setMsg({ kind: "ok", text: "لوگو به‌روز شد." }); await load(ctx.tenantId); }
      else setMsg({ kind: "err", text: actionError(res.status) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    setSaving(true); setMsg(null);
    const res = await postJson("/api/settings/tenant", { tenantId: ctx.tenantId, logoUrl: null }, "PATCH");
    if (res.ok) { setMsg({ kind: "ok", text: "لوگو حذف شد." }); await load(ctx.tenantId); }
    else setMsg({ kind: "err", text: actionError(res.status) });
    setSaving(false);
  }

  async function setCurrencyUnit(unit: CurrencyUnit) {
    if (unit === s?.currencyUnit) return;
    setSaving(true); setMsg(null);
    const res = await postJson("/api/settings/tenant", { tenantId: ctx.tenantId, currencyUnit: unit }, "PATCH");
    if (res.ok) { setMsg({ kind: "ok", text: "ذخیره شد — همه‌جای سایت (پنلِ پشتیبان، نماینده، کاتالوگِ عمومی) از بارگذاریِ بعدی با این واحد نشان داده می‌شود." }); await load(ctx.tenantId); }
    else setMsg({ kind: "err", text: actionError(res.status) });
    setSaving(false);
  }

  if (loadErr) return <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>;
  if (!s) return <p className="muted"><span className="spinner" /> در حال بارگذاری…</p>;

  return (
    <>
      <MessageBanner msg={msg} />

      <h2>مدتِ اعتبارِ رزرو</h2>
      <div className="card">
        <label htmlFor="ttl">چند ساعت بعدِ رزرو، اگر تأیید نشود، موجودی خودکار آزاد شود</label>
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
          <input id="ttl" inputMode="numeric" value={ttlDraft} onChange={(e) => setTtlDraft(e.target.value)}
            style={{ maxWidth: 120 }} />
          <span className="subtle">ساعت</span>
          <button onClick={saveTtl} aria-busy={saving} disabled={saving}>
            {saving && <span className="spinner" aria-hidden="true" />}ذخیره
          </button>
        </div>
        <div className="muted num">اکنون: {s.ttlHours} ساعت</div>
      </div>

      <h2>لوگو</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          روی صفحه‌ی کاتالوگِ عمومی (لینکی که برای مشتری می‌فرستید) کنارِ نامِ کارخانه نشان داده می‌شود.
        </p>
        {s.logoUrl && (
          <div className="row row--start" style={{ marginBottom: "var(--sp-3)" }}>
            <span className="thumb"><Image src={s.logoUrl} alt="لوگوی کارخانه" width={88} height={88} /></span>
            <button className="ghost" onClick={removeLogo} disabled={saving}>حذفِ لوگو</button>
          </div>
        )}
        <label htmlFor="logo-file" className="btn-file">
          {uploading && <span className="spinner" aria-hidden="true" />}
          {s.logoUrl ? "تعویضِ لوگو" : "آپلودِ لوگو"}
        </label>
        <input ref={fileRef} id="logo-file" type="file" accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }} disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
      </div>

      <h2>واحدِ نمایشِ مبلغ</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          فقط نمایش عوض می‌شود — همه‌جای سایت (پنلِ پشتیبان، نماینده، کاتالوگِ عمومی، خروجیِ اکسل).
          ذخیره‌سازی و محاسبات همیشه ریال می‌مانند؛ ورودی‌های فرم هم همیشه با ریال پر می‌شوند.
        </p>
        <div className="row row--start" style={{ gap: "var(--sp-3)" }}>
          <label className="row row--start" style={{ gap: ".4rem", cursor: "pointer" }}>
            <input type="radio" name="currency-unit" checked={s.currencyUnit === "rial"} disabled={saving}
              onChange={() => setCurrencyUnit("rial")} />
            ریال
          </label>
          <label className="row row--start" style={{ gap: ".4rem", cursor: "pointer" }}>
            <input type="radio" name="currency-unit" checked={s.currencyUnit === "toman"} disabled={saving}
              onChange={() => setCurrencyUnit("toman")} />
            تومان
          </label>
        </div>
        <div className="muted num" style={{ marginTop: "var(--sp-2)" }}>
          نمونه: {formatMoney(1_250_000, s.currencyUnit)}
        </div>
      </div>
    </>
  );
}
