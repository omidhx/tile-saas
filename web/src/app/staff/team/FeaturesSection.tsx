"use client";
import { useEffect, useState } from "react";
import { postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { useFeatures } from "@/lib/useFeatures";
import { FEATURE_INFO, type FeatureKey, type Features } from "@/lib/features";
import MessageBanner from "../../MessageBanner";

/** امکاناتِ اختیاریِ کارخانه: هرچه خاموش است، از پنل و از دیدِ نماینده می‌رود. */
export default function FeaturesSection({ ctx }: { ctx: Ctx }) {
  const { features: initial, loaded } = useFeatures(ctx.tenantId);
  const [features, setFeatures] = useState<Features>(initial);
  const [pending, setPending] = useState<FeatureKey | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => { if (loaded) setFeatures(initial); }, [initial, loaded]);

  async function toggle(key: FeatureKey, on: boolean) {
    setPending(key); setMsg("");
    const res = await postJson("/api/settings/features", { tenantId: ctx.tenantId, changes: { [key]: on } }, "PUT");
    setPending(null);
    if (!res.ok) { setMsg(actionError(res.status)); return; }
    setFeatures((res.data as { features: Features }).features);
    setMsg("ذخیره شد. برای دیدنِ تغییر در منوها صفحه را تازه کنید.");
  }

  return (
    <>
      <h2>امکانات</h2>
      <MessageBanner msg={msg} />
      <div className="card">
        {FEATURE_INFO.map((f) => {
          const blocked = !!f.needsPricing && !features.pricing;
          return (
            <label key={f.key} className="row row--start"
              style={{ gap: "var(--sp-2)", justifyContent: "flex-start", cursor: blocked ? "not-allowed" : "pointer", marginBottom: "var(--sp-3)", alignItems: "flex-start" }}>
              <input type="checkbox" checked={features[f.key]} disabled={!loaded || blocked || pending !== null}
                onChange={(e) => toggle(f.key, e.target.checked)} style={{ width: "auto", minHeight: 0, marginTop: 4 }} />
              <span>
                <strong>{f.label}</strong>
                <div className="subtle">{f.hint}</div>
              </span>
            </label>
          );
        })}
      </div>
    </>
  );
}
