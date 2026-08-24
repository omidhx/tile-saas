# Tile SaaS — برنامه جامع اصلاح و آمادگی Go-Live

> **نسخه:** ۱.۰
> **تاریخ:** ۲ شهریور ۱۴۰۵
> **مبنا:** `Engineering Manual & Comprehensive Architecture — Tile SaaS` (S1)
> **هدف:** تبدیل ادعاها و مرزهای معماری به یک برنامه اجرایی remediation با اولویت‌بندی، معیار پذیرش و شواهد قابل بازتولید.

---

## فهرست مطالب

1. [عنوان و هدف سند](#۱-عنوان-و-هدف-سند)
2. [ارزیابی اجرایی manual فعلی](#۲-ارزیابی-اجرایی-manual-فعلی)
3. [یافته‌های ممیزی عمیق بر اساس دسته‌بندی](#۳-یافته‌های-ممیزی-عمیق-بر-اساس-دسته‌بندی)
4. [باگ‌ها، ناسازگاری‌ها و ریسک‌های استنباط‌شده](#۴-باگها-ناسازگاریها-و-ریسکهای-استنباطشده)
5. [Backlog اولویت‌دار قابلیت‌ها و اصلاحات](#۵-backlog-اولویتدار-قابلیتها-و-اصلاحات)
6. [ترتیب پیاده‌سازی منطبق با لایه‌های معماری](#۶-ترتیب-پیادهسازی-منطبق-با-لایههای-معماری)
7. [فاز P0 — تثبیت صحت داده و مرز امنیتی](#۷-فاز-p0--تثبیت-صحت-داده-و-مرز-امنیتی)
8. [فاز P1 — تکمیل قرارداد API و امنیت عملیاتی](#۸-فاز-p1--تکمیل-قرارداد-api-و-امنیت-عملیاتی)
9. [فاز P2 — قابلیت اطمینان worker، backup و observability](#۹-فاز-p2--قابلیت-اطمینان-worker-backup-و-observability)
10. [فاز P3 — مقیاس‌پذیری، تجربه محصول و بلوغ تحویل](#۱۰-فاز-p3--مقیاسپذیری-تجربه-محصول-و-بلوغ-تحویل)
11. [دروازه پذیرش و معیار Go-Live](#۱۱-دروازه-پذیرش-و-معیار-go-live)
12. [ریسک عدم اجرا و منابع](#۱۲-ریسک-عدم-اجرا-و-منابع)

---

## ۱. عنوان و هدف سند

این سند، manual ارائه‌شده برای Tile SaaS را به یک برنامه اجرایی remediation تبدیل می‌کند:
نخست ادعاها و مرزهای معماری را ممیزی می‌کند، سپس شکاف‌ها و ریسک‌های قابل استنباط را
اولویت‌بندی می‌کند و در پایان، ترتیب پیاده‌سازی، معیار پذیرش و شواهد لازم برای Go-Live
را مشخص می‌سازد. دامنه سیستم، یک Vertical SaaS چندمستأجری برای کاتالوگ، موجودی، رزرو،
درخواست فروش، حواله و عملیات بارگیری نمایندگان کاشی و سرامیک است.

این برنامه فقط بر اساس متن manual و نکات ممیزی موجود در زمینه گفتگو نوشته شده است؛
بنابراین هر اشاره به مسیر فایل، نام migration یا ساختار دقیق repository که در manual
نام‌گذاری نشده باشد، «نمونه فرضی» تلقی می‌شود و نباید بدون تطبیق با repository اجرا شود.

### ۱.۱. روش استفاده

- هر فاز با یک دستور اجباری برای بازرسی فایل‌های واقعی پروژه پیش از هر تغییر آغاز می‌شود.
- وضعیت هر مورد باید به یکی از سه حالت `Present`، `Partial` یا `Missing` ثبت شود.
- تغییرات باید به‌صورت کوچک، قابل‌بررسی و ترجیحاً `forward-only` انجام شوند.
- هیچ ادعای «کامل شد» بدون تست `dashboard`، `log`، یا `restore evidence` معتبر پذیرفته نیست.
- مرجع کسب‌وکار و معماری، manual ارائه‌شده است؛ لینک‌های بیرونی فقط برای توضیح رفتار
  رسمی PostgreSQL در RLS استفاده شده‌اند.

---

## ۲. ارزیابی اجرایی manual فعلی

manual ارائه‌شده با عنوان *Engineering Manual & Comprehensive Architecture — Tile SaaS*
از نظر پوشش، بالاتر از یک سند CRUD معمولی است: جریان کامل → catalog → reservation →
sales request → dispatch → loading/delivery، state machine‌ها، RLS، idempotency،
`SELECT FOR UPDATE`، append-only inventory ledger، outbox، uploads خصوصی،
backup/restore و structured logging را در نظر گرفته است. این نقاط قوت نشان می‌دهد
مسئله اصلی کمبود ایده معماری نیست؛ مسئله، تبدیل ادعاهای معماری به invariant‌های
قابل‌آزمون و شواهد عملیاتی است.

ارزیابی فعلی: **کاندید Go-Live، اما نه آماده Go-Live نهایی.** بزرگ‌ترین ریسک در مرز
میان `Reservation`، `SalesRequest` و `SalesDispatch` است؛ به‌ویژه تعریف هم‌زمان
`held`، `allocated_qty_boxes` و `available`. پس از آن، صحت RLS در همه مسیرها،
رفتار SECURITY DEFINER، outbox واقعی، restore واقعی و rate limit چندنمونه‌ای قرار
می‌گیرند.

| حوزه | ارزیابی | تصمیم |
|---|---|---|
| مدل دامنه و workflow | خوب اما دارای مرزهای مبهم | P0 |
| tenant isolation/RLS | طراحی قوی، نیازمند تست و بازبینی SQL | P0 |
| امنیت وب و session | پوشش مناسب، شواهد ناکافی | P0/P1 |
| concurrency و idempotency | الگوی درست، نیازمند تست فشار | P0 |
| worker و outbox | معماری مناسب، semantics حداقل once | P1/P2 |
| backup/DR | تعریف شده، evidence ناقص و off-site مبهم | P0 |
| observability | پایه مناسب، alert و trace ناقص | P1/P2 |
| آمادگی Go-Live | حدودی، مشروط به شواهد | Gate |

بر اساس مستند رسمی PostgreSQL، فعال‌کردن RLS به‌تنهایی کافی نیست: policy باید دسترسی
را مجاز کند، owner معمولاً policy را دور می‌زند، و superuser یا role دارای BYPASSRLS
همیشه bypass دارد؛ `FORCE ROW LEVEL SECURITY` برای محدودکردن owner اهمیت دارد.
بنابراین عبارت «RLS فعال است» باید به مجموعه‌ای از privilege review، migration و
تست cross-tenant تبدیل شود.

---

## ۳. یافته‌های ممیزی عمیق بر اساس دسته‌بندی

معماری لایه‌ای (Next.js App Router، PostgreSQL، Caddy و worker) با جریان کسب‌وکار
مناسبی طراحی شده است؛ اما contract میان لایه‌ها کامل نیست. باید یک مرجع واحد برای
invariant‌های موجودی، transition‌های مجاز و مالکیت mutation تعریف شود. UI نباید
state را تعیین کند و route handler نباید منطق رزرو یا تأیید را به‌صورت موازی با
domain service بازنویسی کند.

### ۳.۱. معماری و مرزبندی دامنه

معماری لایه‌ای با جریان کسب‌وکار مناسب طراحی شده است؛ اما contract میان لایه‌ها
کامل نیست. باید یک مرجع واحد برای invariant‌های موجودی، transition‌های مجاز و
مالکیت mutation تعریف شود. UI نباید state را تعیین کند و route handler نباید منطق
رزرو یا تأیید را به‌صورت موازی با domain service بازنویسی کند.

### ۳.۲. Multi-tenant isolation و RLS

اجرای خودکار policy برای جدول‌های دارای tenant_id خطرناک است اگر schema-qualified
identifier، جدول‌های استثنا، migration تکرارپذیر و نقش‌های privileged صریحاً کنترل
نشنوند. policy باید برای SELECT، INSERT، UPDATE و DELETE آزمایش شود. همچنین tenant
انتخاب‌شده باید پس از استخراج user_id از session/JWT با membership کاربر تطبیق داده
شود؛ اعتماد به tenant از body یا query قابل قبول نیست. طبق مستند PostgreSQL، نبود
policy پس از enable شدن به default-deny می‌انجامد، اما owner و BYPASSRLS همچنان
نقطه حساس هستند.

### ۳.۳. Security، authentication و CSRF

وجود sanitization، HSTS، CSP nonce، CSRF هدر proxy و rate limit در manual ثابت
است؛ ولی trust chain باید به‌صورت تست‌شده مشخص شود. session epoch، تغییر tenant،
revoke، reset password، rotation رازها و رفتار replay باید مستند و آزموده شوند.
SECURITY DEFINER به search_path امن نیاز دارد، اما همچنین باید owner، REVOKE/GRANT
امن و authorization ورودی مستقل داشته باشد.

### ۳.۴. هم‌زمانی، idempotency و consistency موجودی

`SELECT FOR UPDATE` روی lot و request hash برای رزرو هم‌زمانی خوبی ایجاد می‌کند؛
بااین‌حال تعریف held باید یکتا شود. مدل پیشنهادی: held = مجموع رزروهای فعال،
allocated = مجموع تخصیص‌های تبدیل‌شده اما مصرف‌نشده، و
`available = on_hand - held - allocated - blocked`. اگر `allocated_qty_boxes`
projection رسمی است، دیگر نباید همان رزروها دوباره از reservation_item جمع شوند.
transition و اثر موجودی هر entity باید جدول رسمی داشته باشد.

### ۳.۵. Background workers و outbox

Outbox انتخاب درستی برای جداکردن commit تراکنش از ارسال notification است، اما
semantics آن در حالت crash، at-least-once است نه exactly-once. باید retry، provider
message id با backoff و jitter، dead-letter و کنترل duplicate delivery ثبت شود.
worker-expire نیز باید در برابر اجرای موازی و clock skew ایمن باشد.

### ۳.۶. Backup، restore و DR

وجود backup pipeline نقطه قوت است؛ اما restore drill و off-site نباید optional
بماند. آخرین backup موفق باید checksum، decrypt، restore database، uploads،
فضای دیسک و نتیجه واقعی pg_dump ثبت شود. migration recovery نباید به‌عنوان روند
عادی شامل حذف رکورد `_migrations` باشد؛ migrations باید immutable و forward-only
باشند.

### ۳.۷. Observability، logging و tracing

structured logging و redaction پایه خوبی هستند. request id بین web و worker توزیع‌شده
است: کمبودهای مهم عبارتند از: correlation پایدار، worker access policy، retention،
alert destination، health endpoint و dashboard. metrics باید کمینه و بدون افشای
اطلاعات باشد؛ authorization و exposure policy برای metrics حساس نیز باید داشته
باشند.

### ۳.۸. Uploads و media safety

بررسی MIME و magic bytes، محدودیت حجم و نام‌گذاری تصادفی لازم‌اند؛ اما
WebP/RIFF باید دقیقاً بررسی شود، ابعاد تصویر و decompression bomb محدود شود،
EXIF حذف گردد و quota مجموع فایل برای tenant تعریف شود. quarantine یا antivirus
برای فایل غیرقابل‌اعتماد. تصمیم publish پیش از upload باید تصمیم‌گیری و ثبت شود.

### ۳.۹. API surface و route completeness

مسیرهای catalog، reservations، sales-requests، sales-dispatches و metrics در manual
دیده می‌شوند، اما OpenAPI، pagination، versioning، error code registry،
authorization matrix و audit کامل نیستند. قرارداد API باید از کد یا schema تولید
شود و در CI بررسی شود، نه اینکه صرفاً در سند بماند.

### ۳.۱۰. Runbook، deployment و عملیات

Docker Compose، Caddy، Node 22 Alpine و non-root پوشش عملیاتی مناسبی دارند.
ضعف‌ها شامل اتکا به cron host، نبود owner/SLA روشن برای alert، secret rotation و
ambiguity در off-site backup است. هر runbook باید trigger، precondition، command،
verification و rollback داشته باشد و owner داشته باشد.

### ۳.۱۱. Testing و CI/CD

باید علاوه بر unit test، integration و E2E، سناریوهای RLS دو tenant، رزرو هم‌زمان،
idempotency، worker crash، restore و load test را الزام کند. CI باید OpenAPI diff،
migration check، secret scan، dependency scan، image scan و deploy smoke test داشته
باشد.

### ۳.۱۲. Documentation و maintainability

manual غنی است، اما احتمال drift میان state machine، route inventory، env matrix و
repository بالاست. یک منبع تولیدشده از schema/code، changelog، ADR و مالک هر سند
لازم است. سند عالی‌ای که با کد sync نیست، خیلی محترمانه به یک خاطره تبدیل می‌شود.

---

## ۴. باگ‌ها، ناسازگاری‌ها و ریسک‌های استنباط‌شده

ممیزی انجام‌شده دو سطح ریسک را نشان می‌دهد. موارد زیر از متن manual و نکات ممیزی
ارائه‌شده استنباط شده‌اند؛ تا زمان مشاهده repository، «باگ قطعی در کد» محسوب
نمی‌شوند و باید با وضعیت `Present/Partial/Missing` راستی‌آزمایی شوند.

### ۴.۱. ریسک‌های P0

1. **دو بار کشردن موجودی:** manual هم افزایش `allocated_qty_boxes` با رزرو را بیان
   می‌کند و هم جمع reservation_item را در held نشان می‌دهد. این دو مدل باید یکی شوند.
2. **ابهام در transition‌ها:** زمان تبدیل Reservation به converted، رفتار ردشدن،
   آزادشدن allocation در cancel و لحظه کاهش on_hand در Dispatch صریح نیست.
3. **RLS غیر idempotent یا نادرست:** ساخت policy با نام تکراری، schema-qualified
   identifier، و جدول‌های استثنا می‌تواند migration را بشکند یا policy ناخواسته بسازد.
4. **دورزدن RLS توسط نقش privileged:** superuser، owner و BYPASSRLS باید شناسایی و
   از مسیر application جدا شوند.
5. **restore اثبات‌نشده:** وجود اسکریپت backup به‌تنهایی صحت decrypt، restore و
   بازیابی uploads را ثابت نمی‌کند.
6. **آمادگی DR مبهم:** off-site اختیاری با ادعای DR سازگار نیست.
7. **crash duplicate notification:** میان پذیرش provider و علامت‌گذاری outbox باعث
   ارسال تکراری می‌شود.
8. **rate limit محلی:** in-memory limit در چند instance سقف سراسری ایجاد نمی‌کند.

### ۴.۲. ریسک‌های P1/P2

- مشتق‌سازی encryption key از AUTH_SECRET rotation را به‌هم‌ریخته و key versioning ندارد.
- OpenAPI و route inventory ممکن است با implementation drift کند.
- quota tenant برای uploads و سیاست quarantine کامل نیست.
- trace میان web، database و worker ناقص است.
- error contract، pagination و versioning برای API به‌صراحت تعریف نشده‌اند.
- recovery با حذف رکورد migration می‌تواند تاریخچه schema را از واقعیت جدا کند.
- load test برای reservation، catalog و import مشخص نشده است.
- SLA، owner و مقصد alert‌ها نامعلوم است.

برای هر مورد باید فایل یا migration واقعی، line، symbol مرتبط، شدت، مالک و تست
بازتولید ثبت شود. هیچ اصلاحی نباید صرفاً به دلیل شباهت نام فایل‌ها اعمال شود.

---

## ۵. Backlog اولویت‌دار قابلیت‌ها و اصلاحات

| اولویت | قابلیت/اصلاح | دلیل کسب‌وکار و فنی | خروجی قابل تحویل |
|---|---|---|---|
| P0 | مدل رسمی held/allocated/available | جلوگیری از فروش بیش‌از موجودی و اختلاف | invariant، migration، test suite |
| P0 | state-transition matrix | جلوگیری از transition غیرمجاز و آزادسازی اشتباه | domain state machine، audit transition و guard matrix مرکزی |
| P0 | تست ایزولاسیون دو tenant | جلوگیری از نشت داده | integration matrix برای read/write/join |
| P0 | restore evidence و off-site اجباری | کاهش ریسک از دست‌رفتن داده | checksum، artifact، زمان RPO/RTO |
| P1 | OpenAPI و error registry | قرارداد پایدار برای UI و integrations | spec versioned و CI diff |
| P1 | audit پیشرفته | پاسخگویی و forensic | actor، tenant، request id، before/after، reason |
| P1 | key rotation با key_version | تعویض امن راز بدون از دست‌رفتن ciphertext | migration/rotation runbook |
| P1 | rate limit مشترک یا backend مشترک | مقابله مؤثر با abuse | instance مشترک یا محدودیت صادقانه best-effort |
| P1 | alerting و dashboard | تشخیص پیش‌دستانه outage و backlog | SLO، alert route، escalation |
| P2 | inventory reconciliation | کشف drift میان ledger، balance و reservation | گزارش اختلاف و repair کنترل‌شده |
| P2 | load/performance test | ظرفیت‌سنجی واقعی | baseline و threshold سناریو |
| P2 | tracing با OpenTelemetry | تحلیل latency میان سرویس‌ها | trace/span correlation |
| P3 | object storage و real-time updates | کاهش فشار application و بهبود UX | adapter و SSE/WebSocket در صورت نیاز |
| P3 | documentation sync | جلوگیری از drift | inventory تولیدشده از route/env/schema |

ترتیب اولویت بر اساس ریسک correctness و data loss است، نه صرفاً جذابیت. waitlist و
real-time UI نباید پیش از تثبیت موجودی و مرز P0 منابع را مصرف کنند.

---

## ۶. ترتیب پیاده‌سازی منطبق با لایه‌های معماری

ترتیب اصلی باید از پایین‌ترین لایه‌ای آغاز شود که invariant را enforce می‌کند و سپس
به لایه‌های مصرف‌کننده می‌رسد:

```text
Database → Domain logic → API → UI → Workers → Ops → Tests/CI evidence
```

در عمل، تست از ابتدا اجرا می‌شود و در انتها gate قرار می‌گیرد؛ قرارگرفتن آن در
انتهای نمودار به معنی موکول‌کردن تست نیست.

1. **Database:** schema، constraint، index، ledger، RLS، privilege، migration lock و audit storage.
2. **Domain logic:** state machine، transition guard، inventory calculator، reservation mutex و idempotency service.
3. **API:** tenant context، route authorization، validation، OpenAPI و error codes.
4. **UI:** فقط پس از تثبیت contract؛ نمایش state و نه بازتولید منطق در client.
5. **Workers:** expire، outbox و reconciliation با lock/claim امن.
6. **Ops:** backup، restore، secrets، deployment، metrics و alert.
7. **Tests/CI:** contract، security، concurrency، failure injection، load و evidence archive.

این ترتیب dependency‌ها را کاهش می‌دهد: UI روی API، API روی domain، و domain روی
constraint‌های روی دادهای که isolation را onData enforce می‌کنند.

---

## ۷. فاز P0 — تثبیت صحت داده و مرز امنیتی

> **هشدار اجرایی:** ابتدا فایل‌های مرتبط واقعی پروژه را بررسی کنید، وجود هر اصلاح
> یا قابلیت را verify کنید، و فقط اگر موردی missing یا ناقص بود پیاده‌سازی را آغاز
> کنید. هیچ کدی را صرفاً بر اساس این فهرست بازنویسی نکنید.

### ۷.۱. اهداف

- حذف ابهام موجودی و تضمین `available >= requested` در تراکنش.
- رسمی‌کردن state transition‌های Reservation، SalesRequest و SalesDispatch.
- اثبات tenant isolation در read/write و جلوگیری از bypass.
- ایجاد evidence برای backup و restore پیش از Go-Live.

### ۷.۲. فایل‌ها و بخش‌های مرتبط برای بازرسی

فقط نام‌هایی که در manual آمده‌اند مبنای هستند: route‌های `/api/catalog`،
`/api/reservations`، `/api/sales-requests`، `/api/sales-dispatches`، `/api/metrics`،
schema، migration‌های RLS، domain services مربوط به inventory/reservation،
worker-expire، outbox و اسکریپت‌های backup/restore. اگر implementation در فایل دیگری
است، ابتدا آن را در repository پیدا و در inventory ثبت کنید؛ نام جدید را بدون
مشاهده نسازید.

### ۷.۳. کارهای پیاده‌سازی

1. یک مدل نهایی انتخاب کنید: held از reservation‌های فعال محاسبه شود یا allocated
   از reservation_item‌های تبدیل‌شده. اگر `inventory_balance` projection رسمی است،
   هرگز هر دو را برای یک مقدار کم نکنید.
2. برای هر transition، from، to، actor، شرط، اثر موجودی و اقدام بعدی را ثبت کنید.
   transition guard‌ها باید در domain guard متمرکز باشند.
3. transaction را با ترتیب ثابت قفل کنید: tenant context، lot، reservation/allocation، ledger.
4. duplicate request باید با idempotency key و request hash پاسخ قبلی را برگرداند.
5. policy‌های RLS را schema-aware و idempotent کنید؛ `FORCE ROW LEVEL SECURITY`
   بررسی کنید؛ REVOKE/GRANT برای SECURITY DEFINER و owner/BYPASSRLS verify کنید.
   policy باید با مستند رسمی PostgreSQL مطابقت داده شود و منبع رسمی policy با
   policy‌های واقعی پروژه تطبیق داده شود.
6. tenant id انتخابی را از membership معتبر بسازید و هرگونه tenant id از body/query
   را غیرقابل‌اعتماد فرض کنید.
7. restore جداگانه database و uploads را اجرا کنید و نتیجه، decrypt، checksum،
   تعداد رکوردهای کلیدی و زمان RPO/RTO را artifact کنید.
8. recovery migration را forward-only کنید و حذف دستی `_migrations` را از مسیر عادی
   runbook خارج کنید.

### ۷.۴. معیار پذیرش

- دو درخواست هم‌زمان برای آخرین موجودی هرگز oversell نمی‌کنند.
- replay با همان key و hash همان نتیجه را می‌دهد؛ hash متفاوت خطای قراردادی مشخص دارد.
- tenant A نمی‌تواند داده tenant B را بخواند، insert، update، delete، یا از join نشت دهد.
- transition نامعتتبر با error code مشخص رد می‌شود و هیچ mutation ناقص باقی نمی‌ماند.
- restore روی مقصد جدا با integrity check موفق است و off-site backup واقعاً قابل‌دسترسی است.

### ۷.۵. برنامه تست

تست integration با دو tenant و چند role، تست concurrency با چند worker/request،
تست rollback تراکنش، تست RLS برای چهار عمل CRUD، تست replay و hash conflict، و
restore drill اجرا شود. خروجی‌ها باید در CI یا artifact release نگه‌داری شوند.

### ۷.۶. contingency و rollback

migration‌ها forward-only باشند. در صورت شکست deploy، قبلی حفظ و feature flag خاموش
شود؛ برای corruption موجودی، repair مستقیم ممنوع و از ledger، گزارش اختلاف و
migration اصلاحی استفاده شود. اگر restore موفق نیست، Go-Live متوقف و backup محلی
به‌عنوان DR اعلام نشود.

---

## ۸. فاز P1 — تکمیل قرارداد API و امنیت عملیاتی

> **هشدار اجرایی:** ابتدا فایل‌های مرتبط واقعی پروژه را بررسی کنید، وجود هر اصلاح
> یا قابلیت را verify کنید، و فقط اگر موردی missing یا ناقص بود پیاده‌سازی را آغاز کنید.

### ۸.۱. اهداف

قرارداد API، audit، rate limiting، secret handling و دسترسی endpoint‌ها باید از
حالت توضیحی به کنترل قابل‌اجرا تبدیل شوند.

### ۸.۲. فایل‌ها و بخش‌های مرتبط برای بازرسی

proxy.ts، route‌های API نام‌برده در manual، auth helpers، schema، validation،
session/JWT، env matrix، encryption helper مربوط به sms_config و تنظیمات
Caddy/HTTPS را inspect کنید. فایل جدید فقط در صورت نبود معادل واقعی و پس از ثبت
در inventory مجاز است.

### ۸.۳. کارهای پیاده‌سازی

- OpenAPI versioned برای route‌های موجود ایجاد یا تکمیل کنید؛ tenant، auth،
  request/response، context، pagination و error codes را پوشش دهید.
- error registry بسازید و خطاهایی مانند `INSUFFICIENT_STOCK`،
  `IDEMPOTENCY_KEY_REUSED`، `TENANT_CONTEXT_REQUIRED` را به آن متصل کنید و UI را
  بسازید.
- audit را به transition، reason، before/after، entity، request id، tenant، actor
  مجهز کنید؛ log‌ها هرگز secrets و token نشان ندهند.
- rate limit را برای login، reset، upload، reservation بر مبنای IP و هویت /tenant
  طراحی کنید؛ اگر backend مشترک وجود ندارد، محدودیت in-memory را صادقانه
  best-effort اعلام کنید.
- ENCRYPTION_KEY جدا از AUTH_SECRET با key_version اضافه کنید؛ versioned ciphertext
  و قالب rollback و rotation runbook آن را.
- trust مربوط به X-Forwarded-For، IPv6، CSRF و session revocation را با تست مشخص کنید.

### ۸.۴. معیار پذیرش

OpenAPI با route‌های واقعی هم‌سان است و CI diff می‌کند؛ audit tenant-scoped و
قابل‌جستجو است؛ error‌ها کد دارند؛ rate limit روی abuse رفتار قابل‌پیش‌بینی دارد؛
rotation بدون از دست‌رفتن secret‌های قبلی انجام می‌شود.

### ۸.۵. برنامه تست

contract test برای OpenAPI، authorization matrix برای role‌ها، CSRF/session replay
تست، rate limit در یک و چند instance، key rotation روی ciphertext قدیمی/جدید و
secret scan و log redaction اجرا شود.

### ۸.۶. contingency و rollback

OpenAPI breaking change باید version یا compatibility layer داشته باشد تا کلید جدید
تا پایان decrypt آزمایشی فعال نشود. rate limit در صورت مشکل fail-open مجاز است و
فقط برای endpoint غیرحساس؛ alert برای login، reset و upload نباید بی‌محافظ بمانند.

---

## ۹. فاز P2 — قابلیت اطمینان worker، backup و observability

> **هشدار اجرایی:** ابتدا فایل‌های مرتبط واقعی پروژه را بررسی کنید، وجود هر اصلاح
> یا قابلیت را verify کنید، و فقط اگر موردی missing یا ناقص بود پیاده‌سازی را آغاز کنید.

### ۹.۱. اهداف

پایداری worker‌ها باید با شواهد قابل تکرار تضمین شود؛ outbox، reconciliation،
backup، alerting و tracing نه با سبز بودن یک health check ساده.

### ۹.۲. فایل‌ها و بخش‌های مرتبط برای بازرسی

worker-expire، outbox worker، notification provider، backup/restore اسکریپت‌ها،
cron تنظیمات یا scheduler، structured logger، metrics/tracing، `/api/health` و
`/api/metrics` و compose/Caddy configuration را inspect کنید.

### ۹.۳. کارهای پیاده‌سازی

- outbox را با claim اتمیک، lease، retry با lock، exponential backoff و jitter و
  dead-letter تکمیل کنید.
- وضعیت provider را به transient، permanent و unknown outcome تفکیک کنید؛
  provider_message_id و idempotency provider را در صورت پشتیبانی ذخیره کنید.
- worker-expire را در برابر اجرای موازی و تکرار ایمن کنید و پس از آزادسازی موجودی،
  waitlist را با transaction مستقل و قابل‌ردیابی پردازش کنید.
- reconciliation job بسازید که allocation، reservation، ledger و balance را مقایسه کند؛
  repair خودکار فقط برای اختلاف‌های کاملاً تعریف‌شده مجاز باشد.
- backup off-site را اجباری یا صریحاً خارج از ادعای DR اعلام کنید. آخرین موفقیت،
  checksum، encryption، decrypt و restore را monitor کنید.
- dashboard برای error rate، latency، reservation conflict، outbox age، dead-letter،
  backup، disk، DB connection و worker lag بسازید؛ severity، owner، alert destination
  و escalation را بنویسید.
- trace_id را بین web، worker و DB operation propagate کنید و retention و access
  policy لاگ را مشخص کنید.

### ۹.۴. معیار پذیرش

crash در هر نقطه outbox باعث از دست‌رفتن پیام نمی‌شود؛ duplicate با شناسه و policy
کنترل می‌شود؛ job‌ها idempotent هستند؛ reconciliation اختلاف را کشف می‌کند؛ backup
failure alert دارد؛ restore drill زمان‌دار و قابل‌تکرار است؛ و برای alert‌های P0
owner و SLA تعیین شده است.

### ۹.۵. برنامه تست

failure injection در provider و worker، اجرای موازی expire، پرشدن queue، dead-letter
replay، قطع storage، pg_dump شکست با کلید اشتباه، restore database/uploads و
بررسی alert delivery اجرا شود.

### ۹.۶. contingency و rollback

تغییر worker با concurrency محدود و canary deploy انجام شود. در صورت duplicate
notification، ارسال خودکار را متوقف و dead-letter را حفظ کنید. در صورت شکست backup،
آخرین backup سالم را حذف نکنید و incident را باز نگه دارید تا backup جایگزین و
restore verification انجام شود.

---

## ۱۰. فاز P3 — مقیاس‌پذیری، تجربه محصول و بلوغ تحویل

> **هشدار اجرایی:** ابتدا فایل‌های مرتبط واقعی پروژه را بررسی کنید، وجود هر اصلاح
> یا قابلیت را verify کنید، و فقط اگر موردی missing یا ناقص بود پیاده‌سازی را آغاز کنید.

### ۱۰.۱. اهداف

پس از تثبیت correctness و عملیات، سیستم برای رشد tenant‌ها، فایل‌ها، بار خواندن
catalog و تجربه بهتر کاربران آماده شود.

### ۱۰.۲. فایل‌ها و بخش‌های مرتبط برای بازرسی

صفحات و UI‌های client، route‌های catalog، reservation و upload/media flow،
worker‌های notification، schema‌ها، compose/deployment، OpenAPI و فایل‌های
documentation موجود را بررسی کنید. هیچ نام فایل فرضی را جایگزین مسیر واقعی نکنید.

### ۱۰.۳. کارهای پیاده‌سازی

- load test برای catalog، reservation و import با baseline و threshold مشخص اجرا کنید.
- query plan، index، pagination و caching را بر اساس measurement اصلاح کنید.
- در صورت نیاز object storage را پشت adapter قرار دهید تا lifecycle، quota،
  پاک‌سازی EXIF و quarantine حفظ شود.
- real-time announce، waitlist را با SSE/WebSocket فقط پس از تثبیت API و worker
  اضافه کنید.
- documentation sync برای route inventory، env matrix، state machine و runbook بسازید؛
  تغییرات معماری باید ADR یا changelog داشته باشد.
- CI/CD را با migration check، OpenAPI diff، secret scan، dependency/image scan،
  performance regression و smoke test تکمیل کنید.

### ۱۰.۴. معیار پذیرش

ظرفیت هدف با داده و threshold مستند اثبات شده است؛ query‌های بحرانی budget latency
دارند؛ private access و quota enforce می‌شود؛ documentation با implementation
هم‌سان است؛ و feature‌های جدید بدون نقض invariant‌های P0 فعال می‌شوند.

### ۱۰.۵. برنامه تست

load test و baseline تکرارشونده، quota test، E2E waitlist/real-time، regression
API/UI، فایل مخرب و migration rehearsal و staging deploy/rollback اجرا شود.

### ۱۰.۶. contingency و rollback

feature flag برای قابلیت‌های جدید، adapter قابل‌توسعه برای storage و API
versioning استفاده شود. اگر performance regression رخ داد، آخرین تغییر query/cache
حفظ شود؛ measurement و داده‌ها ثبت شوند. قابلیت real-time نباید مسیر اصلی رزرو را
block کند.

---

## ۱۱. دروازه پذیرش و معیار Go-Live

Go-Live فقط پس از عبور همه موارد زیر مجاز است:

### ۱۱.۱. شواهد فنی

- □ مدل inventory و state-transition matrix تصویب و در domain test enforce شد.
- □ تست دو tenant برای read/write/join برای نقش‌های مختلف سبز است.
- □ هیچ application role دارای SUPERUSER یا BYPASSRLS نیست؛ owner و FORCE ROW LEVEL
  SECURITY بررسی شده‌اند.
- □ SECURITY DEFINER‌ها owner، privilege، search_path و ورودی authorization شده دارن.
- □ OpenAPI، route inventory و error registry با implementation sync هستند.
- □ تست concurrency، idempotency، worker crash و duplicate provider انجام شده است.
- □ uploads از نظر MIME، magic bytes، ابعاد، quota، private access و quarantine
  بررسی شده‌اند.

### ۱۱.۲. شواهد عملیاتی

- □ backup رمزنگاری‌شده و off-site موجود است و freshness alert دارد.
- □ restore واقعی database و uploads روی مقصد جدا با checksum و integrity check
  موفق شده است.
- □ RPO/RTO اندازه‌گیری‌شده، owner و escalation مشخص دارد.
- □ dashboard و alert برای error rate، latency، worker lag، outbox، backup و disk
  فعال است.
- □ secret rotation و rollback rehearsal انجام شده است.
- □ deploy، migration، rollback و incident runbook توسط فردی غیر از نویسنده اجرا و
  تأیید شده است.

### ۱۱.۳. تصمیم نهایی

اگر هر مورد P0 یا شواهد restore ناقص باشد، وضعیت باید `Go-Live candidate pending
evidence` بماند. عبارت «Implementation Complete» فقط زمانی معتبر است که کد، تست و
evidence عملیاتی هم‌زمان وجود داشته باشند. در غیر این صورت، production با
اعتماد‌به‌نفس کاذب جای staging را گرفته است؛ تجربه‌ای پرهزینه و قابل‌پیش‌گیری.

---

## ۱۲. ریسک عدم اجرا و منابع

این فازبندی، ترتیب اصلاحات و معیارهای پذیرش را به یک برنامه اجرایی تبدیل می‌کند.

### ۱۲.۱. ریسک‌های عدم اجرا

- ابهام held/allocated می‌تواند به oversell، مغایرت فاکتور/حواله و از بین‌رفتن
  اعتماد نماینده منجر شود.
- RLS ناقص یا role privileged می‌تواند نشت داده میان tenant‌ها و نقض محرمانگی
  ایجاد کند.
- state machine ناقص می‌تواند موجودی را در مسیر cancel، reject یا dispatch دوباره
  آزاد یا دوباره رزرو کند.
- outbox بدون کنترل duplicate ممکن است اعلان تکراری یا وضعیت اشتباه به مشتری نشان دهد.
- backup بدون restore evidence در لحظه بحران فقط یک فایل امیدوارکننده است، نه
  برنامه بازیابی.
- نبود alert و tracing زمان تشخیص و حل incident را افزایش می‌دهد.
- نبود OpenAPI و documentation sync هزینه تغییرات UI، integration و onboarding
  مهندسان را بالا می‌برد.
- نبود load test می‌تواند bottleneck را بعد از ورود tenant‌های واقعی آشکار کند.

### ۱۲.۲. جمع‌بندی اجرایی

اول P0 را ببندید: correctness موجودی، tenant isolation، state transition و restore.
سپس P1 را برای قرارداد و امنیت عملیاتی، P2 را برای قابلیت اطمینان و مشاهده‌پذیری،
و P3 را برای مقیاس و تجربه محصول اجرا کنید. هر فاز باید با بازرسی repository،
وضعیت‌گذاری Present/Partial/Missing و evidence پایان یابد.

### ۱۲.۳. منابع

1. **S1:** متن manual: *Engineering Manual & Comprehensive Architecture — Tile SaaS* —
   ارائه‌شده در زمینه این گفتگو؛ شامل دامنه کسب‌وکار، state machine‌ها، RLS، امنیت،
   outbox، backup/restore و route inventory.
2. **S2:** PostgreSQL 18 Documentation: Row Security Policies — رفتار RLS با
   privilege، policy bypass توسط owner/superuser/BYPASSRLS، default-deny و تفاوت
   FORCE ROW LEVEL SECURITY.
