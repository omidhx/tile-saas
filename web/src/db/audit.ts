import type { TransactionSql } from "postgres";
import { withTenant } from "./client";

/**
 * دفترِ تغییراتِ **قواعدِ پولی + مشخصاتِ Entityها**.
 *
 * دامنه عمداً باریک است. بیشترِ کارهای سیستم از قبل ردپا دارند:
 *   • حرکتِ موجودی      → `inventory_transaction` (با گزارشِ تطبیق)
 *   • چرا سفارش تأیید شد → `sales_request.approval_mode` + `auto_approve_limit_applied`
 *   • ورودِ اکسل         → `import_batch` / `import_row`
 *
 * چیزی که **هیچ‌جا** ثبت نمی‌شد، تغییرِ خودِ قواعد یا مشخصاتِ کالا/مشتری بود:
 *   • قیمت — کسی قیمت را از ۸٫۵ میلیون به ۸۵۰ هزار می‌آورد، نماینده سفارش می‌داد،
 *     و هیچ‌کس نمی‌فهمید چه کسی عوضش کرده. snapshotِ قیمت سفارشِ ثبت‌شده را حفظ
 *     می‌کند ولی خودِ تغییر نامرئی بود.
 *   • سقفِ تأییدِ خودکار — کنترلی که اجازه می‌دهد پول **بدونِ نگاهِ انسان** متعهد
 *     شود. بالابردنش بدونِ ردپا یعنی کسی می‌تواند سقف را بردارد، سفارشِ بزرگ
 *     خودکار تأیید شود، و سقف را برگرداند.
 *   • ویرایشِ محصول/مشتری — رنگ، لعاب، بسته‌بندی، شماره‌تماس و… . snapshotِ حواله
 *     مقدارِ لحظه‌ی ثبت را حفظ می‌کند، ولی خودِ ویرایش (چه کسی، چه زمانی) جایی
 *     ثبت نمی‌شد.
 *
 * پس این‌جا «همه‌چیز» لاگ نمی‌شود — فقط چیزی که در نبودش سؤالِ «چه کسی؟» جواب ندارد.
 *
 * همیشه `tx` می‌گیرد: ردپا باید در **همان تراکنشِ** تغییر نوشته شود، وگرنه تغییرِ
 * موفق با ردپای گم‌شده ممکن می‌شود — یعنی دقیقاً همان حالتی که این جدول برای
 * جلوگیری‌اش هست.
 */

/** هرچه JSON بپذیرد. عمداً `unknown` نیست تا با تایپِ `tx.json` بخواند. */
export type AuditValue = string | number | boolean | null | { [k: string]: AuditValue } | AuditValue[];

export type AuditAction =
  | "price.set"
  | "auto_approve_limit.tenant"
  | "auto_approve_limit.agent"
  | "product.edit"
  | "customer.edit";

export async function writeAudit(
  tx: TransactionSql,
  p: {
    tenantId: string;
    actorUserId: string;
    action: AuditAction;
    entity: string;
    entityId: string | null;
    /** مقدارِ قابلِ‌سریال‌سازی. عدد/null برای مبالغ، object برای تغییرهای مرکب. */
    oldValue: AuditValue;
    newValue: AuditValue;
  },
) {
  // `tx.json(...)` و نه `${JSON.stringify(x)}::jsonb`: با دیدنِ کستِ jsonb، خودِ
  // postgres.js مقدار را هم JSON می‌کند، پس رشته‌ی از قبل stringify‌شده **دوبار**
  // encode می‌شود و در دیتابیس یک jsonb از نوعِ `string` می‌نشیند نه number/object.
  // نتیجه‌اش این بود که ۸۵۰۰۰۰۰ به‌صورت "8500000" برمی‌گشت.
  await tx`
    INSERT INTO audit_log (tenant_id, actor_user_id, action, entity, entity_id, old_value, new_value)
    VALUES (${p.tenantId}, ${p.actorUserId}, ${p.action}, ${p.entity}, ${p.entityId},
            ${tx.json(p.oldValue ?? null)}, ${tx.json(p.newValue ?? null)})`;
}

export type AuditRow = {
  id: string; action: string; entity: string; entityId: string | null;
  oldValue: unknown; newValue: unknown; createdAt: string;
  actorPhone: string | null;
  /** نامِ خوانا برای موجودیت (کالا یا نمایندگی) — تا صفحه فقط UUID نشان ندهد. */
  label: string | null;
};

/** آخرین تغییرات، تازه‌ترین اول، صفحه‌بندی‌شده + جستجو (نامِ کالا/نمایندگی/شماره‌ی عامل). */
export async function listAudit(p: {
  tenantId: string; q?: string; limit?: number; offset?: number;
}): Promise<{ items: AuditRow[]; hasMore: boolean }> {
  const limit = p.limit ?? 100, offset = p.offset ?? 0, q = p.q?.trim();
  const rows = await withTenant(p.tenantId, (tx) => tx<AuditRow[]>`
    SELECT a.id, a.action, a.entity, a.entity_id AS "entityId",
           a.old_value AS "oldValue", a.new_value AS "newValue",
           a.created_at AS "createdAt", u.phone AS "actorPhone",
           COALESCE(p.name, aa.legal_name, t.name, prod.name, cust.name) AS label
    FROM audit_log a
    LEFT JOIN app_user u        ON u.id = a.actor_user_id
    -- برچسبِ خوانا: بسته به entity ممکن است کالا، نمایندگی، مشتری یا خودِ کارخانه باشد
    LEFT JOIN product_variant pv ON pv.id = a.entity_id AND a.entity = 'price_list_item'
    LEFT JOIN product p          ON p.id = pv.product_id
    LEFT JOIN agent_account aa   ON aa.id = a.entity_id AND a.entity = 'agent_account'
    LEFT JOIN tenant t           ON t.id = a.entity_id AND a.entity = 'tenant'
    LEFT JOIN product prod       ON prod.id = a.entity_id AND a.entity = 'product'
    LEFT JOIN customer cust      ON cust.id = a.entity_id AND a.entity = 'customer'
    WHERE a.tenant_id = ${p.tenantId}
      AND ${q ? tx`(p.name ILIKE ${"%" + q + "%"} OR aa.legal_name ILIKE ${"%" + q + "%"} OR t.name ILIKE ${"%" + q + "%"} OR prod.name ILIKE ${"%" + q + "%"} OR cust.name ILIKE ${"%" + q + "%"} OR u.phone ILIKE ${"%" + q + "%"})` : tx`TRUE`}
    ORDER BY a.created_at DESC
    LIMIT ${limit + 1} OFFSET ${offset}`);
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
