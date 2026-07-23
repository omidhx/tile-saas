import Icon from "./Icon";

const ERR_HINTS = ["نشد", "نداری", "منقضی", "نامعتبر"];

/**
 * بنرِ پیامِ موفقیت/خطا با تشخیصِ خودکار از رویِ متن.
 *
 * جایِ چهار پیاده‌سازیِ تکراری از همین منطق را می‌گیرد (customers، incoming،
 * substitutes، auto-approve) — و مهم‌تر: جلوی تکرارِ باگِ staff/incoming را
 * می‌گیرد، جایی که msg همیشه با banner--ok (سبز) رندر می‌شد، یعنی «اجازه‌ی
 * این کار را نداری» هم با تیکِ سبز دیده می‌شد.
 */
export default function MessageBanner({ msg }: { msg: string }) {
  if (!msg) return null;
  const isErr = ERR_HINTS.some((h) => msg.includes(h));
  return (
    <div className={`banner banner--${isErr ? "error" : "ok"}`} role="status">
      <Icon name={isErr ? "alert" : "check"} /><span>{msg}</span>
    </div>
  );
}
