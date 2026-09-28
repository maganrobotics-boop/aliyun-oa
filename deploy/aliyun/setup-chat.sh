#!/usr/bin/env bash
set -euo pipefail

public_origin="${1:-http://39.108.50.65:8080}"
app_root=/opt/originmind-oa/current
oa_env=/etc/originmind-oa/env
chat_config_root=/etc/originmind-chat
chat_env="${chat_config_root}/env"
chat_state=/var/lib/originmind-chat

if [[ "${EUID}" -ne 0 || ! -d "${app_root}/chat-cloudflare/public" || ! -f "${oa_env}" ]]; then
  echo "Run as root after OriginMind OA has been deployed." >&2
  exit 64
fi
node -e 'const u=new URL(process.argv[1]); if(u.origin!==process.argv[1]||u.protocol!=="http:"||!/^\d+(?:\.\d+){3}$/.test(u.hostname))process.exit(1)' "${public_origin}" \
  || { echo "Temporary Chat origin must be an exact HTTP IPv4 origin." >&2; exit 64; }

for command in node nginx systemctl openssl runuser; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 69; }
done

if ! id originmind-chat >/dev/null 2>&1; then
  useradd --system --home-dir "${chat_state}" --shell /usr/sbin/nologin originmind-chat
fi
usermod -a -G originmind-oa originmind-chat
install -d -m 0700 -o originmind-chat -g originmind-chat "${chat_state}"
install -d -m 0750 -o root -g originmind-chat "${chat_config_root}"

env_value() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  sed -n "s/^${key}=//p" "${file}" 2>/dev/null | tail -n 1
}

set_env_value() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "${file}"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

public_token="$(env_value "${oa_env}" PUBLIC_LAB_AI_SERVICE_TOKEN)"
restart_oa=0
if [[ ! "${public_token}" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  public_token="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  set_env_value "${oa_env}" PUBLIC_LAB_AI_SERVICE_TOKEN "${public_token}"
  restart_oa=1
fi
if [[ "$(env_value "${oa_env}" OA_CHAT_SERVICE_ORIGIN)" != "http://127.0.0.1:3001" ]]; then
  set_env_value "${oa_env}" OA_CHAT_SERVICE_ORIGIN "http://127.0.0.1:3001"
  restart_oa=1
fi
chown root:originmind-oa "${oa_env}"
chmod 0640 "${oa_env}"
if [[ "${restart_oa}" -eq 1 ]]; then
  systemctl restart originmind-oa.service
fi

encryption_key="$(env_value "${chat_env}" APP_ENCRYPTION_KEY)"
rate_key="$(env_value "${chat_env}" RATE_LIMIT_HMAC_KEY)"
[[ "${#encryption_key}" -ge 40 ]] || encryption_key="$(openssl rand -base64 48 | tr -d '\n')"
[[ "${#rate_key}" -ge 32 ]] || rate_key="$(openssl rand -base64 32 | tr -d '\n')"

temporary_env="$(mktemp "${chat_config_root}/env.XXXXXX")"
trap 'rm -f -- "${temporary_env}"' EXIT
printf '%s\n' \
  'CHAT_HOST=127.0.0.1' \
  'CHAT_PORT=3001' \
  "CHAT_SQLITE_PATH=${chat_state}/chat.sqlite" \
  "APP_ORIGIN=${public_origin}" \
  'ALLOW_INSECURE_IP_ORIGIN=1' \
  'ADMIN_EMAIL=administrator@omindos.cn' \
  "APP_ENCRYPTION_KEY=${encryption_key}" \
  "RATE_LIMIT_HMAC_KEY=${rate_key}" \
  "PUBLIC_LAB_AI_SERVICE_TOKEN=${public_token}" \
  'OA_LOCAL_PORT=3000' \
  "RELEASE_ID=aliyun-$(date -u +%Y%m%dT%H%M%SZ)" \
  'EMAIL_CODE_FROM=magan@sztu.edu.cn' \
  > "${temporary_env}"
install -m 0640 -o root -g originmind-chat "${temporary_env}" "${chat_env}"
rm -f -- "${temporary_env}"
trap - EXIT

install -m 0644 "${app_root}/deploy/aliyun/originmind-chat.service" /etc/systemd/system/originmind-chat.service
runuser -u originmind-chat -- env CHAT_SQLITE_PATH="${chat_state}/chat.sqlite" node "${app_root}/aliyun/chat-migrate.mjs"

if [[ -L /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi
if [[ -L /etc/nginx/sites-enabled/default.originmind-backup ]]; then
  rm -f /etc/nginx/sites-enabled/default.originmind-backup
fi
install -m 0644 "${app_root}/deploy/aliyun/nginx-services.conf.template" /etc/nginx/conf.d/originmind-services.conf
rm -f /etc/nginx/conf.d/originmind-oa.conf
nginx -t

systemctl daemon-reload
systemctl enable --now originmind-chat.service
systemctl restart originmind-chat.service
systemctl reload nginx

for _ in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3001/_health >/dev/null; then
    echo "OriginMind Chat is healthy on ${public_origin}"
    exit 0
  fi
  sleep 1
done
echo "OriginMind Chat health check failed." >&2
exit 70
