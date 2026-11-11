/** کلید تم در localStorage؛ صفحه‌های قدیمی و تازه یکی را می‌خوانند تا انتخاب کاربر بین آن‌ها بماند. */
export const THEME_KEY = "tile.theme";

// no-flash: قبل از رنگ‌آمیزی اول، data-theme را از localStorage روی <html> می‌نشاند. useEffect دیر است
// (بعد از اولین رندر اجرا می‌شود)، پس یک <script> خام با nonceِ CSP در layout لازم است.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
