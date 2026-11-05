import { useEffect, useState } from "react";
import { getJson } from "./api";
import { FEATURE_DEFAULTS, type Features } from "./features";

/**
 * امکاناتِ کارخانه برای پنلِ پشتیبان. تا وقتی پاسخ نیامده `loaded=false` است و
 * پیش‌فرض‌ها برگردانده می‌شوند. جداسازیِ واقعی در سرور است؛ این فقط UI را خلوت می‌کند.
 */
export function useFeatures(tenantId: string | undefined): { features: Features; loaded: boolean } {
  const [state, setState] = useState<{ features: Features; loaded: boolean }>({ features: FEATURE_DEFAULTS, loaded: false });
  useEffect(() => {
    if (!tenantId) return;
    let live = true;
    getJson<{ features: Features }>(`/api/settings/features?tenantId=${tenantId}`).then((res) => {
      if (live) setState({ features: res.ok ? res.data.features : FEATURE_DEFAULTS, loaded: true });
    });
    return () => { live = false; };
  }, [tenantId]);
  return state;
}
