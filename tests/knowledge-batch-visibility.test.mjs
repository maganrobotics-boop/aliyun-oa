import assert from "node:assert/strict";
import test, { beforeEach, after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const key = "__oaBatchVisibilityTests";
const id = n => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`;
const token = "publish_to_chat.omindos.ai";
const auth = (overrides = {}) => ({
  user: { email: "review@example.invalid", displayName: "审核人" }, role: "project_owner",
  isAdmin: false, ndaCompleted: true, memberId: "reviewer", accountUserId: "account",
  memberMutationRevision: "member-r1", ...overrides,
});
const item = (n = 1, overrides = {}) => ({
  id: id(n), status: "active", visibility: "internal", current_revision_id: id(n + 100),
  active_revision_id: id(n + 100), mutation_revision: "r1", submitter_member_id: "submitter",
  submitter_email: "submitter@example.invalid", ...overrides,
});
globalThis[key] = {};
const vite = await createServer({
  appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
  plugins: [{
    name: "batch-visibility-test-dependencies", enforce: "pre",
    resolveId(source) {
      if (source.endsWith("/_lib/auth")) return "\0bv-auth";
      if (source.endsWith("/knowledge-store")) return "\0bv-store";
      if (source.endsWith("/write-rate-limit")) return "\0bv-rate";
      if (/^(?:\.\.\/)+db$/u.test(source)) return "\0bv-db";
      return null;
    },
    load(name) {
      if (name === "\0bv-auth") return `
        export async function getAuthorizedUser() { return globalThis.${key}.authorized; }
        export function isProjectOwner() { return globalThis.${key}.configured; }
      `;
      if (name === "\0bv-rate") return `
        export async function consumeWriteRateLimit(db, options) {
          globalThis.${key}.rates.push(options); return globalThis.${key}.allowed;
        }
      `;
      if (name === "\0bv-db") return "export async function getDb() { return {}; }";
      if (name === "\0bv-store") return `
        export async function findKnowledgeItem(id, actor, reviewer) {
          globalThis.${key}.reads.push({ id, actor, reviewer }); return globalThis.${key}.items.find(item => item.id === id);
        }
        export async function setKnowledgeItemVisibility(existing, actor, visibility, publicConfirmation) {
          const state = globalThis.${key};
          state.writes.push({ id: existing.id, actor, visibility, publicConfirmation });
          if (state.throwAt === existing.id) throw new Error("simulated failure");
          if (state.nullAt === existing.id) return null;
          return { id: existing.id, visibility, mutationRevision: "r2", updatedAt: "2026-10-02T11:00:00Z" };
        }
      `;
      return null;
    },
  }],
});
const route = await vite.ssrLoadModule("/app/api/knowledge/batch-visibility/route.ts");
const policy = await vite.ssrLoadModule("/lib/knowledge-visibility-batch.ts");
const inputs = count => Array.from({ length: count }, (_, i) => ({ id: id(i + 1), mutationRevision: "r1" }));
const body = (count = 1, visibility = "public") => ({
  items: inputs(count), visibility, ...(visibility === "public" ? { publicConfirmation: token } : {}),
});
const request = (value = body(), headers = {}) => new Request("https://oa.example.test/api/knowledge/batch-visibility", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value),
});
const state = () => globalThis[key];
beforeEach(() => { globalThis[key] = { authorized: auth(), items: [item(1), item(2), item(3)],
  reads: [], writes: [], rates: [], allowed: true, configured: false }; });
after(async () => { await vite.close(); delete globalThis[key]; });

test("batch visibility requires registration, NDA, exact member binding and reviewer role before reading or writing", async () => {
  for (const authorized of [null, auth({ ndaCompleted: false }), auth({ memberId: null }),
    auth({ accountUserId: null }), auth({ memberMutationRevision: null }), auth({ role: "member" })]) {
    state().authorized = authorized;
    const response = await route.POST(request());
    assert.equal(response.status, authorized ? 403 : 401);
    assert.match(response.headers.get("cache-control"), /no-store/u);
  }
  assert.equal(state().reads.length, 0); assert.equal(state().writes.length, 0); assert.equal(state().rates.length, 0);
});

test("cross-site and non-JSON batch changes are rejected", async () => {
  assert.equal((await route.POST(request(body(), { origin: "https://attacker.invalid" }))).status, 403);
  assert.equal((await route.POST(request(body(), { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await route.POST(request(body(), { "content-type": "text/plain" }))).status, 415);
  assert.equal(state().writes.length, 0);
});

test("public batch cannot write without exact confirmation and internal changes cannot include it", async () => {
  for (const publicConfirmation of [undefined, "", token + " ", token.toUpperCase(), true]) {
    assert.equal((await route.POST(request({ ...body(), publicConfirmation }))).status, 400);
  }
  assert.equal((await route.POST(request({ ...body(1, "internal"), publicConfirmation: token }))).status, 400);
  assert.equal(state().reads.length, 0); assert.equal(state().writes.length, 0);
});

test("bounded unique UUID selections and strict bodies are validated before consuming rate budget", async () => {
  for (const value of [
    { ...body(), unexpected: true }, { ...body(), items: [] }, body(21),
    { ...body(), items: [inputs(1)[0], { ...inputs(1)[0], id: id(1).toUpperCase() }] },
    { ...body(), items: [{ id: "../all", mutationRevision: "r1" }] },
    { ...body(), items: [{ id: id(1), mutationRevision: "" }] },
    { ...body(), items: [{ id: id(1), mutationRevision: "x".repeat(129) }] },
    { ...body(), items: [{ ...inputs(1)[0], canSetVisibility: true }] }, { ...body(), visibility: "all" },
  ]) assert.equal((await route.POST(request(value))).status, 400);
  assert.equal(state().rates.length, 0); assert.equal(state().writes.length, 0);
});

test("public batch changes only selected items and carries actor/revision confirmation through existing audited writes", async () => {
  state().configured = true;
  const response = await route.POST(request(body(2), { origin: "https://oa.example.test" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.changed.map(row => row.id), [id(1), id(2)]); assert.deepEqual(result.failed, []);
  assert.deepEqual(state().reads.map(row => row.id), [id(1), id(2)]);
  assert.ok(state().reads.every(row => row.reviewer === true));
  assert.ok(state().writes.every(row => row.visibility === "public" && row.publicConfirmation === token && row.actor.configuredReviewer));
  assert.deepEqual(state().rates, [{ actorSubject: "account", scope: "knowledge_review", limit: 20 }]);
  assert.ok(result.changed.every(row => row.mutationRevision === "r2"));
});

test("public to internal batch omits public confirmation and does not change content or approval status", async () => {
  state().items = [item(1, { visibility: "public" }), item(2, { visibility: "public" })];
  const result = await (await route.POST(request(body(2, "internal")))).json();
  assert.equal(result.changed.length, 2);
  assert.ok(state().writes.every(row => row.visibility === "internal" && row.publicConfirmation === undefined));
  assert.ok(!Object.hasOwn(result.changed[0], "content") && !Object.hasOwn(result.changed[0], "status"));
});

test("mixed stale, pending, retired, unactivated and missing items fail individually without publishing them", async () => {
  state().items = [item(1), item(2, { mutation_revision: "r-new" }), item(3, { status: "pending" }),
    item(4, { status: "revoked" }), item(5, { active_revision_id: id(999) }), item(6, { is_deleted: 1 })];
  const result = await (await route.POST(request(body(7)))).json();
  assert.deepEqual(result.changed.map(row => row.id), [id(1)]);
  assert.deepEqual(result.failed.map(row => row.id), [id(2), id(3), id(4), id(5), id(6), id(7)]);
  assert.deepEqual(state().writes.map(row => row.id), [id(1)]);
});

test("project owner cannot publish own or partially overlapping identity; administrator may manage only exact own identity", async () => {
  state().items = [
    item(1, { submitter_member_id: "reviewer", submitter_email: "review@example.invalid" }),
    item(2, { submitter_member_id: "reviewer" }), item(3, { submitter_email: "REVIEW@example.invalid" }),
  ];
  let result = await (await route.POST(request(body(3)))).json();
  assert.equal(result.changed.length, 0); assert.equal(result.failed.length, 3); assert.equal(state().writes.length, 0);
  state().authorized = auth({ role: "member", isAdmin: true });
  result = await (await route.POST(request(body(3)))).json();
  assert.deepEqual(result.changed.map(row => row.id), [id(1)]);
  assert.deepEqual(result.failed.map(row => row.id), [id(2), id(3)]);
  assert.equal(state().writes.length, 1); assert.equal(state().writes[0].actor.isAdmin, true);
});

test("unchanged target and SQL revision/permission guard failures are reported individually", async () => {
  state().items = [item(1, { visibility: "public" }), item(2), item(3)];
  state().nullAt = id(2);
  const result = await (await route.POST(request(body(3)))).json();
  assert.deepEqual(result.changed.map(row => row.id), [id(3)]);
  assert.deepEqual(result.failed.map(row => row.id), [id(1), id(2)]);
  assert.deepEqual(state().writes.map(row => row.id), [id(2), id(3)]);
});

test("batch rate denial stops before database item access", async () => {
  state().allowed = false;
  const response = await route.POST(request());
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(state().reads.length, 0); assert.equal(state().writes.length, 0);
});

test("an uncertain write preserves earlier successes and stops the rest of the batch", async () => {
  state().throwAt = id(2);
  const result = await (await route.POST(request(body(3)))).json();
  assert.deepEqual(result.changed.map(row => row.id), [id(1)]);
  assert.deepEqual(result.failed.map(row => row.id), [id(2), id(3)]);
  assert.equal(result.stopped, true);
  assert.deepEqual(state().reads.map(row => row.id), [id(1), id(2)]);
});

test("client eligibility excludes pending, revoked, unactivated, forbidden and already-target knowledge", () => {
  const active = { id: id(1), status: "active", visibility: "internal", mutationRevision: "r1",
    currentRevisionId: id(101), activeRevisionId: id(101), canSetVisibility: true };
  assert.ok(policy.canBatchSetKnowledgeVisibility(active, "public"));
  for (const overrides of [{ status: "pending" }, { status: "revoked" }, { visibility: "public" },
    { activeRevisionId: id(102) }, { canSetVisibility: false }, { canSetVisibility: undefined }, { mutationRevision: "" }])
    assert.equal(policy.canBatchSetKnowledgeVisibility({ ...active, ...overrides }, "public"), false);
});
