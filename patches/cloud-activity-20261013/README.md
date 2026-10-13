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
- At initial deployment, the local Chromium process could not start and no live OA administrator browser session was used. The final browser acceptance below supersedes that initial evidence limit.

Production Cloud tracking began 2026-10-13 15:10 Beijing time. Isolated test data were not copied to production. The deployment preserves the previous OA release and original Cloud server for rollback.

## Final administrator browser acceptance — 2026-10-13

A real signed-in OA administrator session was verified in the desktop cloud browser after manual handoff. The live page is https://oa.omindos.cn/#future-stars (select **Cloud 上线统计**).

The following browser flows passed: the 24-hour, 3-day and 7-day selectors; account/guest filters; visits sort; exact guest search and no-match empty state; tracking-start and no-history explanation; latest-seen display; current one-page disabled pagination; genuine Cloud guest visit and reload deduplication; statistics refresh; controlled 503 messaging and retry recovery; course statistics; competition awards list and empty registration form; honors list; read-only approval, knowledge-library and internal-chat entry loading.

- Tracking metadata and the live page agree on 2026-10-13 15:10:03 Beijing time (epoch milliseconds 1791875403744). No visits precede that tracking start.
- Snapshot at 16:35:43: all three Cloud windows showed 0 accounts and 8 guest browser identifiers. Every window only covers data accumulated since tracking began; this is not seven days of historical coverage.
- The same genuine guest browser remained one visit after reload. Its last-seen display advanced from 16:25:42 to 16:26:21 while the list remained at 7 identifiers during that check. Later live snapshots reached 8 identifiers.
- Course snapshot at 16:27:41 showed 7 / 16 / 21 learners for 24h / 3d / 7d, 3 learners with new progress and 5 new task submissions. Honors management returned 3 entries; the knowledge library loaded 320 records.
- A temporary reverse-proxy 503 response matched only the unique acceptance search query and Cloud view. The production UI cleared its numbers to em dashes, displayed the unavailable message, and offered retry. After removal, retry returned live data. The original Nginx configuration was restored byte-for-byte at 16:22:37; a timed cleanup safeguard was also removed. This was fault injection, not an observed Cloud outage.
- Current source passed 7 Python activity tests, 4 OA route/client tests, 36 existing WeCom/unified-QR tests, and service-user TypeScript checking. Existing production-build receipts and browser delivery were retained; this source archive does not require a new application release.

### Explicit evidence limits

A real ordinary-member browser session was not available: anonymous production reads were rejected with 401 and automated substituted non-admin actors returned 403, but a real non-admin session is **not accepted**. Real Cloud account deduplication / guest-to-account transition is **not accepted** because the observed live records were guests. True multi-page Cloud browsing is **not accepted** because there were fewer than 20 records; disabled one-page buttons and the existing 25-identity pagination test passed. Awards submissions, approval mutations, full AI inference and real-phone statistics layouts were outside the read-only browser regression coverage.

The first mobile QR confirmations did not establish this browser's session. Manual handoff established a verified administrator session. The earlier session-synchronization cause was not established; no authentication bypass was used.

## Production source reconciliation

The deployed feature files matched the original PR head `f7c2256e7d7e6d2e70b01bd79b3755626a2c3a13`. A broader inventory of 358 tracked runtime source files found 350 matches and the following 8 pre-existing production differences. Archiving only the statistics patch would therefore leave main behind the running OA.

The six AI presentation/factual-grounding changes were already deployed in `oa-ai-facts-20261012-v1` and recorded in the 2026-10-12 release verification. The two controlled WeCom-diagnostic source files exactly match the already-deployed PR #14 head `4f6a49f1ed7fca85f15e610ceb0a0d8817360af0`. The diagnostic test increments from that PR are applied to current main's QR/WeCom tests, preserving the later in-app login cases. The original PR #14 draft and branch retain their own history.

| Already-deployed file | Live Git blob SHA |
| --- | --- |
| app/api/auth/qr/_lib/service.ts | a0aa36ecd8cc49d4dd9b518d161849b41ca3bc14 |
| app/guide/page.tsx | 0df785164e64be7606636b51cb24ae98862a2bb1 |
| app/page.tsx | c6888bef5e5f8543fce1731c5d5d7b131a23244c |
| components/ai-member-directory.tsx | f778e8269043502313d09f9e1b78d97846f02e34 |
| components/knowledge/knowledge-view.tsx | 0bd41451713443990d06d74a6c6c5adff96f00c9 |
| components/knowledge/oa-chat-panel.tsx | 97b6d6539d8980f07f4a4e6afdada2f21c8a7b2d |
| lib/lab-ai-client.ts | 3ad02f2529a5fa36e5a8149faab37dfeebcc79fc |
| lib/wecom-oauth.ts | 977ff38ed01eaa0ed808aa7f10b25505dc3cef7c |

The archive preserves those bytes, authentication/membership guards and the deployed statistics implementation. Production stays on `oa-cloud-activity-20261013-v1`; the previous `oa-ai-facts-20261012-v1` and original Cloud server remain rollback targets. A new source commit is metadata/code archival, not another production deployment. Merge-to-production workflows are manual.

No service keys, cookies, authorization codes, business databases, uploaded documents or synthetic activity history are committed. The checked runtime-file inventory is the scope of source equality; deployment configuration and untracked runtime integrations retain their existing separate release provenance.

## CI status and remaining repository maintenance

The attachment-lifecycle workflow passed. The broad material-intake workflow initially scanned detached historical TypeScript fragments under `patches/project-applications-20261011-v1/modules/` and failed their intentionally context-dependent relative imports. Application type checking now excludes `patches`; live production has no such detached archive fragments in its compilation tree.

The existing OA Chat browser-parity workflow failed while waiting for the legacy `.collaboration-workspace` selector. The same failure is evidenced on PR #16's prior head `55492a052159b8e896802faecb8f5032b8e5a96c` (run 38186763782, 2026-10-12), as well as the original statistics head. This legacy Chat fixture suite is not accepted as passed by the administrator's statistics checks. Updating the fixture to the current collaboration entry/layout remains separate repository maintenance.
