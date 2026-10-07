# Unified personal pending work — 2026-10-07

The current OA workbench opens without a prominent personal inbox. Approvals, confirmations and personnel tasks already exist but their entry points are scattered; returned requests are absent from the unified total.

This production overlay adds a permanent “待我处理” entry, a matching banner on the workbench and approvals pages, and a mobile badge. All use the same total and `/#todos` destination. It retains existing personnel bill confirmation, reimbursement, dispute, approval and knowledge workflows, adds the applicant's returned requests/materials, pending member reviews for administrators, and assigned deliveries or evidence awaiting milestone acceptance. Existing APIs enforce permissions and perform actions.

The source baseline is `oa-people-20261007-v6`; it is newer than repository main. Apply this checked overlay to that production snapshot. Do not deploy the older repository root over the live application.

## Verification

- Two personal-scope and completed-state regression cases plus three existing work-item tests pass.
- Full TypeScript check and Aliyun production build pass.
- Isolated browser fixtures use synthetic member/admin identities on localhost only: 360/390 px mobile and 1440 px desktop; workbench and approval entry points, matching totals, personal scope, approval opening, deep-link reload, completion refresh, inaccessible review APIs for ordinary members, failed count displayed as unknown, and no horizontal overflow/JavaScript errors.
- Screenshots visually reviewed. No production business actions are submitted during tests.
- The existing people-workbench browser fixture is given its required nullable milestone field so the full typecheck passes.
- Release keeps previous immutable static chunks, with ownership verified for the service account, and supports automatic rollback.

## Apply

`python3 apply.py /path/to/production-source-copy`

Then run:

```sh
node --test tests/my-pending-items.test.mjs tests/project-work-items.test.mjs
npm run typecheck
npm run build:aliyun
```

The browser harness requires a candidate Next server at 127.0.0.1:3029, Playwright and Chromium. It intercepts all API calls using synthetic fixture data and refuses writes. It is not an authenticated production acceptance test.
