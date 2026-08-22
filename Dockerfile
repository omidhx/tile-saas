# =============================================================================
# Dockerfile — اپ Next.js روی VPS ایران
# =============================================================================
# multi-stage build: مرحله‌ی builder فقط وابستگی‌ها را نصب و بیلد می‌کند.
# مرحله‌ی runner فقط خروجیِ بیلد + node_modulesِ production را نگه می‌دارد.
#
# نکته‌ی امنیتی: این image با non-root کاربر اجرا می‌شود (next).
# در production، volumeی `/app/web/public/uploads` باید جدا باشد.
#
# اساس: node:20-alpine چون سبک‌تر از full node است و آسیب‌پذیری کمتری دارد.
# =============================================================================

# ---- stage 1: deps ----
FROM node:20-alpine AS deps
WORKDIR /app

# فقط package*.json را کپی — از cache شدنِ npm install بهره می‌برد
COPY web/package.json web/package-lock.json* ./web/

WORKDIR /app/web
RUN npm ci --include=dev

# ---- stage 2: builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web/ ./web/
COPY db/ ./db/

WORKDIR /app/web
# NEXT_TELEMETRY_DISABLED برای جلوگیری از ارسال تله‌متری به Vercel
ENV NEXT_TELEMETRY_DISABLED=1
# SENTRY_DSN خالی — در build-time Sentry فعال نیست (در runtime از env خوانده می‌شود)
ENV SENTRY_DSN=""

# بیلدِ production — نیاز به DATABASE_URL ندارد در زمان build
# (این پروژه هیچ query در زمان build نمی‌زند — همگی در runtime)
RUN npm run build

# ---- stage 3: runner ----
FROM node:20-alpine AS runner
WORKDIR /app

# غیرفعال‌کردن telemetry در runtime هم
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# نصبِ curl برای healthcheck
RUN apk add --no-cache curl

# کاربر non-root
RUN addgroup -g 1001 -S nodejs && adduser -S next -u 1001 -G nodejs

# کپیِ خروجیِ بیلد
COPY --from=builder --chown=next:nodejs /app/web/public ./web/public
COPY --from=builder --chown=next:nodejs /app/web/.next ./web/.next
COPY --from=builder --chown=next:nodejs /app/web/node_modules ./web/node_modules
COPY --from=builder --chown=next:nodejs /app/web/package.json ./web/package.json
COPY --from=builder --chown=next:nodejs /app/web/next.config.ts ./web/next.config.ts
COPY --from=builder --chown=next:nodejs /app/web/instrumentation.ts ./web/instrumentation.ts
COPY --from=builder --chown=next:nodejs /app/web/sentry.edge.config.ts ./web/sentry.edge.config.ts
COPY --from=builder --chown=next:nodejs /app/web/sentry.server.config.ts ./web/sentry.server.config.ts
# scripts/ برای workerهای expire و outbox
COPY --from=builder --chown=next:nodejs /app/web/scripts ./web/scripts
# db/migrations/ برای اجرای migrationها در startup
COPY --from=builder --chown=next:nodejs /app/db ./db

# ساختِ volume برای آپلودها — در production باید روی volume جدا باشد
# تا با redeploy فایل‌ها از بین نروند
RUN mkdir -p /app/web/public/uploads && chown -R next:nodejs /app/web/public/uploads
VOLUME ["/app/web/public/uploads"]

USER next
WORKDIR /app/web
EXPOSE 3000

# healthcheck: هر ۳۰ ثانیه، تا ۳ بار شکست قبل از restart
# از /api/health استفاده می‌کنیم چون DB را هم چک می‌کند، نه فقط پورت را.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Next.js standalone mode (تا image سبک‌تر باشد) — ولی این پروژه از standalone
# استفاده نمی‌کند چون next.config.ts آن را فعال نکرده. پس next start استفاده می‌کنیم.
CMD ["npm", "run", "start"]
