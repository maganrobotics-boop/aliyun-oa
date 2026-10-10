# Student project applications — 2026-10-11

Project work courses are directly accessible without an enrollment request. Joining a project requires a real recorded pass of the final Newbie Village level. The tutor collects student-provided grades, introduction, experience, project interest, availability and optional private attachments, then sends an authenticated snapshot of actual learning activity to the designated teacher’s native OA approval queue after student confirmation.

OA can approve and reply, selecting additional lessons for the applicant. Replies use a durable delivery record and an authenticated service bridge; failed synchronization remains pending and can be retried. Lesson grants do not fabricate submissions, scores or course completion. Student identity and progress are never accepted from browser-provided claims.

This patch targets the current Aliyun production source, which contains course and OA overlays outside the repository’s main baseline. New modules are stored at their runtime paths. `overlay.json` contains narrow line replacements and exact before/after SHA-256 hashes; the patcher rejects an unexpected target before writing. Apply to an isolated copy of the named release, typecheck/build OA, and verify both services before switching the release symlinks. Do not use a wholesale checkout of main to replace the live course source.

Apply: `python3 patches/project-applications-20261011-v1/apply-overlay.py <source-repository> <copied-release>`.

Validation: nine SQLite-backed integration tests pass, including the actual native immutable revision planner, real HMAC transport, final-level gate, cross-account isolation, lost-response idempotency, returned resubmission, selective grants and pending delivery retry. OA TypeScript check and Aliyun production build pass. Browser checks pass for direct project coursework before final-level completion, enrollment gating, explicit confirmation, individual grants and a 390px mobile viewport. All fixtures use isolated synthetic accounts and databases.
