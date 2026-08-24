// =============================================================================
// scripts/reconcile-inventory.ts — CLI for inventory reconciliation (P2)
// =============================================================================
// Usage:
//   DATABASE_URL=postgres://... node --import tsx scripts/reconcile-inventory.ts
//   DATABASE_URL=postgres://... node --import tsx scripts/reconcile-inventory.ts --tenant=UUID
//   DATABASE_URL=postgres://... node --import tsx scripts/reconcile-inventory.ts --json
//
// Output:
//   Human-readable summary (default) or JSON (--json flag)
// =============================================================================

import { reconcileInventory } from "../src/lib/reconciliation";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL تنظیم نشده.");
    process.exit(1);
  }

  // Parse args
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const tenantArg = args.find((a) => a.startsWith("--tenant="));
  const tenantId = tenantArg ? tenantArg.split("=")[1] : undefined;

  if (tenantId) {
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      console.error("--tenant must be a valid UUID");
      process.exit(1);
    }
  }

  console.log("═══════════ Inventory Reconciliation ═══════════");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Scope: ${tenantId ? `tenant ${tenantId}` : "all tenants"}`);
  console.log("");

  const report = await reconcileInventory(tenantId);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Total lots checked: ${report.total_lots}`);
  console.log(`✅ Clean:     ${report.clean}`);
  console.log(`⚠️  Warnings:  ${report.warnings}`);
  console.log(`❌ Critical:  ${report.critical}`);
  console.log("");

  if (report.critical > 0) {
    console.log("═══════════ Critical Discrepancies ═══════════");
    for (const d of report.discrepancies.filter((x) => x.level === "CRITICAL")) {
      console.log(`  Lot ${d.lot_number ?? d.lot_id} (tenant ${d.tenant_id}):`);
      console.log(`    on_hand=${d.on_hand}, held=${d.expected_held}, allocated=${d.expected_allocated}, blocked=${d.blocked}`);
      console.log(`    calculated_available=${d.calculated_available}`);
      console.log(`    ${d.message}`);
      console.log("");
    }
  }

  if (report.warnings > 0) {
    console.log("═══════════ Warnings ═══════════");
    for (const d of report.discrepancies.filter((x) => x.level === "WARNING")) {
      console.log(`  Lot ${d.lot_number ?? d.lot_id} (tenant ${d.tenant_id}): ${d.message}`);
    }
    console.log("");
  }

  if (report.critical === 0 && report.warnings === 0) {
    console.log("✅ All inventory invariants hold — no discrepancies found.");
  } else {
    console.log("❌ Discrepancies found — see details above.");
    console.log("   Critical discrepancies have been logged to audit_log.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
