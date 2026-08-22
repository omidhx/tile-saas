"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, postJson, loadError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import DeleteButton from "../../DeleteButton";

type Warehouse = { id: string; name: string; code: string; type: string };
const TYPE_FA: Record<string, string> = { main: "اصلی", regional: "منطقه‌ای", in_transit: "در راه" };
const FA: Record<string, string> = {
  code_taken: "این کد قبلاً برای انبارِ دیگری استفاده شده.",
  has_history: "این انبار سابقه دارد (موجودی/حواله/ورودِ اکسل) — حذف نمی‌شود.",
};

export default function WarehousesSection({ ctx }: { ctx: Ctx }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<"main" | "regional" | "in_transit">("regional");

  const [editFor, setEditFor] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ warehouses: Warehouse[] }>(`/api/warehouses?tenantId=${tenantId}`);
    if (res.ok) { setWarehouses(res.data.warehouses); setLoadErr(""); } else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function create() {
    if (!name.trim() || !code.trim()) return;
    setPending("create"); setMsg(""); setErr("");
    const res = await postJson("/api/warehouses", { tenantId: ctx.tenantId, name: name.trim(), code: code.trim(), type });
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `ساخته نشد (خطای ${res.status}).`);
      return;
    }
    setName(""); setCode(""); setType("regional");
    setMsg("انبار ساخته شد.");
    await load(ctx.tenantId);
  }

  function startEdit(w: Warehouse) { setEditFor(w.id); setEditName(w.name); setEditCode(w.code); setMsg(""); setErr(""); }

  async function saveEdit() {
    if (!editFor) return;
    setPending(editFor); setMsg(""); setErr("");
    const res = await postJson("/api/warehouses", { tenantId: ctx.tenantId, warehouseId: editFor, name: editName, code: editCode }, "PATCH");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `ویرایش انجام نشد (خطای ${res.status}).`);
      return;
    }
    setEditFor(null);
    setMsg("انبار ویرایش شد.");
    await load(ctx.tenantId);
  }

  async function remove(warehouseId: string) {
    setPending(warehouseId); setMsg(""); setErr("");
    const res = await postJson("/api/warehouses", { tenantId: ctx.tenantId, warehouseId }, "DELETE");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `حذف انجام نشد (خطای ${res.status}).`);
      return;
    }
    setMsg("انبار حذف شد.");
    await load(ctx.tenantId);
  }

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>انبار حذف نمی‌شود — چون موجودی/حواله‌های قدیمی بهش وصل می‌مانند. اگر انباری تعطیل شد، فقط اسمش را عوض کنید.</span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {err && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      <MessageBanner msg={msg} />

      <h2>انبارِ تازه</h2>
      <div className="card">
        <label htmlFor="wn">نام</label>
        <input id="wn" value={name} onChange={(e) => setName(e.target.value)} placeholder="انبار کرج" />
        <label htmlFor="wc">کد</label>
        <input id="wc" value={code} onChange={(e) => setCode(e.target.value)} placeholder="W3" />
        <label htmlFor="wt">نوع</label>
        <select id="wt" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="main">اصلی</option>
          <option value="regional">منطقه‌ای</option>
          <option value="in_transit">در راه</option>
        </select>
        <button className="primary" onClick={create} aria-busy={pending === "create"}
                disabled={pending === "create" || !name.trim() || !code.trim()}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "create" && <span className="spinner" aria-hidden="true" />}ساختِ انبار
        </button>
      </div>

      <h2>انبارهای موجود</h2>
      {loaded && warehouses.length === 0 && <p className="empty">انباری ثبت نشده.</p>}
      {warehouses.map((w) => (
        <div className="card" key={w.id}>
          {editFor === w.id ? (
            <>
              <label htmlFor={`en-${w.id}`}>نام</label>
              <input id={`en-${w.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <label htmlFor={`ec-${w.id}`}>کد</label>
              <input id={`ec-${w.id}`} value={editCode} onChange={(e) => setEditCode(e.target.value)} />
              <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                <button className="primary" onClick={saveEdit} disabled={pending === w.id || !editName.trim() || !editCode.trim()}>
                  {pending === w.id && <span className="spinner" aria-hidden="true" />}ذخیره
                </button>
                <button className="ghost" onClick={() => setEditFor(null)}>انصراف</button>
              </div>
            </>
          ) : (
            <div className="row">
              <span><strong>{w.name}</strong> <span className="subtle num">{w.code}</span> · <span className="subtle">{TYPE_FA[w.type] ?? w.type}</span></span>
              <span className="row row--start">
                <button className="ghost" onClick={() => startEdit(w)}>ویرایش</button>
                <DeleteButton pending={pending === w.id} onConfirm={() => remove(w.id)} />
              </span>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
