#!/bin/bash
# .env را با رمزهای تصادفی می‌سازد. استفاده: bash scripts/init-env.sh <دامنه یا IP>
# روی .env موجود چیزی نمی‌نویسد: رمز تازه یعنی دیتابیس و بکاپ‌های قبلی باز نمی‌شوند.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

domain="${1:?استفاده: bash scripts/init-env.sh <دامنه یا IP>}"
# این مقدار در .env با source خوانده می‌شود و داخل sed می‌رود.
if ! [[ "$domain" =~ ^[A-Za-z0-9.:-]+$ ]]; then
  echo "ERROR: دامنه یا IP نامعتبر: $domain" >&2
  exit 1
fi
if [ -e .env ]; then
  echo "ERROR: .env از قبل هست و عوض نشد." >&2
  exit 1
fi

secret() { openssl rand -hex 32; }
# فایل IMAGE_TAG را release.sh کنار فایل‌های نصب می‌گذارد.
tag="${IMAGE_TAG:-$(cat IMAGE_TAG 2>/dev/null || echo local)}"
umask 077
sed -e "s|^DOMAIN=.*|DOMAIN=${domain}|" \
    -e "s|^IMAGE_TAG=.*|IMAGE_TAG=${tag}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret)|" \
    -e "s|^APP_USER_PASSWORD=.*|APP_USER_PASSWORD=$(secret)|" \
    -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(secret)|" \
    -e "s|^BACKUP_GPG_PASSPHRASE=.*|BACKUP_GPG_PASSPHRASE=$(secret)|" \
    .env.example > .env
echo "✓ .env ساخته شد. یک کپی از آن را بیرون از سرور نگه دارید؛ بدون آن بکاپ‌ها باز نمی‌شوند."
