// =============================================================================
// web/src/lib/reconciliation.ts — Inventory Reconciliation Service (P2)
// =============================================================================
// Read-only service that cross-verifies inventory consistency.
//
// Naming convention (semantic audit Phase C):
//   computed_held      = SUM(reservation_item.quantity_boxes) WHERE reservation.status='active'
//                        (computed from source of truth — reservation_item + reservation)
//   stored_allocated   = inventory_balance.allocated_qty_boxes
//                        (stored column — cannot be independently verified without ledger
//                         replay; labeled "stored" not "expected" to avoid implying
//                         independent verification)
//   computed_available = on_hand - computed_held - stored_allocated - blocked
//
// Invariant: on_hand >= (computed_held + stored_allocated + blocked)
//
// Side effect: CRITICAL discrepancies are logged to audit_log.
//   This is an explicit, documented side effect — reconciliation is read-only
//   on inventory tables but writes to audit_log for discrepancy tracking.
//   No auto-repair is ever performed.
//
// Limitation: stored_allocated cannot be independently recomputed from the
//   ledger without full transaction replay. If ledger drift is suspected,
//   a separate ledger-vs-balance reconciliation should be run.
// =============================================================================

import { sql } from "@/db/client";

export type DiscrepancyLevel = "CLEAN" | "WARNING" | "CRITICAL";

export type LotDiscrepancy = {
  lot_id: string;
  tenant_id: string;
  lot_number: string | null;
  on_hand: number;
  computed_held: number;
  stored_allocated: number;
  blocked: number;
  computed_available: number;
  invariant_ok: boolean;
  level: DiscrepancyLevel;
  message: string;
};

export type ReconciliationReport = {
  checked_at: string;
  tenant_id: string | null; // null = all tenants
  total_lots: number;
  clean: number;
  warnings: number;
  critical: number;
  discrepancies: LotDiscrepancy[];
  // Documented side effect
  audit_entries_inserted: number;
};

/**
 * Run inventory reconciliation for a specific tenant or all tenants.
 *
 * This function is read-only on inventory tables (SELECT only).
 * Side effect: CRITICAL discrepancies are logged to audit_log.
 * No auto-repair is ever performed.
 *
 * @param tenantId - If provided, only check this tenant's lots. If null, check all.
 * @returns ReconciliationReport with per-lot discrepancy details.
 */
export async function reconcileInventory(
  tenantId?: string,
): Promise<ReconciliationReport> {
  const tenantFilter = tenantId
    ? sql`AND ib.tenant_id = ${tenantId}`
    : sql``;

  // Query all lots with their computed vs stored values
  // computed_held is derived from the same source of truth as reservations.ts:
  //   SUM(reservation_item.quantity_boxes) WHERE reservation.status='active' AND expires_at > now()
  // stored_allocated is read directly from inventory_balance (stored column)
  const rows = await sql<{
    lot_id: string;
    tenant_id: string;
    lot_number: string | null;
    on_hand: number;
    computed_held: number;
    stored_allocated: number;
    blocked: number;
  }[]>`
    SELECT
      ib.lot_id,
      ib.tenant_id,
      il.lot_number,
      ib.on_hand_qty_boxes    AS on_hand,
      ib.allocated_qty_boxes   AS stored_allocated,
      ib.blocked_qty_boxes     AS blocked,
      COALESCE(
        (SELECT SUM(ri.quantity_boxes)
         FROM reservation_item ri
         JOIN reservation r ON r.id = ri.reservation_id
         WHERE ri.lot_id = ib.lot_id
           AND r.tenant_id = ib.tenant_id
           AND r.status = 'active'
           AND r.expires_at > now()),
        0
      ) AS computed_held
    FROM inventory_balance ib
    JOIN inventory_lot il ON il.id = ib.lot_id AND il.tenant_id = ib.tenant_id
    WHERE 1=1 ${tenantFilter}
    ORDER BY ib.tenant_id, ib.lot_id
  `;

  const discrepancies: LotDiscrepancy[] = [];
  let clean = 0;
  let warnings = 0;
  let critical = 0;
  let auditEntries = 0;

  for (const row of rows) {
    const computed_available =
      row.on_hand - row.computed_held - row.stored_allocated - row.blocked;

    // Invariant: on_hand >= (computed_held + stored_allocated + blocked)
    const total_committed = row.computed_held + row.stored_allocated + row.blocked;
    const invariant_ok = row.on_hand >= total_committed;

    let level: DiscrepancyLevel = "CLEAN";
    let message = "All invariants hold";

    if (!invariant_ok) {
      level = "CRITICAL";
      message = `INVARIANT VIOLATION: on_hand (${row.on_hand}) < computed_held (${row.computed_held}) + stored_allocated (${row.stored_allocated}) + blocked (${row.blocked}) = ${total_committed}`;
      critical++;
    } else if (computed_available < 0) {
      level = "CRITICAL";
      message = `NEGATIVE computed_available = ${computed_available}`;
      critical++;
    } else if (row.computed_held < 0 || row.stored_allocated < 0 || row.blocked < 0) {
      level = "WARNING";
      message = `NEGATIVE COMPONENT: computed_held=${row.computed_held}, stored_allocated=${row.stored_allocated}, blocked=${row.blocked}`;
      warnings++;
    } else {
      clean++;
    }

    discrepancies.push({
      lot_id: row.lot_id,
      tenant_id: row.tenant_id,
      lot_number: row.lot_number,
      on_hand: row.on_hand,
      computed_held: Number(row.computed_held),
      stored_allocated: row.stored_allocated,
      blocked: row.blocked,
      computed_available,
      invariant_ok,
      level,
      message,
    });
  }

  // SIDE EFFECT: Log CRITICAL discrepancies to audit_log
  // This is the only write operation — documented and intentional.
  // No inventory data is modified. No auto-repair.
  const criticalDiscrepancies = discrepancies.filter((d) => d.level === "CRITICAL");
  if (criticalDiscrepancies.length > 0) {
    try {
      for (const d of criticalDiscrepancies) {
        await sql`
          INSERT INTO audit_log (tenant_id, action, entity, entity_id, old_value, new_value)
          VALUES (
            ${d.tenant_id},
            'inventory_reconciliation_critical',
            'inventory_balance',
            ${d.lot_id},
            ${JSON.stringify({ on_hand: d.on_hand, computed_held: d.computed_held, stored_allocated: d.stored_allocated })}::jsonb,
            ${JSON.stringify({ message: d.message, computed_available: d.computed_available })}::jsonb
          )`;
        auditEntries++;
      }
    } catch {
      // audit_log insert failure is non-fatal — reconciliation result is still returned
      console.error("[reconciliation] Failed to log critical discrepancies to audit_log");
    }
  }

  return {
    checked_at: new Date().toISOString(),
    tenant_id: tenantId ?? null,
    total_lots: rows.length,
    clean,
    warnings,
    critical,
    discrepancies,
    audit_entries_inserted: auditEntries,
  };
}
