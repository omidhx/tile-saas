#!/bin/bash
# چک‌هایی که نمی‌توانند شکست بخورند را رد می‌کند، و فقط .sh اجرایی باشد (جلوی نوسان file-mode).
# ممیزی نشان داد CI مرحله‌ی RLS داشت که با `|| echo` هرگز قرمز نمی‌شد.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PATTERN='\|\|[[:space:]]*(echo|printf|true|:)([[:space:]]|$)|;[[:space:]]*(true|:)[[:space:]]*$|\|[[:space:]]*tee\b|continue-on-error|SKIP_ROLE_CHECK|\bWARN\b|set \+e\b|set \+o errexit|exit 0|if:[[:space:]]*(false|always)'

# خود الگو باید کار کند؛ اگر کسی آن را خراب کند این‌جا می‌فهمیم
for bad in 'psql -c x || echo skipped' 'npm test || true' 'continue-on-error: true' 'SKIP_ROLE_CHECK: "1"' 'echo "WARN: x"' 'set +e' 'exit 0' 'x || printf y' 'x; true' 'x | tee y.log' 'set +o errexit' 'if: false' 'if: always()'; do
  if ! grep -qE "$PATTERN" <<<"$bad"; then echo "lint-ci خراب است: «$bad» را نگرفت" >&2; exit 1; fi
done

status=0
if grep -nE "$PATTERN" .github/workflows/*.yml; then
  echo "FAIL: الگوی بالا یعنی این مرحله نمی‌تواند شکست بخورد." >&2
  status=1
fi

wrong_modes="$(git ls-files -s | awk '($1=="100755" && $4 !~ /\.sh$/) || ($1=="100644" && $4 ~ /\.sh$/) {print $4}')"
if [ -n "$wrong_modes" ]; then
  echo "FAIL: فقط فایل‌های .sh باید اجرایی باشند (git update-index --chmod):" >&2
  echo "$wrong_modes" >&2
  status=1
fi

exit "$status"
