import { buildNdaAgreementTextForVersion, confidentialityAgreementKindFromPayload } from "./nda-agreement";
import { PDF_EMBEDDED_FONT_WIDTHS } from "./pdf-font-widths";
import {
  PDF_EMBEDDED_FONT_CID_MAP_COMPRESSED_BASE64,
  PDF_EMBEDDED_FONT_COMPRESSED_BASE64,
  PDF_EMBEDDED_FONT_LENGTH,
  PDF_EMBEDDED_FONT_NAME,
  PDF_EMBEDDED_FONT_SUPPORTED_BITS_BASE64,
} from "./pdf-font-data";

export type ApprovalPdfEvent = {
  id?: number;
  actorName: string;
  actorEmail: string;
  action: string;
  note: string;
  createdAt: string;
};

export type ApprovalPdfRecord = {
  id: string;
  type: string;
  title: string;
  project: string;
  requesterName: string;
  requesterEmail: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  currentStep: string;
  currentReviewerName?: string;
  currentReviewerEmail?: string;
  summary: string;
  owner: string;
  amount: string | null;
  signers: string[];
  payload: Record<string, unknown>;
};

export type ApprovalPdfIntegrity = {
  archiveHash: string;
  evidenceRecordHash: string;
  schemaVersion: number;
  terminalRevisionNo: number | null;
  terminalRevisionHash: string | null;
  terminalStateHash: string | null;
};

export type ApprovalPdfInput = {
  approval: ApprovalPdfRecord;
  events: ApprovalPdfEvent[];
  integrity?: ApprovalPdfIntegrity | null;
};

type TextItem = {
  kind: "text";
  text: string;
  size: number;
  color: [number, number, number];
  indent?: number;
  gapAfter?: number;
  leading?: number;
  section?: boolean;
  align?: "left" | "center";
  gapBefore?: number;
  pageBreakBefore?: boolean;
  keepWithNext?: number;
};

type ImageItem = { kind: "signature"; gapAfter?: number };
type FieldItem = { kind: "field"; label: string; value: string; indent?: number; gapAfter?: number };
type LayoutItem = TextItem | ImageItem | FieldItem;
type SignatureImage = { width: number; height: number; compressedRgb: Uint8Array };

const encoder = new TextEncoder();
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_LEFT = 54;
const PAGE_RIGHT = 54;
const PAGE_TOP = 786;
const PAGE_BOTTOM = 62;
const FIELD_LABEL_WIDTH = 104;
const FIELD_LEADING = 15;
let embeddedFontCompressedCache: Uint8Array | undefined;
let embeddedFontCidMapCompressedCache: Uint8Array | undefined;
let embeddedFontSupportedBitsCache: Uint8Array | undefined;

const FIELD_LABELS: Record<string, string> = {
  amount: "申请金额",
  circulationContent: "流转事项内容",
  circulationRecipients: "流转对象",
  circulationApprovers: "指定审批人",
  circulationConfirmations: "流转确认记录",
  circulationApprovals: "审批记录",
  agreementKind: "协议类别",
  agreementVersion: "协议版本",
  archivedAt: "归档时间",
  archivedBy: "归档操作人",
  archivedContributionHours: "已归档成果折算工时",
  claimantMemberId: "申报成员编号",
  compensationBasis: "金额依据",
  confidentialScope: "保密范围",
  developerConfirmations: "开发人确认",
  developers: "开发人员及贡献",
  finalAmount: "最终审核金额",
  finalAmountAt: "最终审核时间",
  finalAmountBy: "最终审核人",
  financeNote: "经费审核意见",
  initialReviewerEmail: "初审人账号",
  itemSpec: "物品与规格",
  laborClaimRevision: "劳务占用版本",
  lastResubmissionNote: "最近补充说明",
  lastResubmittedAt: "最近重提时间",
  month: "所属月份",
  monthlyStatement: "本月工作与贡献陈述",
  monthlyWorkHours: "本月其他工时",
  monthlyWorkHoursDefinition: "工时口径",
  otherMonthlyWorkHours: "本月其他工时",
  purchaseLink: "采购链接",
  purchaseNote: "实际采购说明",
  purchaserAssignedAt: "采购人指定时间",
  purchaserAssignedBy: "采购人指定者",
  purchaserEmail: "采购人账号",
  purchaserMemberId: "采购人成员编号",
  purchaserName: "采购人",
  purpose: "用途",
  quantity: "数量",
  robotPart: "机器人技术模块",
  selectedSources: "已选技术成果",
  signedAt: "签署时间",
  signerAccountUserId: "签署账户主体",
  signerEmail: "签署账号",
  signerName: "签署人",
  sourceApprovalIds: "技术成果编号",
  suggestedAmount: "建议金额",
  suggestedPurchaserEmail: "建议采购人账号",
  suggestedPurchaserMemberId: "建议采购人成员编号",
  suggestedPurchaserName: "建议采购人",
  supplier: "供应商",
  technicalContent: "技术内容",
  totalScore: "核算总工时",
  totalWorkHours: "总工时",
  workflowMutationRevision: "流程写入版本",
  agreementTextSnapshot: "签署正文快照",
  agreementHash: "协议正文 SHA-256",
  signatureHash: "手写签名 SHA-256",
  recordHash: "签署记录 SHA-256",
  archivedByEmail: "归档人账号",
  initialReviewerName: "初审人",
  administratorReviews: "管理员审核记录",
  memberId: "成员编号",
  accountUserId: "账户主体",
  step: "审核环节",
  assignedReviewerEmail: "指定审核人账号",
  ratioBasisPoints: "贡献比例计算基点",
  developersIdentityRecords: "开发人员主体编号",
  circulationRecipientsIdentityRecords: "流转对象主体编号",
  circulationApproversIdentityRecords: "审批人主体编号",
  id: "记录编号",
  name: "姓名",
  email: "账号",
  title: "事项标题",
  work: "承担工作",
  ratio: "贡献比例（%）",
  weightedHours: "折算工时",
  workHours: "工作时数",
  hours: "工时",
  confirmed: "已确认",
  confirmedAt: "确认时间",
  approvedAt: "审核时间",
  reviewedAt: "审核时间",
  actorName: "操作人",
  actorEmail: "操作人账号",
  status: "状态",
  note: "说明",
  reason: "原因",
  approvalId: "审批编号",
  technicalApprovalId: "技术成果编号",
  contributionRatio: "贡献比例（%）",
  contributionHours: "贡献工时",
  voidReason: "作废原因",
  voidedAt: "作废时间",
  voidedBy: "作废操作人",
  withdrawReason: "撤回原因",
  withdrawnAt: "撤回时间",
  withdrawnBy: "撤回操作人",
};

const OMITTED_PAYLOAD_FIELDS = new Set(["signatureDataUrl", "previewed", "agreed", "autoArchived"]);
const AUDIT_PAYLOAD_FIELDS = new Set([
  "agreementHash", "signatureHash", "recordHash", "signerAccountUserId",
  "workflowMutationRevision", "laborClaimRevision", "claimantMemberId",
  "purchaserMemberId", "suggestedPurchaserMemberId", "initialReviewerName", "initialReviewerEmail",
  "archivedAt", "archivedBy", "archivedByEmail", "purchaserAssignedAt", "purchaserAssignedBy",
  "developerConfirmations", "administratorReviews", "circulationConfirmations", "circulationApprovals",
]);

export function approvalEventActionLabel(action: string) {
  return action === "confirm_circulation" ? "流转确认" : action === "submitted" ? "提交"
    : action === "auto_archived" ? "系统自动归档"
      : action === "draft_saved" ? "保存草稿"
        : action === "confirm_developer" ? "开发人确认"
          : action === "confirm_purchase" ? "采购完成确认"
            : action === "approve" ? "审核通过"
              : action === "return" ? "退回补充"
                : action === "force_return" ? "管理员强制退回"
                  : action === "resubmit" ? "重新提交"
                    : action === "withdraw" ? "申请人撤回"
                      : action === "void" ? "申请作废"
                        : action === "archive_correction" ? "归档更正说明"
                          : action === "archive_void_notice" ? "归档废止说明"
                            : action;
}

function cleanText(value: string) {
  return value.normalize("NFKC").replace(/[\p{Cf}\u2028\u2029]/gu, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : "—";
  return cleanText(String(value)) || "—";
}

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return displayValue(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function fieldLabel(key: string) {
  return FIELD_LABELS[key] || key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function fieldValue(key: string, value: unknown) {
  if (key === "agreementKind") return value === "member" ? "项目参与成员版" : value === "project_owner" ? "项目负责人版" : displayValue(value);
  if (key.endsWith("At") && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value)) return displayDate(value);
  return displayValue(value);
}

function flattenPayload(value: unknown, key = "", depth = 0): Array<{ label: string; value: string; depth: number }> {
  if (depth > 5) return [{ label: fieldLabel(key), value: "[内容层级过深]", depth }];
  if (Array.isArray(value)) {
    if (!value.length) return [{ label: fieldLabel(key), value: "无", depth }];
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return [{ label: fieldLabel(key), value: value.map(displayValue).join("、"), depth }];
    }
    return value.flatMap((item, index) => [
      { label: `${fieldLabel(key)} · 第 ${index + 1} 项`, value: "", depth },
      ...flattenPayload(item, "", depth + 1),
    ]);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([childKey]) => !OMITTED_PAYLOAD_FIELDS.has(childKey));
    if (!entries.length) return key ? [{ label: fieldLabel(key), value: "无", depth }] : [];
    return entries.flatMap(([childKey, childValue]) => flattenPayload(childValue, childKey, depth + (key ? 1 : 0)));
  }
  return [{ label: key ? fieldLabel(key) : "内容", value: fieldValue(key, value), depth }];
}

function textItem(text: string, size = 10.5, options: Partial<Omit<TextItem, "kind" | "text" | "size">> = {}): TextItem {
  return { kind: "text", text: cleanText(text), size, color: [0.12, 0.16, 0.19], leading: Math.max(15, size * 1.6), gapAfter: 5, ...options };
}

function section(text: string, options: Partial<Omit<TextItem, "kind" | "text" | "size">> = {}): TextItem {
  return textItem(text, 12, { color: [0.10, 0.28, 0.31], leading: 19, gapBefore: 8, gapAfter: 7, section: true, keepWithNext: 32, ...options });
}

function fieldItem(label: string, value: string, indent = 0): FieldItem {
  return { kind: "field", label: cleanText(label), value: cleanText(value), indent, gapAfter: 7 };
}

function payloadItems(payload: Record<string, unknown>): LayoutItem[] {
  return flattenPayload(payload).map((field) => field.value
    ? fieldItem(field.label, field.value, Math.min(field.depth, 3) * 10)
    : textItem(field.label, 10, { indent: Math.min(field.depth, 3) * 10, gapBefore: 5, gapAfter: 5, keepWithNext: 30 }));
}

function agreementParagraphs(approval: ApprovalPdfRecord) {
  if (approval.type !== "保密协议") return [];
  // The stored text is the document actually signed, including historical versions.
  if (typeof approval.payload.agreementTextSnapshot === "string" && approval.payload.agreementTextSnapshot.trim()) {
    return approval.payload.agreementTextSnapshot.split("\n").map(cleanText).filter(Boolean);
  }
  const kind = confidentialityAgreementKindFromPayload(approval.payload);
  if (!kind || typeof approval.payload.agreementVersion !== "string") return [];
  try {
    return buildNdaAgreementTextForVersion(displayValue(approval.payload.signerName), displayValue(approval.payload.confidentialScope), kind, approval.payload.agreementVersion).split("\n").map(cleanText).filter(Boolean);
  } catch {
    return [];
  }
}

function buildLayoutItems(input: ApprovalPdfInput): LayoutItem[] {
  const { approval, events, integrity } = input;
  const paragraphs = agreementParagraphs(approval);
  const isAgreement = approval.type === "保密协议" && paragraphs.length > 0;
  const title = isAgreement ? paragraphs[0] : approval.title;
  const mainPayload: Record<string, unknown> = {};
  const auditPayload: Record<string, unknown> = {};
  const representedAgreementFields = new Set(["signerName", "signerEmail", "signedAt"]);
  for (const [key, value] of Object.entries(approval.payload)) {
    if (OMITTED_PAYLOAD_FIELDS.has(key) || (isAgreement && key === "agreementTextSnapshot")) continue;
    if (isAgreement && representedAgreementFields.has(key)) continue;
    if (!isAgreement && ["developers", "circulationRecipients", "circulationApprovers"].includes(key) && Array.isArray(value)) {
      const identityRecords: string[] = [];
      mainPayload[key] = value.map((person, index) => {
        if (!person || typeof person !== "object" || Array.isArray(person)) return person;
        const readable = { ...person as Record<string, unknown> };
        const metadata: string[] = [];
        for (const field of ["memberId", "accountUserId", "ratioBasisPoints"]) {
          if (!(field in readable)) continue;
          metadata.push(fieldLabel(field) + "：" + displayValue(readable[field]));
          delete readable[field];
        }
        if (metadata.length) identityRecords.push(`${displayValue(readable.name || readable.email || "第 " + (index + 1) + " 项")} · ${metadata.join("；")}`);
        return readable;
      });
      if (identityRecords.length) auditPayload[key + "IdentityRecords"] = identityRecords.join("\n");
      continue;
    }
    (isAgreement || AUDIT_PAYLOAD_FIELDS.has(key) ? auditPayload : mainPayload)[key] = value;
  }
  const state = approval.currentStep && approval.currentStep !== approval.status ? `${approval.status} / ${approval.currentStep}` : approval.status;
  const items: LayoutItem[] = [
    textItem("OriginMind × ARTS Robotics 联合研发 OA", 8.5, { color: [0.38, 0.44, 0.46], gapAfter: 13 }),
    textItem(title, 20, { align: "center", leading: 29, gapAfter: 8, keepWithNext: 35 }),
    textItem(`${approval.type} · ${state}`, 9.5, { align: "center", color: [0.38, 0.44, 0.46], gapAfter: 10 }),
    section("基本信息"),
    fieldItem("联合项目", approval.project || "—"),
    fieldItem(isAgreement ? "签署人" : "申请人", `${approval.requesterName}${approval.requesterEmail ? " · " + approval.requesterEmail : ""}`),
    fieldItem(approval.status === "已归档" ? "归档时间" : "更新时间", displayDate(approval.updatedAt) + "（北京时间）"),
  ];
  if (!isAgreement) {
    items.push(fieldItem("申请编号", approval.id), fieldItem("创建时间", displayDate(approval.createdAt)));
    if (approval.owner) items.push(fieldItem("事项负责人", approval.owner));
    if (approval.currentReviewerName) items.push(fieldItem("当前处理人", `${approval.currentReviewerName}${approval.currentReviewerEmail ? " · " + approval.currentReviewerEmail : ""}`));
    if (approval.amount) items.push(fieldItem("金额", approval.amount));
    if (approval.summary) items.push(section("事项摘要"), textItem(approval.summary, 10.5, { gapAfter: 8 }));
  }
  if (isAgreement) {
    items.push(section("协议正文"));
    for (const paragraph of paragraphs.slice(1)) {
      const metadata = !/^第[一二三四五六七八九十百\d]+条/u.test(paragraph);
      items.push(textItem(paragraph, metadata ? 9.5 : 10.5, { leading: metadata ? 15 : 17.5, gapAfter: metadata ? 4 : 9 }));
    }
    items.push(textItem("本人确认已阅读上述正文，并以本人实名认证账户完成电子手写签署。", 9, { color: [0.38, 0.44, 0.46], gapAfter: 6 }));
  }
  if (Object.keys(mainPayload).length) items.push(section("申请数据"), ...payloadItems(mainPayload));
  if (approval.type === "保密协议" && typeof approval.payload.signatureDataUrl === "string") {
    items.push(section("本人手写签名", { keepWithNext: 127 }));
    items.push({ kind: "signature", gapAfter: 5 });
    items.push(textItem(`签署人：${displayValue(approval.payload.signerName)}    签署时间：${displayDate(String(approval.payload.signedAt || ""))}（北京时间）`, 9, { gapAfter: 8 }));
  } else if (isAgreement && typeof approval.payload.signedAt === "string") {
    items.push(fieldItem("签署时间", displayDate(approval.payload.signedAt) + "（北京时间）"));
  }
  // Keep the readable document separate from its audit and verification appendix.
  items.push(section("签署与流转记录", { pageBreakBefore: true, gapBefore: 0, keepWithNext: 55 }));
  if (!events.length) items.push(textItem("暂无流转记录。", 9.5));
  for (const [index, event] of events.entries()) {
    items.push(textItem(`${index + 1}. ${approvalEventActionLabel(event.action)} · ${displayDate(event.createdAt)}`, 10, { color: [0.10, 0.28, 0.31], gapAfter: 3, keepWithNext: 34 }));
    items.push(fieldItem("操作人", `${event.actorName}${event.actorEmail ? " · " + event.actorEmail : ""}`));
    if (event.note) items.push(fieldItem("处理说明", event.note));
  }
  if (isAgreement) {
    items.push(section("原申请信息"), fieldItem("申请标题", approval.title), fieldItem("申请编号", approval.id), fieldItem("创建时间", displayDate(approval.createdAt)));
    if (approval.summary) items.push(fieldItem("事项摘要", approval.summary));
    if (approval.owner && approval.owner !== approval.requesterName) items.push(fieldItem("事项负责人", approval.owner));
    if (approval.currentReviewerName) items.push(fieldItem("当前处理人", `${approval.currentReviewerName}${approval.currentReviewerEmail ? " · " + approval.currentReviewerEmail : ""}`));
  }
  if (Object.keys(auditPayload).length) items.push(section("签署与系统核验信息"), ...payloadItems(auditPayload));
  if (integrity) {
    items.push(section("归档完整性校验", { keepWithNext: 64 }));
    items.push(fieldItem("归档结构版本", String(integrity.schemaVersion)));
    items.push(fieldItem("终局材料版本", integrity.terminalRevisionNo === null ? "历史基线" : `第 ${integrity.terminalRevisionNo} 版`));
    items.push(fieldItem("脱敏归档 SHA-256", integrity.archiveHash));
    items.push(fieldItem("原始证据 SHA-256", integrity.evidenceRecordHash));
    if (integrity.terminalRevisionHash) items.push(fieldItem("终局修订 SHA-256", integrity.terminalRevisionHash));
    if (integrity.terminalStateHash) items.push(fieldItem("终局材料 SHA-256", integrity.terminalStateHash));
  }
  items.push(textItem(integrity
    ? "本文件由 OriginMind × ARTS Robotics 联合研发 OA 生成，正文、签署证据与不可变归档材料对应。核验信息用于校验原始记录；页面时间均为北京时间。"
    : "本文件为当前审批版本，后续处理以 OA 中的记录为准；页面时间均为北京时间。", 8, { color: [0.42, 0.47, 0.49], gapBefore: 10, gapAfter: 0 }));
  return items;
}

function characterWidth(character: string) {
  const code = character.codePointAt(0) ?? 0x3f;
  return embeddedFontSupports(character) ? PDF_EMBEDDED_FONT_WIDTHS[code] ?? 1000 : code >= 32 && code <= 126 ? 500 : 1000;
}

function textWidth(value: string, size: number) {
  return Array.from(value).reduce((width, character) => width + characterWidth(character) * size / 1000, 0);
}

function wrapText(value: string, maximumWidth: number, size: number) {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    let width = 0;
    for (const character of paragraph) {
      const nextWidth = characterWidth(character) * size / 1000;
      if (line && width + nextWidth > maximumWidth) {
        // Avoid leading closing punctuation without overflowing the text column.
        const closing = /^[，。；：！？、）】》」』,.!?;:)]$/u.test(character);
        const last = Array.from(line).at(-1) || "";
        const word = closing || /^[A-Za-z0-9]/u.test(character) ? line.match(/[A-Za-z0-9]+$/u)?.[0] : undefined;
        if (word && line.length > word.length && textWidth(word + character, size) < maximumWidth / 2) {
          lines.push(line.slice(0, -word.length).trimEnd());
          line = word;
          width = textWidth(word, size);
        } else if (closing && line.length > last.length) {
          lines.push(line.slice(0, -last.length).trimEnd());
          line = last;
          width = textWidth(last, size);
        } else {
          lines.push(line.trimEnd());
          line = "";
          width = 0;
        }
      }
      line += character;
      width += nextWidth;
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

function textLines(item: TextItem) {
  return wrapText(item.text, PAGE_WIDTH - PAGE_LEFT - PAGE_RIGHT - (item.indent || 0), item.size);
}

function fieldLines(item: FieldItem) {
  return {
    labels: wrapText(item.label, FIELD_LABEL_WIDTH - 12, 9),
    values: wrapText(item.value, PAGE_WIDTH - PAGE_LEFT - PAGE_RIGHT - FIELD_LABEL_WIDTH - (item.indent || 0), 9.5),
  };
}

function shortHeader(value: string, maximumWidth: number) {
  let text = "";
  for (const character of cleanText(value)) {
    if (textWidth(text + character + "…", 8) > maximumWidth) return text + "…";
    text += character;
  }
  return text;
}

function unicodeHex(value: string) {
  let hex = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    const safeCodePoint = codePoint <= 0xffff ? codePoint : 0x3f;
    hex += safeCodePoint.toString(16).padStart(4, "0");
  }
  return hex.toUpperCase();
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function embeddedFontCompressed() {
  return embeddedFontCompressedCache ??= base64Bytes(PDF_EMBEDDED_FONT_COMPRESSED_BASE64);
}

function embeddedFontCidMapCompressed() {
  return embeddedFontCidMapCompressedCache ??= base64Bytes(PDF_EMBEDDED_FONT_CID_MAP_COMPRESSED_BASE64);
}

function embeddedFontSupports(character: string) {
  const codePoint = character.codePointAt(0) ?? 0x3f;
  if (codePoint > 0xffff) return false;
  const bits = embeddedFontSupportedBitsCache ??= base64Bytes(PDF_EMBEDDED_FONT_SUPPORTED_BITS_BASE64);
  return (bits[codePoint >> 3] & (1 << (codePoint & 7))) !== 0;
}

function textCommand(value: string, size: number, color: [number, number, number], x: number, y: number) {
  const runs: Array<{ embedded: boolean; text: string }> = [];
  for (const character of value) {
    const embedded = embeddedFontSupports(character);
    const current = runs.at(-1);
    if (current?.embedded === embedded) current.text += character;
    else runs.push({ embedded, text: character });
  }
  const commands = [`BT ${color.map(pdfNumber).join(" ")} rg 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm`];
  for (const run of runs) commands.push(`/${run.embedded ? "F1" : "F2"} ${pdfNumber(size)} Tf <${unicodeHex(run.text)}> Tj`);
  commands.push("ET");
  return commands.join(" ");
}

function embeddedFontToUnicodeCMap(values: Iterable<string>) {
  const characterCodes = new Set<number>();
  for (const value of values) {
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0x3f;
      if (codePoint <= 0xffff && embeddedFontSupports(character)) characterCodes.add(codePoint);
    }
  }
  const sortedCodes = [...characterCodes].sort((left, right) => left - right);
  const mappings: string[] = [];
  for (let offset = 0; offset < sortedCodes.length; offset += 100) {
    const chunk = sortedCodes.slice(offset, offset + 100);
    mappings.push(`${chunk.length} beginbfchar`);
    for (const codePoint of chunk) {
      const code = codePoint.toString(16).padStart(4, "0").toUpperCase();
      mappings.push(`<${code}> <${code}>`);
    }
    mappings.push("endbfchar");
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /${PDF_EMBEDDED_FONT_NAME}-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${mappings.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

function pdfNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

async function streamToBytes(stream: ReadableStream<Uint8Array>) {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function pngUint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function paeth(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

async function decodeSignatureImage(dataUrl: string): Promise<SignatureImage | null> {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  try {
    const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (character) => character.charCodeAt(0));
    if (bytes.length < 96 || pngUint32(bytes, 16) !== 900 || pngUint32(bytes, 20) !== 260 || bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) return null;
    const compressedChunks: Uint8Array[] = [];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = pngUint32(bytes, offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.length) return null;
      if (type === "IDAT") compressedChunks.push(bytes.slice(dataStart, dataEnd));
      offset = dataEnd + 4;
      if (type === "IEND") break;
    }
    const compressedLength = compressedChunks.reduce((total, chunk) => total + chunk.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let compressedOffset = 0;
    for (const chunk of compressedChunks) {
      compressed.set(chunk, compressedOffset);
      compressedOffset += chunk.length;
    }
    const filtered = await streamToBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")));
    const sourceWidth = 900;
    const sourceHeight = 260;
    const stride = sourceWidth * 4;
    if (filtered.byteLength !== (stride + 1) * sourceHeight) return null;
    const rgba = new Uint8Array(stride * sourceHeight);
    let sourceOffset = 0;
    for (let y = 0; y < sourceHeight; y += 1) {
      const filter = filtered[sourceOffset++];
      if (filter > 4) return null;
      for (let x = 0; x < stride; x += 1) {
        const raw = filtered[sourceOffset++];
        const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
        const above = y > 0 ? rgba[(y - 1) * stride + x] : 0;
        const upperLeft = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
        rgba[y * stride + x] = filter === 0 ? raw
          : filter === 1 ? (raw + left) & 0xff
            : filter === 2 ? (raw + above) & 0xff
              : filter === 3 ? (raw + Math.floor((left + above) / 2)) & 0xff
                : (raw + paeth(left, above, upperLeft)) & 0xff;
      }
    }
    const targetWidth = 300;
    const targetHeight = 87;
    const rgb = new Uint8Array(targetWidth * targetHeight * 3);
    for (let y = 0; y < targetHeight; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight));
      for (let x = 0; x < targetWidth; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, x * 3);
        const sourceIndex = sourceY * stride + sourceX * 4;
        const targetIndex = (y * targetWidth + x) * 3;
        const alpha = rgba[sourceIndex + 3] / 255;
        rgb[targetIndex] = Math.round(rgba[sourceIndex] * alpha + 255 * (1 - alpha));
        rgb[targetIndex + 1] = Math.round(rgba[sourceIndex + 1] * alpha + 255 * (1 - alpha));
        rgb[targetIndex + 2] = Math.round(rgba[sourceIndex + 2] * alpha + 255 * (1 - alpha));
      }
    }
    const compressedRgb = await streamToBytes(new Blob([rgb]).stream().pipeThrough(new CompressionStream("deflate")));
    return { width: targetWidth, height: targetHeight, compressedRgb };
  } catch {
    return null;
  }
}

function ascii(value: string) {
  return encoder.encode(value);
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function objectBytes(id: number, body: Uint8Array | string) {
  const content = typeof body === "string" ? ascii(body) : body;
  return concatBytes([ascii(`${id} 0 obj\n`), content, ascii("\nendobj\n")]);
}

function streamObjectBytes(id: number, dictionary: string, body: Uint8Array) {
  return objectBytes(id, concatBytes([ascii(`<< ${dictionary} /Length ${body.byteLength} >>\nstream\n`), body, ascii("\nendstream")]));
}

export async function buildApprovalPdf(input: ApprovalPdfInput) {
  const signatureDataUrl = typeof input.approval.payload.signatureDataUrl === "string" ? input.approval.payload.signatureDataUrl : "";
  const signature = signatureDataUrl ? await decodeSignatureImage(signatureDataUrl) : null;
  const pageItems: LayoutItem[][] = [[]];
  let y = PAGE_TOP;
  const nextPage = () => {
    pageItems.push([]);
    y = PAGE_TOP;
  };

  const layout = buildLayoutItems(input);
  for (const [itemIndex, item] of layout.entries()) {
    if (item.kind === "signature") {
      const needed = 96 + (item.gapAfter || 0);
      if (y - needed < PAGE_BOTTOM && pageItems.at(-1)?.length) nextPage();
      pageItems.at(-1)?.push(item);
      y -= needed;
      continue;
    }
    if (item.kind === "field") {
      const { labels, values } = fieldLines(item);
      const totalHeight = Math.max(labels.length, values.length) * FIELD_LEADING + (item.gapAfter || 0);
      if (totalHeight <= (PAGE_TOP - PAGE_BOTTOM) / 2 && y - totalHeight < PAGE_BOTTOM && pageItems.at(-1)?.length) nextPage();
      let offset = 0;
      while (offset < values.length) {
        let capacity = Math.floor((y - PAGE_BOTTOM - (item.gapAfter || 0)) / FIELD_LEADING);
        if (capacity < Math.max(1, labels.length) && pageItems.at(-1)?.length) {
          nextPage();
          capacity = Math.floor((y - PAGE_BOTTOM - (item.gapAfter || 0)) / FIELD_LEADING);
        }
        const chunk = values.slice(offset, offset + Math.max(1, capacity));
        const chunkItem = { ...item, label: offset ? item.label + "（续）" : item.label, value: chunk.join("\n") };
        pageItems.at(-1)?.push(chunkItem);
        y -= Math.max(fieldLines(chunkItem).labels.length, chunk.length) * FIELD_LEADING + (item.gapAfter || 0);
        offset += chunk.length;
        if (offset < values.length) nextPage();
      }
      continue;
    }
    if (item.pageBreakBefore && pageItems.at(-1)?.length) nextPage();
    const lines = textLines(item);
    const leading = item.leading || 15;
    const ownHeight = (item.gapBefore || 0) + lines.length * leading + (item.gapAfter || 0);
    const following = layout[itemIndex + 1];
    let followingHeight = 0;
    if (following?.kind === "field") {
      const nextLines = fieldLines(following);
      const nextHeight = Math.max(nextLines.labels.length, nextLines.values.length) * FIELD_LEADING + (following.gapAfter || 0);
      followingHeight = nextHeight <= (PAGE_TOP - PAGE_BOTTOM) / 2 ? nextHeight : 2 * FIELD_LEADING + (following.gapAfter || 0);
    } else if (following?.kind === "text") {
      followingHeight = Math.min(2, textLines(following).length) * (following.leading || 15) + (following.gapBefore || 0) + (following.gapAfter || 0);
    }
    const keepHeight = item.keepWithNext ? Math.max(item.keepWithNext, followingHeight) : 0;
    if (keepHeight && y - ownHeight - keepHeight < PAGE_BOTTOM && pageItems.at(-1)?.length) nextPage();
    let lineOffset = 0;
    while (lineOffset < lines.length) {
      const firstChunk = lineOffset === 0;
      const before = firstChunk ? item.gapBefore || 0 : 0;
      let capacity = Math.floor((y - PAGE_BOTTOM - before - (item.gapAfter || 0)) / leading);
      if ((capacity < 1 || (capacity === 1 && lines.length - lineOffset > 1)) && pageItems.at(-1)?.length) {
        nextPage();
        capacity = Math.floor((y - PAGE_BOTTOM - before - (item.gapAfter || 0)) / leading);
      }
      capacity = Math.max(1, capacity);
      if (lines.length - lineOffset - capacity === 1 && capacity > 1) capacity -= 1;
      const chunk = lines.slice(lineOffset, lineOffset + capacity);
      const chunkItem: TextItem = {
        ...item,
        text: chunk.join("\n"),
        section: firstChunk && item.section,
        gapBefore: before,
        gapAfter: lineOffset + chunk.length >= lines.length ? item.gapAfter : 0,
      };
      pageItems.at(-1)?.push(chunkItem);
      y -= before + chunk.length * leading + (chunkItem.gapAfter || 0);
      lineOffset += chunk.length;
      if (lineOffset < lines.length) nextPage();
    }
  }
  const imageObjectId = signature ? 11 : null;
  const firstPageObjectId = signature ? 12 : 11;
  const pageObjectIds = pageItems.map((_, index) => firstPageObjectId + index * 2);
  const contentObjectIds = pageItems.map((_, index) => firstPageObjectId + index * 2 + 1);
  const objects = new Map<number, Uint8Array>();
  objects.set(1, objectBytes(1, "<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, objectBytes(2, `<< /Type /Pages /Count ${pageItems.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`));
  objects.set(3, objectBytes(3, `<< /Type /Font /Subtype /Type0 /BaseFont /${PDF_EMBEDDED_FONT_NAME} /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 8 0 R >>`));
  objects.set(4, objectBytes(4, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${PDF_EMBEDDED_FONT_NAME} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /CIDToGIDMap 7 0 R /DW 1000 /W [${Object.entries(PDF_EMBEDDED_FONT_WIDTHS).map(([code, width]) => `${code} [${width}]`).join(" ")}] >>`));
  objects.set(5, objectBytes(5, `<< /Type /FontDescriptor /FontName /${PDF_EMBEDDED_FONT_NAME} /Flags 4 /FontBBox [-1002 -1048 2928 1808] /ItalicAngle 0 /Ascent 1000 /Descent -200 /CapHeight 733 /StemV 80 /MissingWidth 1000 /FontFile2 6 0 R >>`));
  objects.set(6, streamObjectBytes(6, `/Filter /FlateDecode /Length1 ${PDF_EMBEDDED_FONT_LENGTH}`, embeddedFontCompressed()));
  objects.set(7, streamObjectBytes(7, "/Filter /FlateDecode", embeddedFontCidMapCompressed()));
const continuationTitle = shortHeader(input.approval.title, PAGE_WIDTH - PAGE_LEFT - PAGE_RIGHT - 90);
  const footerId = shortHeader(input.approval.id, 350);
  const toUnicodeText = pageItems.flatMap((items, pageIndex) => [
    ...items.flatMap((item) => item.kind === "text" ? [item.text] : item.kind === "field" ? [item.label, item.value] : []),
    pageIndex > 0 ? continuationTitle : "",
    footerId,
    `第 ${pageIndex + 1} / ${pageItems.length} 页`,
    "签名图像不可用于当前导出",
  ]);
  objects.set(8, streamObjectBytes(8, "", ascii(embeddedFontToUnicodeCMap(toUnicodeText))));
  objects.set(9, objectBytes(9, "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [10 0 R] >>"));
  objects.set(10, objectBytes(10, "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 /W [32 126 500] >>"));
  if (signature && imageObjectId) {
    objects.set(imageObjectId, streamObjectBytes(imageObjectId, `/Type /XObject /Subtype /Image /Width ${signature.width} /Height ${signature.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, signature.compressedRgb));
  }

  pageItems.forEach((items, pageIndex) => {
    let cursorY = PAGE_TOP;
    const commands: string[] = [];
if (pageIndex > 0) {
      commands.push(textCommand(continuationTitle, 8, [0.42, 0.47, 0.49], PAGE_LEFT, 813));
      commands.push(`${PAGE_LEFT} 804 ${PAGE_WIDTH - PAGE_LEFT - PAGE_RIGHT} 0.5 re 0.85 0.88 0.89 rg f`);
    }
    for (const item of items) {
      if (item.kind === "signature") {
        const bottom = cursorY - 90;
        commands.push(`q 0.82 0.86 0.87 RG 0.6 w ${PAGE_LEFT} ${pdfNumber(bottom)} 320 96 re S Q`);
        if (signature && imageObjectId) {
          const width = 300;
          const height = width * signature.height / signature.width;
          commands.push(`q ${width} 0 0 ${pdfNumber(height)} ${PAGE_LEFT + 10} ${pdfNumber(bottom + (96 - height) / 2)} cm /Sig Do Q`);
        } else {
          commands.push(textCommand("签名图像不可用于当前导出", 9, [0.45, 0.48, 0.49], PAGE_LEFT + 16, cursorY - 42));
        }
        cursorY -= 96 + (item.gapAfter || 0);
        continue;
      }
      if (item.kind === "field") {
        const { labels, values } = fieldLines(item);
        const x = PAGE_LEFT + (item.indent || 0);
        labels.forEach((line, index) => commands.push(textCommand(line, 9, [0.38, 0.44, 0.46], x, cursorY - index * FIELD_LEADING)));
        values.forEach((line, index) => commands.push(textCommand(line, 9.5, [0.12, 0.16, 0.19], x + FIELD_LABEL_WIDTH, cursorY - index * FIELD_LEADING)));
        cursorY -= Math.max(labels.length, values.length) * FIELD_LEADING + (item.gapAfter || 0);
        continue;
      }
      cursorY -= item.gapBefore || 0;
      const lines = textLines(item);
      if (item.section) commands.push(`${PAGE_LEFT} ${pdfNumber(cursorY - 7)} ${PAGE_WIDTH - PAGE_LEFT - PAGE_RIGHT} 0.5 re 0.82 0.87 0.88 rg f`);
      for (const line of lines) {
        const x = item.align === "center" ? (PAGE_WIDTH - textWidth(line, item.size)) / 2 : PAGE_LEFT + (item.indent || 0);
        commands.push(textCommand(line, item.size, item.color, x, cursorY));
        cursorY -= item.leading || 15;
      }
      cursorY -= item.gapAfter || 0;
    }
    commands.push(`${PAGE_LEFT} 45 ${PAGE_WIDTH - PAGE_LEFT - PAGE_RIGHT} 0.5 re 0.82 0.87 0.88 rg f`);
    commands.push(textCommand(footerId, 8, [0.42, 0.47, 0.49], PAGE_LEFT, 30));
    const pageNumber = `第 ${pageIndex + 1} / ${pageItems.length} 页`;
    commands.push(textCommand(pageNumber, 8, [0.42, 0.47, 0.49], PAGE_WIDTH - PAGE_RIGHT - textWidth(pageNumber, 8), 30));
    const content = ascii(commands.join("\n"));
    const resources = signature && imageObjectId ? `<< /Font << /F1 3 0 R /F2 9 0 R >> /XObject << /Sig ${imageObjectId} 0 R >> >>` : "<< /Font << /F1 3 0 R /F2 9 0 R >> >>";
    objects.set(pageObjectIds[pageIndex], objectBytes(pageObjectIds[pageIndex], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contentObjectIds[pageIndex]} 0 R >>`));
    objects.set(contentObjectIds[pageIndex], streamObjectBytes(contentObjectIds[pageIndex], "", content));
  });

  const objectCount = Math.max(...objects.keys());
  const header = concatBytes([ascii("%PDF-1.7\n%"), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), ascii("\n")]);
  const parts: Uint8Array[] = [header];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let offset = header.byteLength;
  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects.get(id);
    if (!object) throw new Error(`PDF object ${id} is missing`);
    offsets[id] = offset;
    parts.push(object);
    offset += object.byteLength;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objectCount + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${value.toString().padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("\n");
  parts.push(ascii(xref));
  return concatBytes(parts);
}

export function safeApprovalPdfFileName(approval: Pick<ApprovalPdfRecord, "id" | "title" | "updatedAt">, archiveHash = "") {
  const date = Number.isNaN(Date.parse(approval.updatedAt)) ? "00000000-0000" : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(approval.updatedAt)).replace(/[^0-9]/gu, "").slice(0, 12);
  const id = cleanText(approval.id).replace(/[^A-Za-z0-9._-]/gu, "-").replace(/-+/gu, "-").replace(/^[-.]+|[-.]+$/gu, "").slice(0, 60) || "approval";
  const title = cleanText(approval.title).replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-").replace(/\s+/gu, " ").slice(0, 72) || "审批归档";
  const suffix = archiveHash ? `-${archiveHash.slice(0, 12)}` : "";
  return `${date}-${id}-${title}${suffix}.pdf`;
}

export function safeFeishuArchivePdfFileName(approval: Pick<ApprovalPdfRecord, "id" | "title" | "updatedAt">, archiveHash = "") {
  const readableStem = safeApprovalPdfFileName(approval, archiveHash).replace(/\.pdf$/iu, "");
  const asciiStem = readableStem
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "")
    .slice(0, 173);
  return `OA-${asciiStem || "approval"}.pdf`;
}
