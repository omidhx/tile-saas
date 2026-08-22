"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, loadError, type Loaded } from "./api";

/**
 * الگوی «بارگذاری + جستجوی debounce + صفحه‌بندی» که در AuditSection/LedgerSection
 * جداگانه نوشته شده بود، با یک باگِ مشترک: جوابِ یک جستجوی قدیمی می‌توانست بعدِ
 * جستجوی جدید برسد و لیست را بی‌صدا بازنویسی کند (race condition). این‌جا با
 * شمارنده‌ی نسخه (`gen`) بسته می‌شود — پاسخی که نسخه‌اش قدیمی شده، نادیده گرفته می‌شود.
 */
export function usePaginatedSearch<TItem, TRaw extends { hasMore: boolean }>(
  tenantId: string,
  fetchPage: (tenantId: string, query: string, offset: number) => Promise<Loaded<TRaw>>,
  getItems: (raw: TRaw) => TItem[],
  opts?: { debounceMs?: number; onInitialLoad?: (raw: TRaw) => void },
) {
  const debounceMs = opts?.debounceMs ?? 300;
  const [rows, setRows] = useState<TItem[]>([]);
  const [q, setQ] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);

  // refها: fetchPage/getItems/onInitialLoad معمولاً هر رندر یک closureِ تازه‌اند؛
  // اگر مستقیم در deps بیایند، load() هر بار عوض می‌شود و افکتِ زیرش loop می‌زند.
  const fetchPageRef = useRef(fetchPage); fetchPageRef.current = fetchPage;
  const getItemsRef = useRef(getItems); getItemsRef.current = getItems;
  const onInitialLoadRef = useRef(opts?.onInitialLoad); onInitialLoadRef.current = opts?.onInitialLoad;

  const load = useCallback(async () => {
    const myGen = ++gen.current;
    const res = await fetchPageRef.current(tenantId, "", 0);
    if (myGen !== gen.current) return; // نسخه‌ی قدیمی — یک load/search/loadMore تازه‌تر از این جلو زده
    if (res.ok) {
      setRows(getItemsRef.current(res.data)); setHasMore(res.data.hasMore); setQ(""); setLoadErr("");
      onInitialLoadRef.current?.(res.data);
    } else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  function search(v: string) {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const myGen = ++gen.current;
    debounceRef.current = setTimeout(async () => {
      const res = await fetchPageRef.current(tenantId, v, 0);
      if (myGen !== gen.current) return;
      if (res.ok) { setRows(getItemsRef.current(res.data)); setHasMore(res.data.hasMore); }
    }, debounceMs);
  }

  async function loadMore() {
    const myGen = ++gen.current;
    setMoreBusy(true);
    try {
      const res = await fetchPageRef.current(tenantId, q, rows.length);
      if (myGen !== gen.current) return;
      if (res.ok) { setRows((prev) => [...prev, ...getItemsRef.current(res.data)]); setHasMore(res.data.hasMore); }
    } finally { if (myGen === gen.current) setMoreBusy(false); }
  }

  return { rows, q, hasMore, moreBusy, loadErr, loaded, search, loadMore, reload: load };
}

export type { Loaded };
