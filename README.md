# Tile SaaS

سیستم چندمستأجری موجودی، رزرو و درخواست سفارش برای کارخانه‌های کاشی و سرامیک ایران.
هدف: کم کردن تماس نماینده با مسئول فروش.

زنجیره‌ی اصلی: مشاهده‌ی موجودی ← رزرو ← SalesRequest ← تأیید ← SalesDispatch ← بارگیری.

| کجا | چه چیزی |
|---|---|
| [`docs/PHASES.md`](docs/PHASES.md) | وضعیت پروژه و کارهای مانده |
| [`CLAUDE.md`](CLAUDE.md) | قواعد غیرقابل‌نقض معماری و دستورهای توسعه |
| [`docs/GO_LIVE.md`](docs/GO_LIVE.md) | تنها مسیر نصب، بکاپ، بازیابی و ارتقا |
| [`tile-saas-comprehensive-spec.md`](tile-saas-comprehensive-spec.md) | مرجع کامل و استدلال تصمیم‌ها |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)، [`docs/SECURITY.md`](docs/SECURITY.md)، [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | معماری، امنیت و مدل داده |

## توسعه

```bash
cd web
npm ci
npm run dev
npm test        # با نقش محدود app_user، روی کلاستر جدا؛ دستور ساختش در web/.env.test
npm run lint
```

## تست نصب کامل با Docker

```bash
bash scripts/docker-smoke.sh
```
