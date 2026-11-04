import Icon from "./Icon";

const ERR_HINTS = ["نشد", "نداری", "منقضی", "نامعتبر"];

export type Msg = string | { kind: "ok" | "err"; text: string } | null;

/**
 * بنرِ پیامِ موفقیت/خطا. دو شکلِ ورودی می‌گیرد:
 *   • رشته‌ی خام — نوع (ok/err) از رویِ متن حدس زده می‌شود (customers، incoming،
 *     substitutes، auto-approve قبلاً همین منطق را جدا پیاده کرده بودند؛ و مهم‌تر،
 *     جلوی تکرارِ باگِ staff/incoming را می‌گیرد که msg همیشه سبز رندر می‌شد،
 *     یعنی «اجازه‌ی این کار را نداری» هم با تیکِ سبز دیده می‌شد).
 *   • آبجکتِ {kind, text} — وقتی خودِ caller نوع را قطعی می‌داند (catalogs،
 *     reserve) و نیازی به حدس‌زدنِ کلیدواژه‌ای نیست.
 */
export default function MessageBanner({ msg }: { msg: Msg }) {
  if (!msg) return null;
  const { text, isErr } = typeof msg === "string"
    ? { text: msg, isErr: ERR_HINTS.some((h) => msg.includes(h)) }
    : { text: msg.text, isErr: msg.kind === "err" };
  return (
    <div className={`banner banner--${isErr ? "error" : "ok"}`} role="status">
      <Icon name={isErr ? "alert" : "check"} /><span>{text}</span>
    </div>
  );
}
