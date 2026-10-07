import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const stateKey = "__oaLaborDualRoleTest";
globalThis[stateKey] = {};
const vite = await createServer({
  appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
  plugins: [{
    name: "labor-dual-role-fixture", enforce: "pre",
    resolveId(source) {
      if (/(^|\/)_lib\/auth$/.test(source)) return "\0labor-test-auth";
      if (/^(?:\.\.\/)+db$/.test(source)) return "\0labor-test-db";
      return null;
    },
    load(id) {
      if (id === "\0labor-test-db") return `export async function getDb() { return globalThis.${stateKey}.db; } export async function getD1Database() { return globalThis.${stateKey}.db.$client; }`;
      if (id === "\0labor-test-auth") return `
        import { sql } from "drizzle-orm";
        const state = () => globalThis.${stateKey};
        export async function getAuthorizedUser() { return state().actor; }
        export function authorizedMemberGuard(actor) {
          return sql\`EXISTS (SELECT 1 FROM members WHERE id = \${actor.memberId} AND account_user_id = \${actor.accountUserId} AND status = 'active')\`;
        }
        export const getConfiguredAdministrators = () => state().admins;
        export const getConfiguredFinanceOwners = () => state().finance;
        export const getConfiguredProjectOwners = () => state().projects;
        export async function getReviewerDirectory() { return state().reviewers; }
        export function isNdaAdmittedMember(member) { return Boolean(member.accountUserId && member.ndaAcceptedAt); }
        export function isProjectOwner() { return true; }
        export function parseMemberPermissions() { return []; }
      `;
      return null;
    },
  }],
});
const route = await vite.ssrLoadModule("/app/api/approvals/[id]/route.ts");
const policy = await vite.ssrLoadModule("/lib/approval-policy.ts");
const adminPolicy = await vite.ssrLoadModule("/lib/administrator-approval.ts");
const ndaAgreement = await vite.ssrLoadModule("/lib/nda-agreement.ts");
const pdf = await vite.ssrLoadModule("/lib/approval-pdf.ts");
let sqlite;
after(async () => { sqlite?.close(); delete globalThis[stateKey]; await vite.close(); });

// Execute the real route's Drizzle queries against SQLite, including all schema
// triggers and atomic batches. Only authenticated identities are test doubles.
function d1Adapter(database) {
  function prepare(query, params = []) {
    const execute = () => {
      const statement = database.prepare(query);
      const results = statement.all(...params);
      return { success: true, results, meta: { changes: Number(database.prepare("SELECT changes() n").get().n) } };
    };
    return {
      bind(...values) { return prepare(query, values); },
      async first() { return database.prepare(query).get(...params) ?? null; },
      async all() { return execute(); },
      async run() { return execute(); },
      async raw() {
        const statement = database.prepare(query);
        statement.setReturnArrays(true);
        return statement.all(...params);
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        database.exec("COMMIT");
        return results;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
}
const owner = { email: "owner@example.com", displayName: "测试负责人", accountUserId: "email:owner@example.com" };
const otherFinance = { email: "finance@example.com", displayName: "独立经费负责人", accountUserId: "email:finance@example.com" };
function actor(identity = owner) {
  return {
    user: { email: identity.email, displayName: identity.displayName },
    accountUserId: identity.accountUserId, memberId: identity.email,
    role: "project_owner", isAdmin: false, isFinanceOwner: true, ndaCompleted: true,
  };
}
function insertApproval({ id = "labor-test", type = "劳务报酬", step = "项目负责人", requester = "applicant@example.com", payload }) {
  const now = "2026-09-01T00:00:00.000Z";
  sqlite.prepare(`INSERT INTO approvals (id,type,title,project,requester_name,requester_email,created_at,updated_at,status,current_step,current_reviewer_email,current_reviewer_name,owner,payload_json,period_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, type, "仅本地测试", "测试项目", "测试申请人", requester, now, now, "审批中", step, owner.email, owner.displayName, owner.displayName, JSON.stringify(payload), type === "劳务报酬" ? `${requester}|2026-09` : null);
}
beforeEach(() => {
  sqlite?.close();
  sqlite = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(migrationDirectory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    for (const statement of readFileSync(new URL(name, migrationDirectory), "utf8").split("--> statement-breakpoint").filter(s => s.trim())) sqlite.exec(statement);
  }
  for (const identity of [owner, otherFinance, { email: "applicant@example.com", displayName: "测试申请人", accountUserId: "email:applicant@example.com" }]) {
    sqlite.prepare("INSERT INTO members(id,full_name,chatgpt_account,account_user_id,nda_accepted_at,nda_agreement_version) VALUES(?,?,?,?,?,?)")
      .run(identity.email, identity.displayName, identity.email, identity.accountUserId, "2026-09-01", "OWNER-2026-09-R1");
  }
  globalThis[stateKey] = {
    db: drizzle(d1Adapter(sqlite)), actor: actor(), admins: [owner], projects: [owner], finance: [owner],
    reviewers: [owner, otherFinance].map(identity => ({ ...identity, ndaCompleted: true, permissions: ["project_owner", "technical_advisor"] })),
  };
  insertApproval({ payload: { claimantMemberId: "applicant@example.com", month: "2026-09", sourceApprovalIds: ["technical-source"], initialReviewerEmail: owner.email, totalScore: 10 } });
  sqlite.prepare("INSERT INTO labor_source_claims(id,claimant_member_id,claimant_email,technical_approval_id,labor_approval_id) VALUES(?,?,?,?,?)")
    .run("claim", "applicant@example.com", "applicant@example.com", "technical-source", "labor-test");
});
async function patch(body) {
  const response = await route.PATCH(new Request("https://oa.example.test/api/approvals/labor-test", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", ...body }),
  }), { params: Promise.resolve({ id: "labor-test" }) });
  return { status: response.status, body: await response.json() };
}
const recommendation = { suggestedAmount: 100, compensationBasis: "仅本地自动化测试的金额依据，不产生付款" };
const ledger = () => sqlite.prepare("SELECT * FROM approval_events WHERE approval_id = 'labor-test' ORDER BY id").all();

test("configured dual role requires two requests and preserves both audit events, revisions and PDF", async () => {
  const first = await patch(recommendation);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.approval.step, "经费负责人");
  assert.equal(first.body.approval.status, "审批中");
  assert.equal(first.body.approval.currentReviewerEmail, owner.email);
  assert.equal(first.body.approval.payload.finalAmount, undefined);
  assert.equal(ledger().length, 1);
  // Replaying the recommendation must not act as a second confirmation.
  assert.equal((await patch(recommendation)).status, 400);
  assert.equal(ledger().length, 1);
  const final = await patch({ finalAmount: 100, financeNote: "本地验收终审" });
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.equal(final.body.approval.status, "已归档");
  const payload = final.body.approval.payload;
  assert.equal(payload.suggestedAmountBy.accountUserId, owner.accountUserId);
  assert.equal(payload.finalAmountBy.accountUserId, owner.accountUserId);
  assert.equal(payload.suggestedAmount, 100);
  assert.equal(payload.finalAmount, 100);
  const events = ledger();
  assert.equal(events.length, 2);
  assert.match(events[0].note, /项目负责人建议/);
  assert.match(events[1].note, /经费负责人终审/);
  const storedRevisions = sqlite.prepare("SELECT * FROM approval_revisions ORDER BY revision_no").all();
  assert.equal(storedRevisions.length, 3);
  assert.equal(storedRevisions[2].previous_revision_hash, storedRevisions[1].revision_hash);
  assert.equal(storedRevisions[1].previous_revision_hash, storedRevisions[0].revision_hash);
  for (const revision of storedRevisions) assert.equal(createHash("sha256").update(revision.state_json).digest("hex"), revision.state_hash);
  const bytes = await pdf.buildApprovalPdf({ approval: { ...final.body.approval, requesterName: "测试申请人", currentStep: "已归档" }, events: events.map(e => ({ actorName: e.actor_name, actorEmail: e.actor_email, action: e.action, note: e.note, createdAt: e.created_at })) });
  assert.equal(Buffer.from(bytes).subarray(0, 8).toString(), "%PDF-1.7");
  assert.equal((await patch({ finalAmount: 100 })).status, 404);
  assert.equal(ledger().length, 2);
});

test("administrator fallback and one-sided role configuration cannot combine duties", async () => {
  const state = globalThis[stateKey];
  for (const [projects, finance] of [[[], []], [[owner], []], [[], [owner]]]) {
    state.projects = projects; state.finance = finance;
    const result = await patch(recommendation);
    assert.equal(result.status, 503, JSON.stringify(result.body));
    assert.equal(ledger().length, 0);
  }
});

test("configured email with a different account identity does not authorize overlap", async () => {
  globalThis[stateKey].finance = [{ ...owner, accountUserId: "different-account" }];
  assert.equal((await patch(recommendation)).status, 503);
  assert.equal(ledger().length, 0);
});

test("removing explicit dual-role permission before final review stops the second step", async () => {
  assert.equal((await patch(recommendation)).status, 200);
  globalThis[stateKey].projects = [];
  assert.equal((await patch({ finalAmount: 100 })).status, 409);
  assert.equal(ledger().length, 1);
});

test("dual-role reviewer still cannot approve their own application", async () => {
  sqlite.prepare("UPDATE approvals SET requester_email = ? WHERE id = 'labor-test'").run(owner.email);
  assert.equal((await patch(recommendation)).status, 403);
  assert.equal(ledger().length, 0);
});

test("independent finance reviewer continues to work without the overlap exception", async () => {
  globalThis[stateKey].finance = [otherFinance];
  const first = await patch(recommendation);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.approval.currentReviewerEmail, otherFinance.email);
  globalThis[stateKey].actor = actor(otherFinance);
  const final = await patch({ finalAmount: 100 });
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.equal(final.body.approval.status, "已归档");
});

test("changed final amount still needs an explanation", async () => {
  assert.equal((await patch(recommendation)).status, 200);
  assert.equal((await patch({ finalAmount: 90 })).status, 400);
  assert.equal(ledger().length, 1);
  assert.equal((await patch({ finalAmount: 90, financeNote: "本地测试：调整核算" })).status, 200);
});

test("technical and purchase reviews retain their distinct-reviewer requirement", async () => {
  for (const type of ["技术审核", "采购审核"]) {
    sqlite.prepare("UPDATE approvals SET type = ? WHERE id = 'labor-test'").run(type);
    assert.equal((await patch({ nextReviewerEmail: owner.email })).status, 409);
    assert.equal(ledger().length, 0);
  }
});

test("administrator can review an unassigned technical approval, including their own application", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  sqlite.prepare("UPDATE approvals SET type='技术审核',requester_email=?,current_reviewer_email='other@example.com' WHERE id='labor-test'").run(owner.email);
  const result = await patch({ note: "管理员本人审批" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.approval.status, "已归档");
  assert.equal(result.body.approval.payload.administratorReviews[0].accountUserId, owner.accountUserId);
  assert.equal(result.body.approval.payload.administratorReviews[0].assignedReviewerEmail, "other@example.com");
  assert.equal(ledger()[0].actor_email, owner.email);
  assert.match(ledger()[0].note, /系统管理员审批/);
});

test("administrator can handle both labor review nodes without being the assigned reviewer", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  globalThis[stateKey].projects = [];
  sqlite.prepare("UPDATE approvals SET current_reviewer_email='other@example.com' WHERE id='labor-test'").run();
  const first = await patch(recommendation);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.approval.step, "经费负责人");
  const final = await patch({ finalAmount: 100 });
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.equal(final.body.approval.status, "已归档");
  assert.equal(final.body.approval.payload.administratorReviews.length, 2);
  assert.equal(ledger().length, 2);
});

test("administrator purchase review preserves actual purchaser identity and completion", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  sqlite.prepare("UPDATE approvals SET type='采购审核',requester_email=?,current_reviewer_email='other@example.com',payload_json=? WHERE id='labor-test'")
    .run(owner.email, JSON.stringify({ amount: 100, initialReviewerEmail: owner.email }));
  const review = await patch({ purchaserEmail: otherFinance.email });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.approval.step, "统一采购");
  assert.equal(review.body.approval.payload.purchaseCompletion, undefined);
  assert.equal((await patch({ action: "confirm_purchase", actualAmount: 80, purchaseNote: "实际采购测试说明" })).status, 404);
  globalThis[stateKey].actor = actor(otherFinance);
  const completion = await patch({ action: "confirm_purchase", actualAmount: 80, purchaseNote: "实际采购测试说明" });
  assert.equal(completion.status, 200, JSON.stringify(completion.body));
  assert.equal(completion.body.approval.status, "已归档");
  assert.equal(completion.body.approval.payload.purchaseCompletion.purchaserEmail, otherFinance.email);
});

test("administrator can review the technical advisor node and select another administrator", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  globalThis[stateKey].reviewers[0].isAdmin = true;
  sqlite.prepare("UPDATE approvals SET type='技术审核',current_step='技术顾问',current_reviewer_email='other@example.com' WHERE id='labor-test'").run();
  const result = await patch({ nextReviewerEmail: owner.email });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.approval.step, "项目负责人");
  assert.equal((await patch({})).status, 200);
});

test("client-supplied administrator flags do not confer approval rights", async () => {
  sqlite.prepare("UPDATE approvals SET type='技术审核',current_reviewer_email='other@example.com' WHERE id='labor-test'").run();
  const result = await patch({ isAdmin: true, administratorReviews: [{ email: owner.email }] });
  assert.equal(result.status, 404);
  assert.equal(ledger().length, 0);
});

test("administrator review does not replace developer confirmations or purchase completion", async () => {
  for (const [type, steps] of [["技术审核", ["技术顾问", "项目负责人"]], ["采购审核", ["技术顾问", "项目负责人"]], ["保密协议", ["项目负责人", "OA管理员"]], ["劳务报酬", ["项目负责人", "经费负责人"]], ["流转审批", ["指定审批"]]]) {
    for (const step of steps) assert.equal(adminPolicy.administratorReviewAllowed(type, step, "待审核", true), true);
    for (const status of ["草稿", "已退回", "已撤回", "已作废", "已归档"]) assert.equal(adminPolicy.administratorReviewAllowed(type, steps[0], status, true), false);
    assert.equal(adminPolicy.administratorReviewAllowed(type, steps[0], "待审核", false), false);
  }
  for (const [type, step] of [["技术审核", "开发人确认"], ["采购审核", "统一采购"], ["流转审批", "流转确认"]]) {
    assert.equal(adminPolicy.administratorReviewAllowed(type, step, "审批中", true), false);
  }
});

test("administrator still needs a valid personally signed confidentiality agreement", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  sqlite.prepare("UPDATE approvals SET type='保密协议',current_step='OA管理员',current_reviewer_email='other@example.com',payload_json=? WHERE id='labor-test'")
    .run(JSON.stringify({ agreementKind: "project_owner", agreementVersion: "OWNER-2026-09-R1" }));
  const result = await patch({});
  assert.equal(result.status, 409);
  assert.equal(ledger().length, 0);
  assert.equal(policy.hasCompletedNda({ isAdmin: true, ndaCompleted: false }), false);
});

test("administrator return preserves its own audit identity and does not impersonate the assignee", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  sqlite.prepare("UPDATE approvals SET type='技术审核',current_reviewer_email='other@example.com' WHERE id='labor-test'").run();
  const result = await patch({ action: "return", note: "请补充技术测试证据" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.approval.status, "已退回");
  assert.equal(ledger()[0].actor_email, owner.email);
  assert.match(ledger()[0].note, /系统管理员退回/);
});

test("administrator can approve another person's valid signed confidentiality agreement", async () => {
  globalThis[stateKey].actor.isAdmin = true;
  // Synthetic ink fixture, used only in the isolated in-memory test database.
  const signatureDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA4QAAAEECAYAAABwYfrKAAAEcUlEQVR4nO3XwYkCABAEQdMxCj+Xf0qagswJDUsVdATzmscDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvvD8e731v+oNAQAAJvWZulC9IQAAwKQ+UxeqNwQAAJjUZ+pC9YYAAACT+kxdqN4QAABgUp+pC9UbAgAATOozdaF6QwAAgEl9pi5UbwgAADCpz9SF6g0BAAAm9Zm6UL0hAADApD5TF6o3BAAAmNRn6kL1hgAAAJP6TF2o3hAAAGBSn6kL1RsCAABM6jN1oXpDAACASX2mLlRvCAAAMKnP1IXqDQEAACb1mbpQvSEAAMCkPlMXqjcEAACY1GfqQvWGAAAAk/pMXajeEAAAYFKfqQvVGwIAAEzqM3WhekMAAIBJfaYuVG8IAAAwqc/UheoNAQAAJvWZulC9IQAAwKQ+UxeqNwQAAJjUZ+pC9YYAAACT+kxdqN4QAABgUp+pC9UbAgAATOozdaF6QwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPipD0aPXTZV6f/2AAAAAElFTkSuQmCC";
  const payload = { agreementKind: "project_owner", agreementVersion: ndaAgreement.confidentialityAgreementVersions("project_owner")[0], signerName: "测试申请人", signerEmail: "applicant@example.com", signerAccountUserId: "email:applicant@example.com", confidentialScope: "本地测试材料保密范围", signatureDataUrl, signedAt: "2026-09-01T00:00:00.000Z", previewed: true, agreed: true };
  sqlite.prepare("UPDATE approvals SET type='保密协议',current_step='OA管理员',current_reviewer_email='other@example.com',payload_json=? WHERE id='labor-test'").run(JSON.stringify(payload));
  const result = await patch({});
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.approval.status, "已归档");
  assert.equal(result.body.approval.payload.signerAccountUserId, payload.signerAccountUserId);
  assert.equal(result.body.approval.payload.signatureDataUrl, signatureDataUrl);
  assert.equal(result.body.approval.payload.administratorReviews[0].accountUserId, owner.accountUserId);
  assert.equal(ledger()[0].actor_email, owner.email);
});
