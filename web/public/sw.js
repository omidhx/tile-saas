// کشِ سبکِ «فقط خواندنی» برای کاتالوگِ عمومی (spec: PWA سبک، کشِ کاتالوگ).
// هرگز چیزی را که رزرو/تصمیمِ کسب‌وکار می‌سازد کش نمی‌کند — نه POST/PATCH/DELETE،
// نه هیچ /api/*ای (حتی GET، چون دیتای زنده‌ی موجودی است) — رزرو باید همیشه
// آنلاین باشد چون race condition را تضمین می‌کند (spec ۶).

const CACHE = "tile-catalog-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // مسیرِ نوشتن دست‌نخورده می‌ماند

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // دیتای زنده، هرگز کش نشود

  const isCatalogPage = url.pathname.startsWith("/c/");
  const isStaticAsset = url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/uploads/")
    || url.pathname.startsWith("/icon-");
  if (!isCatalogPage && !isStaticAsset) return;

  if (isCatalogPage) {
    // network-first: آنلاین همیشه موجودیِ زنده می‌بیند؛ فقط وقتی شبکه قطع
    // بود، آخرین نسخه‌ی دیده‌شده از کش می‌آید — بهتر از صفحه‌ی سفید.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request)),
    );
  } else {
    // فایلِ استاتیک/عکس تغییر نمی‌کند، پس اول از کش.
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })),
    );
  }
});
