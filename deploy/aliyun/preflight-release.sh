#!/usr/bin/env bash
set -euo pipefail
candidate="${1:?candidate release directory}"
service="${2:-originmind-oa.service}"
layout="${3:-proxy}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# systemctl show reads the effective unit, including drop-ins. No env/secrets read.
service_user="$(systemctl show "$service" --property=User --value)"
service_group="$(systemctl show "$service" --property=Group --value)"
if [[ -z "$service_user" || "$(id -u "$service_user")" == 0 ]]; then
  echo "Release preflight requires an explicit non-root systemd service User." >&2
  exit 65
fi
if [[ -z "$service_group" ]]; then service_group="$(id -gn "$service_user")"; fi
supplementary="$(systemctl show "$service" --property=SupplementaryGroups --value)"
read -r -a service_groups <<< "$(id -Gn "$service_user") $supplementary"
group_args=()
for group in "${service_groups[@]}"; do group_args+=(-G "$group"); done
# Feed trusted code via stdin so the gate itself need not live in the candidate.
# runuser initializes supplementary groups as well as uid/gid.
exec runuser -u "$service_user" -g "$service_group" "${group_args[@]}" -- \
  python3 - "$candidate" --layout "$layout" < "$script_dir/preflight-release.py"
