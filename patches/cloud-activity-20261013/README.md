# Cloud activity in OA

Replaces the Future Stars arena activity tab with Cloud activity. Course progress and competition honors remain available. The existing arena API is retained for compatibility, but the new tab exclusively calls `view=cloud`.

Statistics use actual Cloud page visits and visible-page heartbeats. Accounts are deduplicated by Cloud identity; guests are deduplicated by a separate persistent browser cookie. The two counts are deliberately separate because a browser can subsequently log in. A 30-minute idle interval starts a new visit. Windows are rolling 24 hours, 3 days and 7 days. History before the recorded tracking start is unknown and is not backfilled from Arena, IP addresses, registrations or test fixtures.

## Installation

1. Stage `cloud_activity.py`, `cloud-activity.js` and a copy of the deployed `cloud_preview.py`. Apply `patch_cloud.py` to the staged server. Every source hook must match exactly once.
2. Provision the same random 64-character hexadecimal service key as `cloud-activity.key` in the Cloud data directory and as the OA server-only `CLOUD_ACTIVITY_TOKEN` environment binding. Restrict key files to mode 0600. Never commit keys.
3. Test the staged Cloud app using its production Python runtime, separate storage and synthetic accounts. Deploy the module, script and patched server together, then restart Cloud. Its separate activity SQLite database is created automatically. Existing accounts and robot files are not migrated.
4. Build OA using `npm run build:aliyun`, preserving the current release as a rollback target. Load the server-only token, switch to the new release and restart OA.

Cloud's `/v1/oa-activity` endpoint is read-only and requires the service key over TLS. OA first enforces the existing administrator and membership checks. Upstream failures produce an unavailable message rather than zero counts. The public heartbeat requires same-origin POST and has no robot-control effects. A statistics write failure is logged and does not block the workspace.

## Verification

- 7 Python tests: time-window boundaries, identity separation, deduplication, restart persistence, pagination/search, invalid input, service authentication and write-failure isolation.
- 4 Node tests exercise the real OA route and client with substituted identities/upstream transport: authorization, fixed upstream and private token, filter validation, unavailable/oversized responses.
- Aliyun TypeScript check and production Next build passed.
- Separate Cloud container: HEAD excluded; anonymous page and 3 heartbeats count once; authenticated account counted separately; cross-origin heartbeat and unauthenticated statistics denied.
- OA candidate homepage 200 and unauthenticated statistics 401.
- Production TLS bridge from Aliyun to Cloud returned the Cloud schema with private/no-store headers; unauthenticated access returned 401.
- Browser visual testing was attempted but the local Chromium process could not start in the execution environment. No live OA administrator browser session was used.

Production Cloud tracking began 2026-10-13 15:10 Beijing time. Isolated test data were not copied to production. The deployment preserves the previous OA release and original Cloud server for rollback.
