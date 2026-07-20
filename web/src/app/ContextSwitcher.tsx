"use client";
import type { Ctx } from "@/lib/useContexts";

/**
 * سوییچرِ نمایندگی/کارخانه.
 * وقتی فقط یک context هست چیزی رندر نمی‌کند — اکثر کاربران یک نمایندگی دارند و
 * یک select تک‌گزینه‌ای فقط نویز است (ui-ux-pro-max: visual-hierarchy).
 */
export default function ContextSwitcher({
  contexts, ctx, onSelect, mode,
}: {
  contexts: Ctx[]; ctx: Ctx; onSelect: (c: Ctx) => void; mode: "agent" | "staff";
}) {
  if (contexts.length < 2) return null;

  const label = (c: Ctx) =>
    mode === "agent" ? `${c.agentLegalName} — ${c.tenantName}` : c.tenantName;
  const keyOf = (c: Ctx) => `${c.tenantId}|${c.agentAccountId ?? ""}`;

  return (
    <label style={{ margin: 0 }}>
      <span className="muted">{mode === "agent" ? "نمایندگی:" : "کارخانه:"}</span>{" "}
      <select
        aria-label={mode === "agent" ? "انتخاب نمایندگی" : "انتخاب کارخانه"}
        value={keyOf(ctx)}
        onChange={(e) => {
          const next = contexts.find((c) => keyOf(c) === e.target.value);
          if (next) onSelect(next);
        }}
        style={{ padding: ".4rem .6rem", borderRadius: 8, border: "1px solid var(--line)", maxWidth: 260 }}
      >
        {contexts.map((c) => (
          <option key={keyOf(c)} value={keyOf(c)}>{label(c)}</option>
        ))}
      </select>
    </label>
  );
}
