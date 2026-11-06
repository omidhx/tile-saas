#!/bin/bash
# یک فایل برای سرور ایران می‌سازد: ایمیج اپ، Postgres و Caddy به‌همراه فایل‌های اجرا.
# Docker Hub و npm از داخل ایران پایدار نیستند، پس سرور هیچ‌چیز را دانلود نمی‌کند.
# این اسکریپت جایی اجرا می‌شود که Docker به اینترنت می‌رسد. مراحل نصب: docs/GO_LIVE.md
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# docker build از پوشه‌ی فعلی می‌سازد؛ تغییر commit‌نشده با برچسب HEAD به سرور می‌رفت.
if [ -n "$(git status --porcelain -- web db scripts Dockerfile .dockerignore docker-compose.yml Caddyfile)" ]; then
  echo "ERROR: تغییر commit‌نشده هست. فایل نصب فقط از commit ساخته می‌شود." >&2
  git status --short -- web db scripts Dockerfile .dockerignore docker-compose.yml Caddyfile >&2
  exit 1
fi
tag="${1:-$(git rev-parse --short HEAD)}"
out="tile-saas-${tag}.tar"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

docker build -t "tile-saas:${tag}" .
docker pull postgres:16-alpine
docker pull caddy:2-alpine
docker save "tile-saas:${tag}" postgres:16-alpine caddy:2-alpine | gzip > "$work/images.tar.gz"

# فقط فایل‌هایی که روی سرور لازم است. HEAD یعنی چیز commit‌نشده به سرور نمی‌رود.
mkdir "$work/tile-saas"
git archive HEAD docker-compose.yml Caddyfile .env.example scripts backups docs/GO_LIVE.md | tar -x -C "$work/tile-saas"
echo "$tag" > "$work/tile-saas/IMAGE_TAG"
tar -cf "$out" -C "$work" images.tar.gz tile-saas

ls -lh "$out"
sha256sum "$out"
