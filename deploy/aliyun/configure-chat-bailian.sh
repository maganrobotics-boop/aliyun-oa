#!/usr/bin/env bash
set -euo pipefail

config=/etc/originmind-chat/env
app_root=/opt/originmind-oa/current
state_root=/var/lib/originmind-chat
if [[ "${EUID}" -ne 0 || ! -f "${config}" || ! -f "${app_root}/aliyun/configure-chat-bailian.mjs" ]]; then
  echo "Run as root after OriginMind Chat has been installed." >&2
  exit 64
fi

read -rsp "请输入百炼 API Key（输入不可见）: " api_key </dev/tty
printf '\n' >/dev/tty
if [[ ! "${api_key}" =~ ^sk-[A-Za-z0-9._-]{16,}$ ]]; then
  unset api_key
  echo "百炼 API Key 格式不正确。" >&2
  exit 65
fi

secret_file="$(mktemp "${state_root}/bailian-key.XXXXXX")"
trap 'rm -f -- "${secret_file}"' EXIT
chown originmind-chat:originmind-chat "${secret_file}"
chmod 0600 "${secret_file}"
printf '%s' "${api_key}" > "${secret_file}"
unset api_key

runuser -u originmind-chat -- bash -c \
  'set -a; source /etc/originmind-chat/env; set +a; export BAILIAN_KEY_FILE="$1"; exec node "$2"' \
  _ "${secret_file}" "${app_root}/aliyun/configure-chat-bailian.mjs"

rm -f -- "${secret_file}"
trap - EXIT
systemctl restart originmind-chat.service
echo "Chat 已重启；模型状态可在 /api/status 检查。"
