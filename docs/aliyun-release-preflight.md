# Aliyun release access gate (2026-10-07)

PR #5 reports the successful 10:37 CST release after a static-directory ownership failure and rollback. On 2026-10-07 we read the live deployment receipt and `/opt/omindos-deploy/transfers/deploy-oa-pending-20261007.py`: after preserving older immutable chunks it recursively chowns `.next/static` and walks that directory with the service uid/gid. This is a useful recovery, but does not open assets/manifests or validate symlink targets. PR #5's repository patch contains no deployment gate.

The live `/opt/omindos-deploy/bin/deploy-from-github.sh` previews as root before chown/switch. `deploy/aliyun/deploy-from-github.sh` recovers its OA path only, adding a service-identity preview and read-only permission gates before preview and immediately before switching. Chat remains outside this recovery's scope. The existing archive deployment entrypoint also checks the final standalone package before changing the pointer or service configuration. No business code, schema, records or migration behavior is changed.

## Read-only check

```sh
sudo bash deploy/aliyun/preflight-release.sh /absolute/candidate originmind-oa.service proxy
# For the archive deployment's .next/standalone package:
sudo bash deploy/aliyun/preflight-release.sh /absolute/candidate originmind-oa.service standalone
```

The wrapper reads effective systemd `User`, `Group` and `SupplementaryGroups`, including drop-ins, then uses `runuser` with that identity. Root/empty identities fail closed. The checker:

- Resolves the candidate and checks traversal on both the original path and resolved ancestry.
- Lists every static directory and opens every static file; requires JS and CSS output.
- Opens and parses required Next manifests, all additional top-level/server manifests and any public PWA manifest present. Older releases without a PWA manifest remain supported.
- Rejects missing artifacts, dangling/cyclic static links, links outside the candidate, and world-writable checked artifacts. Root ownership alone is acceptable when the effective service identity can read/traverse; uid/gid/mode appear in access diagnostics.
- Checks the actual proxy or packaged standalone runtime paths. It never chowns/chmods, switches pointers, restarts services, reads environment secrets or opens a business database.

Run after **all** asset retention/copying and explicit ownership preparation, before pointer/config changes or service restart. Keep the candidate unchanged after validation. This gate checks filesystem access, not the complete systemd mount/namespace sandbox or application health; existing preview/health checks still apply.

## Tests

```sh
sudo env PATH=/usr/sbin:/usr/bin:/sbin:/bin python3 tests/aliyun-release-preflight.test.py
```

The Linux root suite creates synthetic releases under `tempfile`, then invokes the checker as `nobody`. It reproduces root-owned `0700` static directories, service-owned directories lacking execute permission, unreadable assets/manifests, ancestor access failures, and bad links. It also proves a readable root-owned package passes without ownership/mode/mtime changes and covers standalone output and the systemd identity wrapper. Non-root execution covers permissions using the current uid, skipping two root-only cases; environments unable to change uid skip the identity suite. CI runs the full root suite. No fixture touches `/opt` or business data.

## Adoption boundary

This commit does **not** install or execute either release script on production. The current GitHub workflow invokes the host's script, which remains unchanged until a separately authorized adoption. Do not merge as a way to deploy: the existing main-push workflow deploys automatically and repository main is older than production. Do not replace the live source with repository main.

The recovered script is OA-only and cannot replace the shared OA/chat host entrypoint wholesale. At adoption, copy the helper pair to a trusted readable location and transplant the OA ownership/preflight/service-identity-preview lines into the existing host script, preserving its chat case. The PR #5 one-off overlay should likewise invoke the helper after retaining chunks and before `switch(target)`; its baseline hashes, rollback and immutable asset retention stay intact. No adoption happened during this task.
