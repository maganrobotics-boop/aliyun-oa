# Student project release — 2026-10-11

The existing live service already includes the project-application overlay chain. Apply this scoped correction to an isolated copy of the current release; never replace the live source with a repository checkout. The current OA baseline includes PR #15 material intake and the Feishu/WeCom login features.

This patch enforces a student-number/semester unique index independently in learning and OA, rejects conflicting SZTU student mailbox numbers, and requires numbers on new OA course selections. Existing missing-number records can still supplement their identity under the same immutable approval. Existing duplicate groups must be checked before rollout; do not discard or rewrite student data.

Run `python3 patches/student-project-release-20261011-v6/apply.py <repository> <copied-release>` and verify the manifest hashes. OA must pass typecheck, production build, material/login regression and service-user preflight. Run OA `tests/student-project-release.test.mjs` with `PROJECT_APPLICATION_CHAT_ROOT` pointing to the candidate learning source.

Back up both SQLite databases consistently. Release OA before Chat. Keep the previous symlink targets and restore them if health checks fail. This release adds only indexes and does not backfill student scores, create graduation passes, or alter prior approvals.

Academic double-selection confirmation date: pending announcement; no date is inferred from the deployment.
