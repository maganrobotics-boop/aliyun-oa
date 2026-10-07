#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
domain="${2:-omindos.cn}"
if [[ "${EUID}" -ne 0 || ! -f "${archive}" || ! "${domain}" =~ ^[a-z0-9.-]+$ || "${domain}" == .* || "${domain}" == *. ]]; then
  echo "Usage: sudo bash deploy/aliyun/deploy.sh /absolute/source.tar.gz [domain]" >&2
  exit 64
fi

for command in node npm nginx systemctl tar runuser curl openssl python3; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 69; }
done
node -e "const [major,minor]=process.versions.node.split('.').map(Number); if (major<22 || (major===22 && minor<13)) process.exit(1)" \
  || { echo "Node.js 22.13 or newer is required." >&2; exit 69; }

app_root=/opt/originmind-oa
release_root="${app_root}/releases"
state_root=/var/lib/originmind-oa
cache_root=/var/cache/originmind-oa
config_root=/etc/originmind-oa
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
release_dir="${release_root}/${release_id}"
previous_target="$(readlink -f "${app_root}/current" 2>/dev/null || true)"

if ! id originmind-oa >/dev/null 2>&1; then
  useradd --system --home-dir "${state_root}" --shell /usr/sbin/nologin originmind-oa
fi
install -d -m 0755 -o root -g root "${app_root}" "${release_root}"
install -d -m 0700 -o originmind-oa -g originmind-oa "${state_root}" "${state_root}/assets" "${cache_root}"
install -d -m 0750 -o root -g originmind-oa "${config_root}"
install -d -m 0750 -o originmind-oa -g originmind-oa "${release_dir}"

cleanup_failed_release() {
  if [[ -d "${release_dir}" && "${release_dir}" == "${release_root}/"* ]]; then
    rm -rf -- "${release_dir}"
  fi
}
trap cleanup_failed_release ERR

tar -xzf "${archive}" -C "${release_dir}"
if [[ ! -f "${release_dir}/package.json" || ! -f "${release_dir}/package-lock.json" || ! -f "${release_dir}/deploy/aliyun/originmind-oa.service" ]]; then
  echo "Deployment archive is missing required project files." >&2
  exit 65
fi
chown -R originmind-oa:originmind-oa "${release_dir}"

if [[ ! -f "${config_root}/env" ]]; then
  install -m 0640 -o root -g originmind-oa "${release_dir}/.env.aliyun.example" "${config_root}/env"
  sed -i "s#^OA_PUBLIC_ORIGIN=.*#OA_PUBLIC_ORIGIN=https://${domain}#" "${config_root}/env"
fi

run_as_app() {
  runuser -u originmind-oa -- bash -lc "set -a; source '${config_root}/env'; set +a; cd '${release_dir}'; $*"
}

run_as_app "npm ci --no-audit --no-fund"
run_as_app "npm run migrate:aliyun"
run_as_app "NODE_OPTIONS=--max-old-space-size=1024 npm run build:aliyun"

standalone="${release_dir}/.next/standalone"
[[ -f "${standalone}/server.js" ]] || { echo "Next.js standalone server was not built." >&2; exit 65; }
cp -a "${release_dir}/public" "${standalone}/public"
install -d -m 0750 -o originmind-oa -g originmind-oa "${standalone}/.next"
cp -a "${release_dir}/.next/static" "${standalone}/.next/static"
rm -rf -- "${standalone}/.next/cache"
ln -s "${cache_root}" "${standalone}/.next/cache"

# Validate final packaged paths as the unit's intended identity before changing
# configuration, the current pointer, or any running service. Never repair here.
# On first install the unit is not registered yet; use the shipped User/Group.
runuser -u originmind-oa -g originmind-oa -- python3 - "${release_dir}" --layout standalone \
  < "$(dirname "${BASH_SOURCE[0]}")/preflight-release.py"

install -m 0644 "${release_dir}/deploy/aliyun/originmind-oa.service" /etc/systemd/system/originmind-oa.service
sed "s/__DOMAIN__/${domain}/g" "${release_dir}/deploy/aliyun/nginx.conf.template" > /etc/nginx/conf.d/originmind-oa.conf
nginx -t

ln -s "${release_dir}" "${app_root}/.current-${release_id}"
mv -Tf "${app_root}/.current-${release_id}" "${app_root}/current"
systemctl daemon-reload
systemctl enable --now originmind-oa.service
systemctl restart originmind-oa.service
nginx -s reload

if ! curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/api/session >/dev/null; then
  if [[ -n "${previous_target}" && "${previous_target}" == "${release_root}/"* && -d "${previous_target}" ]]; then
    ln -s "${previous_target}" "${app_root}/.rollback-${release_id}"
    mv -Tf "${app_root}/.rollback-${release_id}" "${app_root}/current"
    systemctl restart originmind-oa.service
  elif [[ "$(readlink -f "${app_root}/current" 2>/dev/null || true)" == "${release_dir}" ]]; then
    rm -f -- "${app_root}/current"
    systemctl stop originmind-oa.service || true
  fi
  echo "Health check failed; previous release was restored when available." >&2
  exit 70
fi

trap - ERR
echo "OriginMind OA release ${release_id} is healthy on http://127.0.0.1:3000"
echo "Environment: ${config_root}/env"
echo "Nginx domain: ${domain}"
