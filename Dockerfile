# ایمیج اپ و workerها. روی VPS ایران بیلد نمی‌شود: scripts/release.sh آن را همراه
# Postgres و Caddy در یک فایل می‌گذارد و سرور فقط docker load می‌کند (docs/GO_LIVE.md).
#
# خروجی standalone: فقط فایل‌هایی که سرور واقعاً لازم دارد، نه کل node_modules.
# workerها و migrate با esbuild به یک فایل تبدیل می‌شوند، پس tsx و src داخل ایمیج نیست.

FROM node:22-alpine AS build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY web/package.json web/package-lock.json ./
# xlsx از vendor نصب می‌شود، نه از cdn.sheetjs.com
COPY web/vendor ./vendor
RUN npm ci
COPY web/ ./
RUN npm run build && npm run build:scripts

FROM node:22-alpine AS runner
# bash و GNU tar برای scripts/backup-uploads.sh که با docker exec داخل web اجرا می‌شود
RUN apk add --no-cache bash tar && addgroup -g 1001 -S nodejs && adduser -S next -u 1001 -G nodejs
WORKDIR /app/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
# فهرست سفید: tracer چون process.cwd() می‌بیند کل پروژه (src، e2e و غیره) را هم در standalone می‌ریزد.
COPY --from=build --chown=next:nodejs /app/web/.next/standalone/server.js /app/web/.next/standalone/package.json ./
COPY --from=build --chown=next:nodejs /app/web/.next/standalone/node_modules ./node_modules
COPY --from=build --chown=next:nodejs /app/web/.next/standalone/.next ./.next
COPY --from=build --chown=next:nodejs /app/web/.next/static ./.next/static
COPY --from=build --chown=next:nodejs /app/web/public ./public
COPY --from=build --chown=next:nodejs /app/web/dist-scripts ./dist-scripts
COPY --chown=next:nodejs db/ /app/db/
# volume آپلودها در compose است؛ مالکیت پوشه را volume تازه از همین‌جا می‌گیرد.
RUN install -d -o next -g nodejs /app/web/private/uploads
USER next
EXPOSE 3000
CMD ["node", "server.js"]
