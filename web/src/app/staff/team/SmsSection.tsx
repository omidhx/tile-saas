"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";

type ProviderMeta = { id: string; label: string; fields: string[]; needsParamNames: boolean };
type PatternDraft = { patternCode: string; paramNames?: string };
type Config = {
  enabled: boolean; provider: string | null; senderNumber: string;
  username: string | null; apiKeyMasked: string | null; passwordMasked: string | null;
  patterns: Partial<Record<string, PatternDraft>>;
};

// نوع → (برچسبِ فارسی، ترتیبِ توکن‌هایی که در پترنِ روی پنلِ پروایدر باید بگذارد)
const TYPES: { key: string; label: string; tokens: string }[] = [
  { key: "restock", label: "اطلاعِ موجود شدنِ کالا", tokens: "نامِ کالا، کد" },
  { key: "waitlist_offer", label: "نوبت‌رسیدن در صفِ انتظار", tokens: "نامِ کالا، کد، تعداد، ساعتِ اعتبار" },
  { key: "password_reset", label: "بازیابیِ رمزِ عبور", tokens: "کد، دقیقه‌ی اعتبار" },
  { key: "team_invite", label: "دعوتِ عضوِ تیم", tokens: "نامِ کارخانه، شناسه‌ی ورود، رمزِ موقت" },
  { key: "agent_invite", label: "دعوتِ نمایندگی", tokens: "نامِ نمایندگی، نامِ کارخانه، شناسه‌ی ورود، رمزِ موقت" },
];

export default function SmsSection({ ctx }: { ctx: Ctx }) {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // درفت‌های ورودی — apiKey/password خالی یعنی «دست‌نخورده بماند» (چون خودِ راز هرگز از سرور برنمی‌گردد)
  const [provider, setProvider] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [patterns, setPatterns] = useState<Record<string, PatternDraft>>({});

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ config: Config; providers: ProviderMeta[] }>(`/api/settings/sms?tenantId=${tenantId}`);
    if (!res.ok) { setLoadErr(loadError(res.status)); return; }
    setLoadErr("");
    setProviders(res.data.providers);
    setCfg(res.data.config);
    setProvider(res.data.config.provider ?? "");
    setSenderNumber(res.data.config.senderNumber);
    setUsername(res.data.config.username ?? "");
    setApiKey(""); setPassword("");
    const p: Record<string, PatternDraft> = {};
    for (const t of TYPES) p[t.key] = res.data.config.patterns[t.key] ?? { patternCode: "" };
    setPatterns(p);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function toggleEnabled(next: boolean) {
    setSaving(true); setMsg(null);
    const res = await postJson("/api/settings/sms", { tenantId: ctx.tenantId, enabled: next }, "PATCH");
    if (res.ok) { setMsg({ kind: "ok", text: next ? "پنلِ پیامکی فعال شد." : "پنلِ پیامکی غیرفعال شد." }); await load(ctx.tenantId); }
    else setMsg({ kind: "err", text: actionError(res.status) });
    setSaving(false);
  }

  async function save() {
    if (!provider) { setMsg({ kind: "err", text: "یک پنلِ پیامکی انتخاب کن." }); return; }
    setSaving(true); setMsg(null);
    const res = await postJson("/api/settings/sms", {
      tenantId: ctx.tenantId, provider, senderNumber,
      ...(username ? { username } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(password ? { password } : {}),
      patterns,
    }, "PATCH");
    if (res.ok) { setMsg({ kind: "ok", text: "ذخیره شد." }); await load(ctx.tenantId); }
    else setMsg({ kind: "err", text: actionError(res.status) });
    setSaving(false);
  }

  if (loadErr) return <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>;
  if (!cfg) return <p className="muted"><span className="spinner" /> در حال بارگذاری…</p>;

  const meta = providers.find((p) => p.id === provider);
  const savedMeta = providers.find((p) => p.id === cfg.provider);

  return (
    <>
      <MessageBanner msg={msg} />

      <h2>پنلِ پیامکی</h2>
      <div className="card">
        <label className="row row--start" style={{ gap: "var(--sp-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={cfg.enabled} disabled={saving || !cfg.provider}
            onChange={(e) => toggleEnabled(e.target.checked)} />
          فعال
        </label>
        <p className="muted" style={{ marginTop: "var(--sp-2)" }}>
          {savedMeta
            ? `وقتی خاموش است، هیچ درخواستی به ${savedMeta.label} زده نمی‌شود — نه کندی، نه مزاحمت.`
            : "اول یک پنلِ پیامکی را کانفیگ و ذخیره کن، بعد می‌توانی فعالش کنی."}
        </p>
      </div>

      <h2>انتخابِ پنلِ پیامکی</h2>
      <div className="card">
        <label htmlFor="sms-provider">انتخابِ پنلِ پیامکی</label>
        <select id="sms-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">— انتخاب کن —</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        {meta?.fields.includes("username") && (
          <>
            <label htmlFor="sms-username" style={{ marginTop: "var(--sp-3)" }}>نامِ کاربری</label>
            <input id="sms-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </>
        )}
        {meta?.fields.includes("apiKey") && (
          <>
            <label htmlFor="sms-apikey" style={{ marginTop: "var(--sp-3)" }}>
              کلیدِ API {cfg.apiKeyMasked && <span className="subtle">(فعلی: {cfg.apiKeyMasked})</span>}
            </label>
            <input id="sms-apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg.apiKeyMasked ? "برای تغییر، کلیدِ تازه وارد کن" : ""} />
          </>
        )}
        {meta?.fields.includes("password") && (
          <>
            <label htmlFor="sms-password" style={{ marginTop: "var(--sp-3)" }}>
              رمزِ عبور {cfg.passwordMasked && <span className="subtle">(فعلی: {cfg.passwordMasked})</span>}
            </label>
            <input id="sms-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={cfg.passwordMasked ? "برای تغییر، رمزِ تازه وارد کن" : ""} />
          </>
        )}
        {meta && (
          <>
            <label htmlFor="sms-sender" style={{ marginTop: "var(--sp-3)" }}>شماره‌ی ارسال‌کننده</label>
            <input id="sms-sender" value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} />
          </>
        )}
      </div>

      {meta && (
        <>
          <h2>پترن‌ها</h2>
          <p className="muted">
            برای هر بخش، کدِ پترنی که در {meta.label} ساخته‌ای را بگذار — تا فعال بشود، همان پترن با متنش استفاده می‌شود.
            خالی بماند یعنی برای آن بخش با پیامکِ متنیِ ساده ارسال می‌شود.
          </p>
          {TYPES.map((t) => (
            <div className="card" key={t.key}>
              <strong>{t.label}</strong>
              <label htmlFor={`pattern-${t.key}`} style={{ marginTop: "var(--sp-2)" }}>کدِ پترن</label>
              <input id={`pattern-${t.key}`} value={patterns[t.key]?.patternCode ?? ""}
                onChange={(e) => setPatterns((s) => ({ ...s, [t.key]: { ...s[t.key], patternCode: e.target.value } }))} />
              {meta.needsParamNames && (
                <>
                  <label htmlFor={`params-${t.key}`} style={{ marginTop: "var(--sp-2)" }}>
                    نامِ پارامترها در {meta.label} (به همین ترتیب، با کاما جدا)
                  </label>
                  <input id={`params-${t.key}`} value={patterns[t.key]?.paramNames ?? ""}
                    onChange={(e) => setPatterns((s) => ({ ...s, [t.key]: { ...s[t.key], paramNames: e.target.value } }))} />
                </>
              )}
              <div className="subtle" style={{ marginTop: "var(--sp-2)" }}>ترتیبِ مقادیر: {t.tokens}</div>
            </div>
          ))}
        </>
      )}

      {meta && (
        <button className="primary" onClick={save} aria-busy={saving} disabled={saving}>
          {saving && <span className="spinner" aria-hidden="true" />}ذخیره
        </button>
      )}
    </>
  );
}
