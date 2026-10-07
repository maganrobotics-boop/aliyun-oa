# OA source integration — 2026-10-07

The single development entry is `codex/oa-source-integration-20261007`.
This is a **repository integration baseline, not a production-equivalent release**.
Do not deploy its root, merge it into main, or trigger a deployment workflow until
the missing production source has been reconciled. Main currently auto-deploys
through `.github/workflows/deploy-aliyun.yml`; a main merge is not a source-only action.
No production services, records, settings or deployment workflows were changed here.

## Pinned input PRs

All refs below were read on 2026-10-07. Abbreviated SHAs identify the full commits
in repository history. Overlay manifests retain full SHA-256 hashes.

| PR | Base → head | Source scope | Integration disposition |
| --- | --- | --- | --- |
| [#1](https://github.com/maganrobotics-boop/aliyun-oa/pull/1) | main `8a0bffc` → account menu `4ca2ab3` | 2 commits; 4 source files: home, account menu, CSS, compact profile | Root source retained unchanged |
| [#2](https://github.com/maganrobotics-boop/aliyun-oa/pull/2) | #1 `4ca2ab3` → administrator review `ef5b69d` | 1 commit; approval route, administrator policy, home, 2 tests | Root source retained unchanged, after #1 |
| [#3](https://github.com/maganrobotics-boop/aliyun-oa/pull/3) | #2 `ef5b69d` → image overlay `211d3d4` | 4 bundle files; 7 target source/test files | Guarded bundle retained; not applied to root |
| [#4](https://github.com/maganrobotics-boop/aliyun-oa/pull/4) | main `8a0bffc` → PWA overlay `cb50c81` | 3 bundle files; 10 target files with complete after payloads | Bundle retained; not applied to root |
| [#5](https://github.com/maganrobotics-boop/aliyun-oa/pull/5) | main `8a0bffc` → pending overlay `b35e995` | 6 bundle files; 8 target files | Bundle and fixture evidence retained; not applied to root |

## Safe repository order and PR handling

1. Preserve #1 → #2 → #3 ancestry; combine #4 and #5 bundle-only changes.
   Their bundle paths are disjoint, so this integration has no textual conflicts.
   Original source and bundles are retained byte-for-byte.
2. Use one replacement Draft PR against main for this combined tree. Do not
   retarget old heads onto the combined branch: they would appear to remove the
   other integrated work. Do not sequentially merge #1–#5 into main.
3. After the replacement PR is verified, #1–#5 can all be closed as superseded.
   Keep their branches and original hashes for recovery. No old PR needs retargeting.
   Closing is reversible; it does not claim their overlays were applied to root.
4. All future reconciliation work goes into the integration branch. Only after a
   reviewed production-equivalent tree and separate release authorization should
   the replacement leave Draft status or target a deployable main merge.

## Production replay order — gated, not presently executable

Repository bundle integration is distinct from replaying production overlays.
The only supported chronological replay is:

| Stage | Required snapshot / evidence | Guard and action |
| --- | --- | --- |
| Image edit | `oa-pdf-layout-20261003-1006`, already containing the applicable account/admin changes | All 7 before hashes must match; then the original #3 applier can run on a disposable copy |
| Bridge to PWA | Complete source evolution from image result to `oa-pwa-20261006` | Not stored in these PRs; obtain source snapshots/diffs first |
| Safe PWA | `oa-pwa-20261006` | Original #4 verifier checks 10 files; its `--apply` is permitted only on the verified copy |
| Bridge to pending | Complete source evolution from safe PWA result to `oa-people-20261007-v6` | Not stored in these PRs; obtain source snapshots/diffs first |
| Unified pending | `oa-people-20261007-v6` | All 8 before hashes must match; original #5 applier only on the verified copy |

No target path overlaps between #3, #4 and #5. This means their manifests cannot
prove the missing bridges or a single complete production state. A clean cherry-pick
of the bundles is not proof that the app can be reconstructed or deployed.
Do not replay #1/#2 over newer production files: inspect their behavior and compare
against the snapshots first. They may already be incorporated with later changes.

## Exact current gaps

`hash-inventory-20261007.json` records all 25 target paths with full expected
before/after hashes and current root hashes. All three overlays are blocked.

| Overlay | Files needing unavailable before source or production reconciliation |
| --- | --- |
| Image | `lib/knowledge-store.ts`, `lib/knowledge-assets.ts`, `tests/knowledge-store.test.mjs` differ from both recorded hashes |
| PWA | `app/layout.tsx` differs; `components/oa-pwa.tsx`, `public/manifest.webmanifest`, `public/oa-sw.js` are missing despite non-null before hashes |
| Pending | `app/page.tsx`, `components/oa-eight-entry-navigation.tsx`, `components/project-workspace.tsx` differ; `app/people-workbench/page.tsx`, `tests/fixtures/people-workbench-browser.tsx` are missing despite non-null before hashes |

Other recorded before hashes match (including intentionally absent new files).
PWA provides all ten complete after payloads, but putting its production
`app/layout.tsx` into this older root could overwrite unrelated evolution. The
image/pending contextual diffs and hashes cannot recover unseen file regions.
New-file hunks remain recoverable inside their original patches; do not treat
isolated new files as a complete functioning feature.

The full snapshot requirement extends beyond these 12 mismatched/missing paths:
unchanged imports, APIs, migrations, config and unrecorded production features
must also come from the corresponding source snapshot, not guesses from main.
Obtain source-only snapshots and manifests, excluding secrets, databases,
uploads, node_modules, caches and build outputs. Alternatively a verified current
production source snapshot plus evidence tying each feature to its current files
can replace historical replay. This task did not access the live server.

## Read-only verification

```sh
python3 scripts/check-source-integration.py /path/to/source-copy
```

Exit 2 means at least one overlay is blocked. The checker validates embedded PWA
payload hashes, reports before/after/missing/mismatch states and performs no
writes or service actions. Mixed before/after states remain blocked because the
image and pending appliers require every before hash. Matching manifest paths
alone never proves full production equivalence.

Verification for this integration: #1/#2 source unchanged from #3 ancestry;
all 13 original bundle files unchanged from their PR heads; PWA payload hashes
verified; new-file patch payload hashes verified; mismatch guards on all original
appliers tested on disposable copies and left source files unchanged. Application
tests/build results in old PRs are historical evidence, not new integration runs.
Full app build and real feature acceptance remain pending production reconciliation.
