// =============================================================================
// web/src/lib/metrics.ts — In-memory metrics for request count and latency
// =============================================================================
// این ماژول metrics ساده‌ی in-memory پیاده می‌کند. برای این مقیاس (چند ده
// نماینده) Prometheus/Grafana over-engineering است (قانون ponytail).
//
// Metrics در حافظه نگه داشته می‌شوند و با /api/metrics در دسترس‌اند.
// در multi-instance، هر instance metrics خودش را دارد — برای aggregation
// واقعی می‌توان به Prometheus یا Postgres منتقل شد.
//
// Readiness: این ماژول در Edge runtime هم کار می‌کند (هیچ async/await ندارد).
// =============================================================================

type MetricEntry = {
  count: number;
  totalDurationMs: number;
  minMs: number;
  maxMs: number;
};

class MetricsCollector {
  private requests = new Map<string, MetricEntry>();
  private statusCounts = new Map<string, number>();
  private startTime = Date.now();

  /** ثبت یک درخواست. */
  recordRequest(route: string, method: string, statusCode: number, durationMs: number) {
    const key = `${method} ${route}`;
    const existing = this.requests.get(key);
    if (existing) {
      existing.count++;
      existing.totalDurationMs += durationMs;
      existing.minMs = Math.min(existing.minMs, durationMs);
      existing.maxMs = Math.max(existing.maxMs, durationMs);
    } else {
      this.requests.set(key, {
        count: 1,
        totalDurationMs: durationMs,
        minMs: durationMs,
        maxMs: durationMs,
      });
    }

    // شمارش status code
    const statusKey = `${statusCode}`;
    this.statusCounts.set(statusKey, (this.statusCounts.get(statusKey) ?? 0) + 1);
  }

  /** خروجی JSON برای /api/metrics. */
  toJSON() {
    const routes: Record<string, unknown> = {};
    for (const [key, entry] of this.requests) {
      routes[key] = {
        count: entry.count,
        avgMs: Math.round(entry.totalDurationMs / entry.count),
        minMs: Math.round(entry.minMs),
        maxMs: Math.round(entry.maxMs),
      };
    }

    const statuses: Record<string, number> = {};
    for (const [key, count] of this.statusCounts) {
      statuses[key] = count;
    }

    const totalRequests = [...this.statusCounts.values()].reduce((a, b) => a + b, 0);
    const errorCount = (statuses["4xx"] ?? 0) + (statuses["5xx"] ?? 0);
    // محاسبه‌ی 4xx و 5xx از status code‌های جداگانه
    let count4xx = 0;
    let count5xx = 0;
    for (const [code, count] of this.statusCounts) {
      const n = parseInt(code, 10);
      if (n >= 400 && n < 500) count4xx += count;
      if (n >= 500) count5xx += count;
    }

    return {
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      total_requests: totalRequests,
      count_4xx: count4xx,
      count_5xx: count5xx,
      error_rate: totalRequests > 0 ? ((count4xx + count5xx) / totalRequests * 100).toFixed(2) + "%" : "0%",
      routes,
      statuses,
    };
  }

  /** reset — فقط برای تست. */
  reset() {
    this.requests.clear();
    this.statusCounts.clear();
    this.startTime = Date.now();
  }
}

export const metrics = new MetricsCollector();
