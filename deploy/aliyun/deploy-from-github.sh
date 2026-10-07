#!/usr/bin/env bash
# OA-only recovery of /opt/omindos-deploy/bin/deploy-from-github.sh,
# inspected 2026-10-07. Installing this script is a separate reviewed operation.
set -euo pipefail
APP="${1:?oa}"; SHA="${2:?commit sha}"
[[ "$APP" == oa && "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected oa and an exact commit SHA' >&2; exit 64; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=originmind-oa
URL=https://oa.omindos.cn/
LINK=/opt/omindos-deploy/oa-current
SERVER=aliyun/oa-server.mjs
FALLBACK=/opt/omindos-deploy/releases/oa-library-filters-20261001-topqg6bh
PREVIEW_PORT=3099
REL="/opt/omindos-deploy/releases/oa-${SHA:0:12}"
PREV=""
if [ -L "$LINK" ]; then PREV="$(readlink -f "$LINK" 2>/dev/null || true)"; fi
if [ -z "$PREV" ] || [ "$PREV" = "$LINK" ] || [ ! -f "$PREV/package.json" ]; then PREV="$(readlink -f "$FALLBACK")"; fi
if [ ! -d "$REL/.git" ] || [ ! -f "$REL/package.json" ]; then
  rm -rf "$REL"; mkdir -p "$REL"
  git clone --filter=blob:none --no-checkout https://github.com/maganrobotics-boop/aliyun-oa.git "$REL"
  git -C "$REL" checkout "$SHA"
fi
cd "$REL"
npm run install:ci
npm run build:aliyun

SERVICE_USER="$(systemctl show "$SERVICE.service" --property=User --value)"
SERVICE_GROUP="$(systemctl show "$SERVICE.service" --property=Group --value)"
[[ -n "$SERVICE_USER" && "$(id -u "$SERVICE_USER")" != 0 ]] || { echo 'Expected non-root service User' >&2; exit 65; }
if [[ -z "$SERVICE_GROUP" ]]; then SERVICE_GROUP="$(id -gn "$SERVICE_USER")"; fi
SUPPLEMENTARY="$(systemctl show "$SERVICE.service" --property=SupplementaryGroups --value)"
read -r -a SERVICE_GROUPS <<< "$(id -Gn "$SERVICE_USER") $SUPPLEMENTARY"
GROUP_ARGS=()
for group in "${SERVICE_GROUPS[@]}"; do GROUP_ARGS+=(-G "$group"); done
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$REL"
bash "$SCRIPT_DIR/preflight-release.sh" "$REL" "$SERVICE.service" proxy

PREVIEW_LOG=/tmp/omindos-oa-preview.log
# The previous root preview concealed access failures. Use the effective unit user.
runuser -u "$SERVICE_USER" -g "$SERVICE_GROUP" "${GROUP_ARGS[@]}" -- env \
  PORT="$PREVIEW_PORT" OA_PUBLIC_ORIGIN=https://oa.omindos.cn \
  node "$REL/$SERVER" >"$PREVIEW_LOG" 2>&1 &
PREVIEW_PID=$!
cleanup_preview(){ kill "$PREVIEW_PID" 2>/dev/null || true; wait "$PREVIEW_PID" 2>/dev/null || true; }
trap cleanup_preview EXIT
READY=0
for _ in $(seq 1 20); do
  curl -fsS --max-time 3 -o /dev/null -H 'Host: oa.omindos.cn' \
    -H 'X-Forwarded-Host: oa.omindos.cn' -H 'X-Forwarded-Proto: https' \
    "http://127.0.0.1:$PREVIEW_PORT/" && READY=1 && break
  sleep 1
done
if [ "$READY" != 1 ]; then cat "$PREVIEW_LOG" >&2; exit 1; fi
cleanup_preview
trap - EXIT
# Last gate after packaging/preview, immediately before pointer/config mutations.
bash "$SCRIPT_DIR/preflight-release.sh" "$REL" "$SERVICE.service" proxy
ln -sfn "$REL" "$LINK"
mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
cat >"/etc/systemd/system/${SERVICE}.service.d/zzzzzzzzzz-github-deploy.conf" <<EOF
[Service]
WorkingDirectory=$LINK
ExecStart=
ExecStart=/usr/local/bin/node $LINK/$SERVER
EOF
systemctl daemon-reload
systemctl restart "$SERVICE"
if ! curl -fsS --retry 8 --retry-delay 2 --max-time 10 -o /dev/null "$URL"; then
  echo "health check failed; rolling back to $PREV" >&2
  ln -sfn "$PREV" "$LINK"
  systemctl restart "$SERVICE"
  curl -fsS --retry 8 --retry-delay 2 --max-time 10 -o /dev/null "$URL"
  exit 1
fi
echo "deployed oa $SHA"
