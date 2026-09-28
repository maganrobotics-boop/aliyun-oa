#!/usr/bin/env bash
set -euo pipefail

domain="${1:-omindos.cn}"
if [[ "${EUID}" -ne 0 || ! "${domain}" =~ ^[a-z0-9.-]+$ || "${domain}" == .* || "${domain}" == *. ]]; then
  echo "Usage: sudo bash deploy/aliyun/enable-https.sh [domain]" >&2
  exit 64
fi
command -v certbot >/dev/null || { echo "certbot is not installed." >&2; exit 69; }
certbot --nginx --non-interactive --agree-tos --redirect -d "${domain}" --register-unsafely-without-email
nginx -t
systemctl reload nginx
curl --fail --silent --show-error --max-time 20 "https://${domain}/api/session" >/dev/null
echo "HTTPS is active for ${domain}"
