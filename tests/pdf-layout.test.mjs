import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const pdf = await vite.ssrLoadModule("/lib/approval-pdf.ts");
const nda = await vite.ssrLoadModule("/lib/nda-agreement.ts");
const fonts = await vite.ssrLoadModule("/lib/pdf-font-data.ts");
const archive = await vite.ssrLoadModule("/lib/pdf-archive-status.ts");

function fixture(payload = {}) {
  return { id: "NDA-20261003-001", type: "保密协议", title: "项目成员保密协议", project: "OriginMind × ARTS Robotics 联合研发项目",
    requesterName: "示例成员", requesterEmail: "member@example.com", createdAt: "2026-10-03T01:00:00.000Z",
    updatedAt: "2026-10-03T02:20:00.000Z", status: "已归档", currentStep: "已归档", owner: "示例成员",
    amount: null, summary: "本人实名确认并完成签署。", signers: ["示例成员"], payload: {
      agreementKind: "member", agreementVersion: nda.NDA_AGREEMENT_VERSION, signerName: "示例成员",
      signerEmail: "member@example.com", confidentialScope: "代码、图纸及测试资料", signedAt: "2026-10-03T01:12:00.000Z", ...payload,
    } };
}

function pageContents(bytes) {
  const binary = Buffer.from(bytes).toString("latin1");
  const ids = [...binary.matchAll(/\/Type \/Page\b[^\n]*\/Contents (\d+) 0 R/g)].map((m) => Number(m[1]));
  return ids.map((id) => {
    const begin = binary.indexOf(id + " 0 obj\n");
    assert.ok(begin >= 0);
    const stream = binary.indexOf("stream\n", begin) + 7;
    const length = Number(binary.slice(begin, stream).match(/\/Length (\d+)/)[1]);
    return binary.slice(stream, stream + length);
  });
}

function textRuns(content) {
  return [...content.matchAll(/BT ([\s\S]*?) ET/g)].map((m) => {
    const transform = m[1].match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/);
    const chunks = [...m[1].matchAll(/\/(F[12]) ([\d.]+) Tf <([A-F0-9]*)> Tj/g)].map((run) => ({
      font: run[1], size: Number(run[2]),
      text: (run[3].match(/.{4}/g) || []).map((c) => String.fromCharCode(parseInt(c, 16))).join(""),
    }));
    return { x: Number(transform[1]), y: Number(transform[2]), chunks, text: chunks.map((c) => c.text).join("") };
  });
}

function documentText(bytes) {
  return pageContents(bytes).flatMap(textRuns).map((run) => run.text).join("\n");
}

test("PDF preserves the signed historical snapshot once, rather than reconstructing or duplicating it", async () => {
  const snapshot = "历史保密协议\n甲方：联合研发项目\n乙方：示例成员\n第一条　以本人签署时确认的历史正文为准。\n第二条　仅用于项目研发。";
  const bytes = await pdf.buildApprovalPdf({ approval: fixture({ agreementVersion: "HISTORICAL-VERSION", agreementTextSnapshot: snapshot }), events: [] });
  const text = documentText(bytes);
  assert.equal(text.split("以本人签署时确认的历史正文为准。").length - 1, 1);
  assert.ok(text.includes("仅用于项目研发。"));
  assert.ok(!text.includes("agreement Text Snapshot"));
  assert.ok(!text.includes("签署正文快照"));
  assert.ok(!text.includes("第一条 保密信息"));
  assert.ok(text.includes("2026-10-03 10:20"));
  assert.ok(text.includes("HISTORICAL-VERSION"));
});

test("the standard signed agreement has a separate audit appendix with intact hashes and readable actions", async () => {
  const approval = fixture({ signerAccountUserId: "account-demo-001", agreementHash: "c".repeat(64), signatureHash: "d".repeat(64), recordHash: "e".repeat(64) });
  approval.payload.agreementTextSnapshot = nda.buildNdaAgreementTextForVersion("示例成员", approval.payload.confidentialScope, "member", nda.NDA_AGREEMENT_VERSION);
  const bytes = await pdf.buildApprovalPdf({ approval, events: [{ actorName: "示例成员", actorEmail: "member@example.com", action: "auto_archived", note: "签署后自动归档", createdAt: approval.updatedAt }],
    integrity: { archiveHash: "a".repeat(64), evidenceRecordHash: "b".repeat(64), schemaVersion: 2, terminalRevisionNo: 3, terminalRevisionHash: "f".repeat(64), terminalStateHash: "0".repeat(64) } });
  const pages = pageContents(bytes).map((p) => textRuns(p).map((run) => run.text).join("\n"));
  assert.equal(pages.length, 2);
  assert.ok(pages[0].includes("第一条"));
  assert.ok(!pages[0].includes("account-demo-001"));
  assert.ok(pages[1].includes("签署与流转记录"));
  assert.ok(pages[1].includes("系统自动归档"));
  const joined = pages.join("").replace(/\s/g, "");
  for (const hash of ["a", "b", "c", "d", "e", "f", "0"]) assert.ok(joined.includes(hash.repeat(64)));
  for (const paragraph of approval.payload.agreementTextSnapshot.split("\n")) {
    assert.ok(joined.includes(paragraph.normalize("NFKC").replace(/\s/g, "")));
  }
});

test("the PDF declares actual embedded glyph advances and keeps long titles and fields inside the page", async () => {
  const font = inflateSync(Buffer.from(fonts.PDF_EMBEDDED_FONT_COMPRESSED_BASE64, "base64"));
  const cid = inflateSync(Buffer.from(fonts.PDF_EMBEDDED_FONT_CID_MAP_COMPRESSED_BASE64, "base64"));
  const tables = {};
  for (let i = 0; i < font.readUInt16BE(4); i += 1) { const p = 12 + i * 16; tables[font.toString("ascii", p, p + 4)] = font.readUInt32BE(p + 8); }
  const upm = font.readUInt16BE(tables.head + 18);
  const count = font.readUInt16BE(tables.hhea + 34);
  const actualWidth = (code) => Math.round(font.readUInt16BE(tables.hmtx + Math.min(cid.readUInt16BE(code * 2), count - 1) * 4) / upm * 1000);
  const approval = { ...fixture(), type: "采购审核", title: "机器人测试设备与控制部件采购申请".repeat(12), payload: {
    itemSpec: "传感器与连接线，附有规格说明。".repeat(100), quantity: 2,
    purchaseLink: "https://example.com/" + "Wm@".repeat(100), supplier: "示例供应商", purpose: "标定与测试",
  } };
  const bytes = await pdf.buildApprovalPdf({ approval, events: [] });
  const binary = Buffer.from(bytes).toString("latin1");
  const cidFont = binary.match(/4 0 obj\n([\s\S]*?)endobj/)[1];
  const widths = new Map([...cidFont.matchAll(/(\d+) \[(\d+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]));
  for (let code = 32; code <= 126; code += 1) assert.equal(widths.get(code), actualWidth(code), "glyph " + code);
  for (const content of pageContents(bytes)) {
    const runs = textRuns(content);
    for (const run of runs) {
      const width = run.chunks.reduce((sum, chunk) => sum + [...chunk.text].reduce((part, c) => part + (chunk.font === "F1" ? actualWidth(c.charCodeAt(0)) : 1000) * chunk.size / 1000, 0), 0);
      assert.ok(run.x >= 53.9, run.text + " starts beyond the left margin");
      assert.ok(run.x + width <= 541.1, run.text + " extends beyond the right margin");
      assert.ok(run.y >= 29.9 && run.y <= 813.1, run.text + " extends outside the page");
    }
    const headings = runs.filter((r) => ["基本信息", "事项摘要", "申请数据", "签署与流转记录", "归档完整性校验"].includes(r.text));
    for (const heading of headings) assert.ok(runs.some((r) => r.y < heading.y && r.y > 50), heading.text + " is orphaned at the page bottom");
  }
  const text = documentText(bytes).replace(/\s/g, "");
  assert.ok(text.includes("Wm@".repeat(100)));
  assert.ok(text.includes("规格说明。".repeat(1)));
});

test("disabled automatic sync never reports an upload in progress or hides an existing saved file", () => {
  assert.equal(archive.approvalPdfArchiveStatus(undefined, undefined).status, "disabled");
  assert.equal(archive.approvalPdfArchiveStatus({ status: "pending" }, "false").status, "disabled");
  assert.equal(archive.approvalPdfArchiveStatus(undefined, " TRUE ").status, "pending");
  const uploaded = { status: "uploaded", fileName: "archive.pdf", errorCode: null, updatedAt: "2026-10-03" };
  assert.deepEqual(archive.approvalPdfArchiveStatus(uploaded, undefined), uploaded);
  assert.equal(archive.approvalPdfArchiveStatus({ status: "failed" }, "true").status, "failed");
});
