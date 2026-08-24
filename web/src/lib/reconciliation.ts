// =============================================================================
// web/src/lib/reconciliation.ts — Inventory Reconciliation Service (P2)
// =============================================================================
// Read-only, idempotent service that cross-verifies inventory consistency.
//
// Computes:
//   expected_held = SUM(reservation_item.quantity_boxes) WHERE reservation.status='active'
//   expected_allocated = inventory_balance.allocated_qty_boxes
//   calculated_available = on_hand - expected_held - expected_allocated - blocked
//
// Invariant: on_hand >= (expected_held + expected_allocated + blocked)
//
// Output: structured report with CLEAN / WARNING / CRITICAL statuses.
// Never auto-repairs — discrepancies are logged to audit_log for admin review.
// =============================================================================

import { sql } from "@/db/client";

export type DiscrepancyLevel = "CLEAN" | "WARNING" | "CRITICAL";

export type LotDiscrepancy = {
  lot_id: string;
  tenant_id: string;
  lot_number: string | null;
  on_hand: number;
  expected_held: number;
  expected_allocated: number;
  blocked: number;
  calculated_available: number;
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
};

/**
 * Run inventory reconciliation for a specific tenant or all tenants.
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
  const rows = await sql<{
    lot_id: string;
    tenant_id: string;
    lot_number: string | null;
    on_hand: number;
    expected_held: number;
    expected_allocated: number;
    blocked: number;
  }[]>`
    SELECT
      ib.lot_id,
      ib.tenant_id,
      il.lot_number,
      ib.on_hand_qty_boxes    AS on_hand,
      ib.allocated_qty_boxes   AS expected_allocated,
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
      ) AS expected_held
    FROM inventory_balance ib
    JOIN inventory_lot il ON il.id = ib.lot_id AND il.tenant_id = ib.tenant_id
    WHERE 1=1 ${tenantFilter}
    ORDER BY ib.tenant_id, ib.lot_id
  `;

  const discrepancies: LotDiscrepancy[] = [];
  let clean = 0;
  let warnings = 0;
  let critical = 0;

  for (const row of rows) {
    const calculated_available =
      row.on_hand - row.expected_held - row.expected_allocated - row.blocked;

    // Invariant: on_hand >= (held + allocated + blocked)
    const total_committed = row.expected_held + row.expected_allocated + row.blocked;
    const invariant_ok = row.on_hand >= total_committed;

    let level: DiscrepancyLevel = "CLEAN";
    let message = "All invariants hold";

    if (!invariant_ok) {
      level = "CRITICAL";
      message = `INVARIANT VIOLATION: on_hand (${row.on_hand}) < held (${row.expected_held}) + allocated (${row.expected_allocated}) + blocked (${row.blocked}) = ${total_committed}`;
      critical++;
    } else if (calculated_available < 0) {
      level = "CRITICAL";
      message = `NEGATIVE AVAILABLE: calculated_available = ${calculated_available}`;
      critical++;
    } else if (row.expected_held < 0 || row.expected_allocated < 0 || row.blocked < 0) {
      level = "WARNING";
      message = `NEGATIVE COMPONENT: held=${row.expected_held}, allocated=${row.expected_allocated}, blocked=${row.blocked}`;
      warnings++;
    } else {
      clean++;
    }

    discrepancies.push({
      lot_id: row.lot_id,
      tenant_id: row.tenant_id,
      lot_number: row.lot_number,
      on_hand: row.on_hand,
      expected_held: Number(row.expected_held),
      expected_allocated: row.expected_allocated,
      blocked: row.blocked,
      calculated_available,
      invariant_ok,
      level,
      message,
    });
  }

  // Log CRITICAL discrepancies to audit_log (system actor)
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
            ${JSON.stringify({ on_hand: d.on_hand, held: d.expected_held, allocated: d.expected_allocated })}::jsonb,
            ${JSON.stringify({ message: d.message, calculated_available: d.calculated_available })}::jsonb
          )`;
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
  };
}
