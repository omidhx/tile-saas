import type { TransactionSql } from "postgres";
import { withTenant } from "./client";
import { writeAudit } from "./audit";
import { normalizeFeatures, type Features, type FeatureKey } from "@/lib/features";

/** امکاناتِ این کارخانه، داخلِ تراکنشِ فراخوان (موتورِ قیمت و تأییدِ خودکار از این می‌خوانند). */
export async function featuresIn(tx: TransactionSql, tenantId: string): Promise<Features> {
  const [row] = await tx<{ features: unknown }[]>`SELECT features FROM tenant WHERE id = ${tenantId}`;
  return normalizeFeatures(row?.features);
}

export async function getFeatures(tenantId: string): Promise<Features> {
  return withTenant(tenantId, (tx) => featuresIn(tx, tenantId));
}

/** فقط کلیدهای داده‌شده عوض می‌شوند؛ مقدارِ خامِ بقیه دست نمی‌خورد. با ردپا در دفترِ تغییرات. */
export async function setFeatures(p: {
  tenantId: string; actorUserId: string; changes: Partial<Record<FeatureKey, boolean>>;
}): Promise<Features> {
  return withTenant(p.tenantId, async (tx) => {
    const [row] = await tx<{ features: Record<string, unknown> | null }[]>`
      SELECT features FROM tenant WHERE id = ${p.tenantId} FOR UPDATE`;
    const before = row?.features ?? {};
    const next = { ...before, ...p.changes };
    await tx`UPDATE tenant SET features = ${tx.json(next as never)} WHERE id = ${p.tenantId}`;
    await writeAudit(tx, {
      tenantId: p.tenantId, actorUserId: p.actorUserId, action: "tenant_features.edit",
      entity: "tenant", entityId: p.tenantId,
      oldValue: normalizeFeatures(before), newValue: normalizeFeatures(next),
    });
    return normalizeFeatures(next);
  });
}
