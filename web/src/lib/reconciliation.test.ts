// =============================================================================
// web/src/lib/reconciliation.test.ts — Tests for inventory reconciliation (P2)
// =============================================================================
// These tests verify the reconciliation service against known scenarios:
//   1. Clean state (no discrepancies)
//   2. Orphaned reservation drift (held mismatch)
//   3. Over-allocated balance (invariant violation)
//   4. Blocked mismatch
//
// Note: These tests require PostgreSQL 16 with the project schema loaded.
// They use the same _testdb.ts resetSchema pattern as other DB tests.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { resetSchema, sql } from "../db/_testdb";
import { reconcileInventory } from "./reconciliation";

// Test fixtures — shared across scenarios
const T1 = "00000000-0000-0000-0000-000000000001"; // tenant 1
const T2 = "00000000-0000-0000-0000-000000000002"; // tenant 2
const W1 = "00000000-0000-0000-0000-0000000000a1"; // warehouse
const L1 = "00000000-0000-0000-0000-0000000000b1"; // lot 1
const L2 = "00000000-0000-0000-0000-0000000000b2"; // lot 2
const P1 = "00000000-0000-0000-0000-0000000000c1"; // product 1
const PV1 = "00000000-0000-0000-0000-0000000000d1"; // variant 1
const AG1 = "00000000-0000-0000-0000-0000000000e1"; // agent 1
const U1 = "00000000-0000-0000-0000-0000000000f1"; // user 1

async function seedBaseData() {
  // Create tenants
  await sql`INSERT INTO tenant (id, name, slug) VALUES
    (${T1}, 'Tenant One', 'tenant-one'),
    (${T2}, 'Tenant Two', 'tenant-two')`;

  // Create warehouse
  await sql`INSERT INTO warehouse (id, tenant_id, name) VALUES (${W1}, ${T1}, 'Warehouse 1')`;

  // Create product + variant
  await sql`INSERT INTO product (id, tenant_id, name, code) VALUES (${P1}, ${T1}, 'Product 1', 'P001')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, grade, sku) VALUES (${PV1}, ${T1}, ${P1}, 'one', 'SKU001')`;

  // Create inventory lot with balance
  await sql`INSERT INTO inventory_lot (id, tenant_id, lot_number, product_variant_id, warehouse_id, on_hand_qty_boxes)
    VALUES (${L1}, ${T1}, 'LOT001', ${PV1}, ${W1}, 100)`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes)
    VALUES (${T1}, ${L1}, 100, 0, 0)`;

  // Create agent + user
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES (${U1}, '09999999999', 'hash')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES (${AG1}, ${T1}, 'Agent 1', 'A001')`;
  await sql`INSERT INTO tenant_membership (tenant_id, user_id, role) VALUES (${T1}, ${U1}, 'agent')`;
  await sql`INSERT INTO agent_account_user (tenant_id, agent_account_id, user_id) VALUES (${T1}, ${AG1}, ${U1})`;
}

test("reconciliation: clean state — all invariants hold", async () => {
  await resetSchema();
  await seedBaseData();

  const report = await reconcileInventory(T1);

  assert.equal(report.total_lots, 1);
  assert.equal(report.clean, 1);
  assert.equal(report.warnings, 0);
  assert.equal(report.critical, 0);
  assert.equal(report.discrepancies[0].level, "CLEAN");
  assert.equal(report.discrepancies[0].on_hand, 100);
  assert.equal(report.discrepancies[0].expected_held, 0);
  assert.equal(report.discrepancies[0].expected_allocated, 0);
  assert.equal(report.discrepancies[0].calculated_available, 100);
  assert.equal(report.discrepancies[0].invariant_ok, true);
});

test("reconciliation: active reservation — held computed correctly", async () => {
  await resetSchema();
  await seedBaseData();

  // Create an active reservation for 30 boxes
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO reservation (id, tenant_id, agent_account_id, status, expires_at, idempotency_key)
    VALUES ('11111111-0000-0000-0000-000000000001', ${T1}, ${AG1}, 'active', ${expiresAt}, 'test-key-1')`;
  await sql`
    INSERT INTO reservation_item (tenant_id, reservation_id, lot_id, quantity_boxes)
    VALUES (${T1}, '11111111-0000-0000-0000-000000000001', ${L1}, 30)`;

  const report = await reconcileInventory(T1);

  assert.equal(report.clean, 1);
  assert.equal(report.critical, 0);
  assert.equal(report.discrepancies[0].expected_held, 30);
  assert.equal(report.discrepancies[0].calculated_available, 70); // 100 - 30 - 0 - 0
  assert.equal(report.discrepancies[0].invariant_ok, true);
});

test("reconciliation: over-allocated balance — CRITICAL invariant violation", async () => {
  await resetSchema();
  await seedBaseData();

  // Manually set allocated higher than on_hand (simulates a bug or manual corruption)
  await sql`
    UPDATE inventory_balance
    SET allocated_qty_boxes = 150
    WHERE tenant_id = ${T1} AND lot_id = ${L1}`;

  const report = await reconcileInventory(T1);

  assert.equal(report.critical, 1);
  assert.equal(report.clean, 0);

  const d = report.discrepancies[0];
  assert.equal(d.level, "CRITICAL");
  assert.equal(d.invariant_ok, false); // 100 < 0 + 150 + 0 = 150
  assert.ok(d.message.includes("INVARIANT VIOLATION"));
});

test("reconciliation: negative calculated_available — CRITICAL", async () => {
  await resetSchema();
  await seedBaseData();

  // Set blocked to make available negative (but invariant might still hold if held is 0)
  // Actually invariant is: on_hand >= held + allocated + blocked
  // If allocated=80, blocked=30, held=0: on_hand(100) >= 110 → FAIL → CRITICAL
  await sql`
    UPDATE inventory_balance
    SET allocated_qty_boxes = 80, blocked_qty_boxes = 30
    WHERE tenant_id = ${T1} AND lot_id = ${L1}`;

  const report = await reconcileInventory(T1);

  assert.equal(report.critical, 1);

  const d = report.discrepancies[0];
  assert.equal(d.level, "CRITICAL");
  assert.equal(d.invariant_ok, false); // 100 < 0 + 80 + 30 = 110
});

test("reconciliation: multi-tenant isolation — only checks specified tenant", async () => {
  await resetSchema();
  await seedBaseData();

  // Add a second tenant's lot
  await sql`INSERT INTO warehouse (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-0000000000a2', ${T2}, 'WH2')`;
  await sql`INSERT INTO product (id, tenant_id, name, code) VALUES ('00000000-0000-0000-0000-0000000000c2', ${T2}, 'P2', 'P002')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, grade, sku) VALUES ('00000000-0000-0000-0000-0000000000d2', ${T2}, '00000000-0000-0000-0000-0000000000c2', 'two', 'SKU002')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, lot_number, product_variant_id, warehouse_id, on_hand_qty_boxes)
    VALUES (${L2}, ${T2}, 'LOT002', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 50)`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes)
    VALUES (${T2}, ${L2}, 50, 0, 0)`;

  // Check only tenant 1
  const report = await reconcileInventory(T1);
  assert.equal(report.total_lots, 1); // Only T1's lot
  assert.equal(report.clean, 1);

  // Check all tenants
  const allReport = await reconcileInventory();
  assert.equal(allReport.total_lots, 2); // Both lots
  assert.equal(allReport.clean, 2);
});

test("reconciliation: audit_log entry for CRITICAL discrepancy", async () => {
  await resetSchema();
  await seedBaseData();

  // Create a critical discrepancy
  await sql`
    UPDATE inventory_balance
    SET allocated_qty_boxes = 200
    WHERE tenant_id = ${T1} AND lot_id = ${L1}`;

  await reconcileInventory(T1);

  // Verify audit_log entry was created
  const [auditEntry] = await sql<{ action: string; entity: string }[]>`
    SELECT action, entity FROM audit_log
    WHERE tenant_id = ${T1} AND action = 'inventory_reconciliation_critical'
    LIMIT 1`;

  assert.ok(auditEntry, "audit_log entry should exist for critical discrepancy");
  assert.equal(auditEntry.action, "inventory_reconciliation_critical");
  assert.equal(auditEntry.entity, "inventory_balance");
});
