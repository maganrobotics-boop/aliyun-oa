# Administrator image edit save hotfix

Editing approved knowledge with embedded images returned HTTP 500: the direct
editor reused a UNIQUE storage key and inserted assets into an active revision,
violating the production pending-revision trigger.

The patch copies original bytes to distinct revision keys, verifies SHA-256,
and stages then activates the replacement in one SQLite/D1 transaction.
Approval, visibility, ownership, prior revisions and retrieval behavior are retained.
On copy, authorization or transaction failure, only unreferenced objects owned
by that edit are removed. Aliyun filesystem and OSS adapters implement deletion
for that cleanup.

This is a production overlay for oa-pdf-layout-20261003-1006. Production contains
changes that have not yet been reconciled into the repository's administrator
approval branch. Apply this overlay to the recorded production source; do not
replace production with the older repository tree.

## Apply to the production source snapshot

Run `python3 apply.py /path/to/production-source` from this directory.
The script validates all seven source hashes and checks the complete patch before
writing. It does not migrate schemas, change production records or restart services.
Run tests, typecheck and the Aliyun build before releasing.

## Verification

- Before fix: real edit API returned 500 for an approved public item with 13 images.
- After fix: 109 related tests passed (0 failed, 0 skipped).
- Tests use all real Drizzle migrations, production trigger fixtures, the actual
  NodeD1Database transaction adapter and synthetic records in temporary SQLite.
- Real filesystem bucket verifies immutable bytes and failed-save cleanup.
- Includes pending edits, permission revocation during copying, audit rollback
  and interrupted storage acknowledgements.
- Typecheck and production Aliyun build passed.
- No production business records were edited as tests.
- Authenticated browser saving was not exercised.

Validation command:

```sh
node --test --test-concurrency=1 tests/knowledge-admin-edit-images.test.mjs tests/knowledge-admin-edit-api.test.mjs tests/knowledge-store.test.mjs tests/knowledge-asset-upload.test.mjs tests/knowledge-api-access.test.mjs tests/knowledge-batch-visibility.test.mjs tests/oa-knowledge-package.test.mjs
npm run typecheck
npm run build:aliyun
```
