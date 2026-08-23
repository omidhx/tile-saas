// =============================================================================
// web/src/lib/logger.ts — Structured JSON Logger
// =============================================================================
// logging ساختاریافته با JSON، requestId، و redaction اطلاعات حساس.
//
// این logger جایگزین console.log خام است. در production، JSON خروجی می‌دهد
// تا با log aggregator (ELK, Loki, CloudWatch) سازگار باشد.
//
// Readiness: این logger در Edge runtime هم کار می‌کند (هیچ async/await ندارد).
// =============================================================================

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
};

// فیلدهایی که هرگز نباید در log ظاهر شوند
const REDACTED_KEYS = [
  "password",
  "token",
  "authorization",
  "cookie",
  "session",
  "secret",
  "apiKey",
  "database_url",
  "DATABASE_URL",
  "AUTH_SECRET",
  "jwt",
  "refresh_token",
];

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_KEYS.some((r) => key.toLowerCase().includes(r.toLowerCase()))) {
      cleaned[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      cleaned[key] = redact(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "web",
    environment: process.env.NODE_ENV ?? "development",
    message,
    ...redact(context ?? {}),
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === "production") return;
    console.debug(formatLog("debug", message, context));
  },

  info(message: string, context?: LogContext) {
    console.log(formatLog("info", message, context));
  },

  warn(message: string, context?: LogContext) {
    console.warn(formatLog("warn", message, context));
  },

  error(message: string, context?: LogContext) {
    console.error(formatLog("error", message, context));
  },
};

// =============================================================================
// Request ID generation — برای correlation ID
// =============================================================================

/**
 * تولید requestId برای هر درخواست.
 * اگر proxy.ts یا reverse proxy یک requestId هدر فرستاده باشد، از آن استفاده می‌کند.
 * در غیر این صورت، یک UUID تولید می‌کند.
 */
export function getRequestId(headers: Headers): string {
  // از reverse proxy یا proxy.ts می‌آید
  const existing = headers.get("x-request-id");
  if (existing) return existing;

  // اگر نبود، تولید کن
  return crypto.randomUUID();
}

/**
 * requestId را در context یک async operation نگه دارید.
 * این الگو (AsyncLocalStorage) در Next.js با `headers()` کار نمی‌کند،
 * پس requestId را باید صراحتاً پاس بدهید.
 */
export type RequestContext = {
  requestId: string;
  userId?: string;
  tenantId?: string;
  route?: string;
  method?: string;
};
