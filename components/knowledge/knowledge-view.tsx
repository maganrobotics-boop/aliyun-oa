"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  FileText,
  Globe2,
  Info,
  LibraryBig,
  LoaderCircle,
  MessageCircle,
  Pencil,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { KnowledgePackageImport } from "./package-import";
import { KnowledgeBatchDelete } from "./knowledge-batch-delete";
import { KnowledgeBatchVisibility, type KnowledgeManageRowProps } from "./knowledge-batch-visibility";
import type { KnowledgeVisibilityUpdate } from "@/lib/knowledge-visibility-batch";
import { OaChatPanel } from "./oa-chat-panel";
import { OaRichAnswer } from "./oa-rich-answer";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_LIST_QUERY_MAX_LENGTH } from "@/lib/knowledge-types";
import { PUBLIC_KNOWLEDGE_CONFIRMATION } from "@/lib/knowledge-policy";
import { knowledgeScopeFilterOptions, knowledgeStateFilterOptions, matchesKnowledgeListFilters, type KnowledgeStateFilter, type KnowledgeScopeFilter } from "@/lib/knowledge-list-filters";
import type {
  KnowledgeAction,
  KnowledgeAsset,
  KnowledgeDetailResponse,
  KnowledgeEvent,
  KnowledgeItem,
  KnowledgeListResponse,
  KnowledgeListSort,
  KnowledgeRevision,
  KnowledgeStatus,
  KnowledgeVisibility,
} from "@/lib/knowledge-types";

export type KnowledgeTab = "ask" | "submit" | "mine" | "review" | "manage";
type KnowledgeDraft = { title: string; category: string; summary: string; content: string; sourceLabel: string; sourceUrl: string };
type ReviewDetail = Required<Pick<KnowledgeDetailResponse, "revisions" | "events">> & { item: KnowledgeItem; assets?: KnowledgeAsset[] };

const knowledgeManageSortOptions: ReadonlyArray<{ value: KnowledgeListSort; label: string }> = [
  { value: "updated_desc", label: "最近更新" },
  { value: "updated_asc", label: "最早更新" },
  { value: "title_asc", label: "标题 A-Z" },
  { value: "title_desc", label: "标题 Z-A" },
];

const categories = ["技术方案", "实验记录", "设备与操作", "软件与代码", "项目规范", "常见问题", "其他"];
const emptyDraft = (): KnowledgeDraft => ({ title: "", category: categories[0], summary: "", content: "", sourceLabel: "", sourceUrl: "" });
const PUBLIC_DATA_ANONYMIZATION_NOTICE = "所有公开的数据需要脱敏处理。脱敏时，论文和学位材料保留摘要、研究方法、实验过程、结果与结论等技术正文，删除封面、参考文献作者表、致谢、评语、签字页等身份信息密集内容；对于扫描件，仅保留匿名化摘要和检索说明，不嵌入含姓名、学号、签名、地址等个人隐私的原始图片。";

const statusMeta: Record<KnowledgeStatus, { label: string; detail: string }> = {
  pending: { label: "待审核", detail: "等待项目负责人或 OA 管理员审核" },
  returned: { label: "已退回", detail: "请按审核意见修改后重提" },
  rejected: { label: "已拒绝", detail: "本版本不会进入知识库" },
  active: { label: "已入库", detail: "已按当前可见范围提供检索" },
  revoked: { label: "已撤销", detail: "已停止用于对应范围的知识问答" },
};

function knowledgeVisibility(item: KnowledgeItem): KnowledgeVisibility | undefined {
  if (item.status !== "active" && item.status !== "revoked") return undefined;
  const value = (item as KnowledgeItem & { visibility?: unknown }).visibility;
  if (value === "internal" || value === "public") return value;
  return "internal";
}

async function responseJson<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

function formatDate(value?: string) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
}

function normalizeKnowledgeListQuery(value: string) {
  return Array.from(value.trim()).slice(0, KNOWLEDGE_LIST_QUERY_MAX_LENGTH).join("");
}

function safeHttpUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function currentRevision(detail: ReviewDetail): KnowledgeRevision | undefined {
  return detail.revisions.find((revision) => revision.id === detail.item.currentRevisionId)
    || [...detail.revisions].sort((a, b) => (b.revisionNo || 0) - (a.revisionNo || 0))[0];
}

function KnowledgeStatusBadge({ status }: { status: KnowledgeStatus }) {
  const meta = statusMeta[status] || statusMeta.pending;
  return <Badge variant="outline" className={`knowledge-status knowledge-status-${status}`}><span />{meta.label}</Badge>;
}

function KnowledgeVisibilityBadge({ item }: { item: KnowledgeItem }) {
  const visibility = knowledgeVisibility(item);
  if (!visibility) return null;
  return <Badge variant="outline" className={`knowledge-visibility knowledge-visibility-${visibility}`}>{visibility === "public" ? <Globe2 className="size-3" /> : <ShieldCheck className="size-3" />}{visibility === "public" ? "对外公开" : "仅 OA 内部"}</Badge>;
}

function KnowledgeDestinationBadge({ item }: { item: KnowledgeItem }) {
  const visibility = knowledgeVisibility(item);
  if (!visibility) return null;
  return <Badge variant="outline" className={`knowledge-destination knowledge-destination-${visibility}`}>{visibility === "public" ? "ARTS Robotics" : "OriginMind"}</Badge>;
}

function KnowledgeMultipartReviewMeta({ item }: { item: KnowledgeItem }) {
  if (!item.contentPartCount || item.contentPartCount <= 1) return null;
  return <span>1 个文件 · {item.contentPartCount} 个正文分片 · 统一审核</span>;
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: typeof BookOpen; title: string; description: string; action?: React.ReactNode }) {
  return <div className="knowledge-empty"><div className="knowledge-empty-icon"><Icon className="size-5" /></div><strong>{title}</strong><p>{description}</p>{action}</div>;
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="knowledge-loading" role="status"><LoaderCircle className="size-4" />{label}</div>;
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="knowledge-error" role="alert"><AlertTriangle className="size-5" /><div><strong>暂时无法加载</strong><p>{message}</p></div><Button type="button" variant="outline" size="sm" onClick={onRetry}><RotateCcw className="size-3.5" />重试</Button></div>;
}

function KnowledgeAnonymizationNotice() {
  return <div className="knowledge-submit-note knowledge-anonymization-note" role="note"><ShieldCheck className="size-4" /><p><strong>公开数据脱敏要求</strong>{PUBLIC_DATA_ANONYMIZATION_NOTICE}</p></div>;
}

function KnowledgeAskPanel({ isAdmin }: { isAdmin: boolean }) { return <OaChatPanel isAdmin={isAdmin} />; }

function KnowledgeSubmitPanel({
  draft,
  setDraft,
  editingItem,
  submitting,
  onSubmit,
  onCancelEdit,
}: {
  draft: KnowledgeDraft;
  setDraft: React.Dispatch<React.SetStateAction<KnowledgeDraft>>;
  editingItem: KnowledgeItem | null;
  submitting: boolean;
  onSubmit: (event: FormEvent) => void;
  onCancelEdit: () => void;
}) {
  return <section className="knowledge-form-card">
    <div className="knowledge-card-heading"><div className="knowledge-card-icon"><FileText className="size-[18px]" /></div><div><h2>{editingItem ? "修改并重新提交" : "提交一条实验室知识"}</h2><p>{editingItem ? "请按审核意见完善内容；重提后将重新进入审核队列。" : "所有已完成 OA 准入的成员都可以投稿；审核人批准时再选择对内或对外公开。"}</p></div></div>
    {editingItem && <div className="knowledge-editing-banner"><Pencil className="size-4" /><div><strong>正在修改：{editingItem.title}</strong><p>{editingItem.reviewNote || "请完善内容后重新提交。"}</p></div><button type="button" onClick={onCancelEdit} aria-label="取消修改"><X className="size-4" /></button></div>}
    <form className="knowledge-submit-form" onSubmit={onSubmit}>
      <div className="knowledge-form-grid">
        <label className="form-field"><span className="field-label">知识标题 <b className="required-mark">*</b></span><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="一句话说明这条知识解决什么问题" minLength={2} maxLength={100} required disabled={submitting} /></label>
        <label className="form-field"><span className="field-label">分类 <b className="required-mark">*</b></span><NativeSelect value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} disabled={submitting}>{categories.map((category) => <NativeSelectOption value={category} key={category}>{category}</NativeSelectOption>)}</NativeSelect></label>
      </div>
      <label className="form-field"><span className="field-label">摘要 <small>可选</small></span><Input value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="用一两句话概括适用场景和结论" maxLength={400} disabled={submitting} /></label>
      <label className="form-field"><span className="field-label">知识正文 <b className="required-mark">*</b></span><Textarea className="knowledge-content-input" value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} placeholder={"建议写清楚：\n1. 适用条件和前置准备\n2. 操作步骤或技术结论\n3. 风险、限制和验证方式"} rows={12} minLength={10} maxLength={20_000} required disabled={submitting} /><span className="knowledge-character-count">{draft.content.length.toLocaleString("zh-CN")} / 20,000</span></label>
      <div className="knowledge-form-grid">
        <label className="form-field"><span className="field-label">来源名称 <small>可选</small></span><Input value={draft.sourceLabel} onChange={(event) => setDraft((current) => ({ ...current, sourceLabel: event.target.value }))} placeholder="例如：底盘联调记录 2026-09" maxLength={160} disabled={submitting} /></label>
        <label className="form-field"><span className="field-label">来源链接 <small>可选，仅 http/https</small></span><Input type="url" inputMode="url" value={draft.sourceUrl} onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://…" maxLength={2048} disabled={submitting} /></label>
      </div>
      <KnowledgeAnonymizationNotice />
      <div className="knowledge-submit-note"><Info className="size-4" /><p><strong>提交前请确认</strong>内容不含个人隐私、账号密码或密钥；审核人批准时会选择仅供 OA 内部使用，或经二次确认后对外公开。</p></div>
      <div className="knowledge-form-actions">{editingItem && <Button type="button" variant="outline" onClick={onCancelEdit} disabled={submitting}>取消修改</Button>}<Button type="submit" className="primary-button" disabled={submitting}>{submitting ? <LoaderCircle className="size-4" /> : <Send className="size-4" />}{submitting ? "提交中" : editingItem ? "重新提交审核" : "提交审核"}</Button></div>
    </form>
  </section>;
}

function KnowledgeItemCard({ item, onEdit, onDelete, deleting = false }: { item: KnowledgeItem; onEdit?: (item: KnowledgeItem) => void; onDelete?: (item: KnowledgeItem) => void; deleting?: boolean }) {
  const meta = statusMeta[item.status] || statusMeta.pending;
  const isMultipartImport = Boolean(item.contentPartCount && item.contentPartCount > 1);
  return <article className="knowledge-item-card">
    <div className="knowledge-item-topline"><span className="knowledge-category">{item.category}</span><div className="knowledge-item-badges"><KnowledgeVisibilityBadge item={item} /><KnowledgeStatusBadge status={item.status} /></div></div>
    <h3>{item.title}</h3>
    {item.summary && <p className="knowledge-item-summary">{item.summary}</p>}
    <div className="knowledge-item-state"><span>{meta.detail}</span>{item.currentRevisionNo && <small>第 {item.currentRevisionNo} 版</small>}</div>
    {item.reviewNote && <div className="knowledge-review-note"><MessageCircle className="size-3.5" /><div><strong>审核意见</strong><p>{item.reviewNote}</p></div></div>}
    <footer><time dateTime={item.updatedAt}>更新于 {formatDate(item.updatedAt)}</time>{item.status === "returned" && isMultipartImport ? <Button type="button" variant="outline" size="sm" onClick={() => onEdit?.(item)} disabled={!onEdit}><Pencil className="size-3.5" />在 OA 重新上传</Button> : item.status === "returned" && onEdit && <Button type="button" variant="outline" size="sm" onClick={() => onEdit(item)}><Pencil className="size-3.5" />修改并重提</Button>}{item.canDelete === true && onDelete && <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => onDelete(item)}><Trash2 className="size-3.5" />{deleting ? "删除中…" : "删除"}</Button>}</footer>
  </article>;
}

function KnowledgeMinePanel({ items, loading, error, onRetry, onEdit, onDeleted, onFinished, editingId }: {
  items: KnowledgeItem[]; loading: boolean; error: string; onRetry: () => void;
  onEdit: (item: KnowledgeItem) => void; onDeleted: (ids: string[]) => void;
  onFinished: () => void; editingId: string;
}) {
  return <div className="knowledge-list">
    <div className="knowledge-list-summary"><span>本人投稿共 {items.length} 条</span><small>最多显示最近 1000 条；删除后保留历史版本和审核记录</small></div>
    <KnowledgeBatchDelete items={items} disabled={loading || Boolean(editingId)} onEdit={onEdit}
      ItemCard={KnowledgeItemCard} onDeleted={onDeleted} onFinished={onFinished}>
      {loading && <LoadingPanel label="正在加载我的知识投稿…" />}
      {error && <ErrorPanel message={error} onRetry={onRetry} />}
      {!items.length && !loading && !error && <EmptyPanel icon={FileText} title="暂无本人提交的资料" description="您可以上传资料，也可以在这里勾选并批量删除自己上传的资料。" />}
    </KnowledgeBatchDelete>
  </div>;
}

function KnowledgeReviewPanel({ items, pendingCount, loading, error, onRetry, onOpen }: { items: KnowledgeItem[]; pendingCount: number; loading: boolean; error: string; onRetry: () => void; onOpen: (item: KnowledgeItem) => void }) {
  const [checked, setChecked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [bulkVisibility, setBulkVisibility] = useState<KnowledgeVisibility>("internal");
  const [bulkPublicConfirmation, setBulkPublicConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const stopped = useRef(false);
  const running = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);
  const eligible = items.filter(item => item.status === "pending" && item.canReview !== false);
  const chosen = eligible.filter(item => checked.includes(item.id));
  const all = eligible.length > 0 && chosen.length === eligible.length;
  const toggle = (id: string) => { setConfirming(false); setChecked(value => value.includes(id) ? value.filter(key => key !== id) : [...value, id]); };
  const run = async () => {
    if (running.current || !chosen.length || (bulkVisibility === "public" && bulkPublicConfirmation !== PUBLIC_KNOWLEDGE_CONFIRMATION)) return;
    const visibility = bulkVisibility;
    const publicConfirmation = bulkPublicConfirmation;
    running.current = true; stopped.current = false; setBusy(true); setConfirming(false); setFailures([]);
    const snapshot = chosen.map(item => ({ ...item }));
    const succeeded: string[] = [];
    const failed: string[] = [];
    let processed = 0;
    try {
      for (const item of snapshot) {
        if (stopped.current) break;
        setProgress(`正在处理 ${processed + 1} / ${snapshot.length}：${item.title}`);
        try {
          const detailResponse = await fetch(`/api/knowledge/${encodeURIComponent(item.id)}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
          const detail = await detailResponse.json() as ReviewDetail & { error?: string };
          if (!detailResponse.ok || !detail.item) throw new Error(detail.error || "正文读取失败");
          const revision = detail.revisions?.find(value => value.id === detail.item.currentRevisionId);
          const content = revision?.content || detail.item.content || "";
          if (detail.item.status !== "pending" || detail.item.canReview === false) throw new Error("状态或权限已变化，请刷新后核对");
          if (detail.item.mutationRevision !== item.mutationRevision) throw new Error("选中后资料已更新，请重新审核");
          if (!content.trim()) throw new Error("正文不完整，未批准");
          const response = await fetch(`/api/knowledge/${encodeURIComponent(item.id)}`, {
            method: "PATCH", credentials: "same-origin",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ action: "approve", visibility, ...(visibility === "public" ? { publicConfirmation } : {}), mutationRevision: item.mutationRevision, note: visibility === "public" ? "批量审核通过，对外公开" : "批量审核通过，仅 OA 内部使用" }),
          });
          const result = await response.json() as { item?: KnowledgeItem; error?: string };
          if (!response.ok || result.item?.status !== "active" || result.item?.visibility !== visibility) {
            if (response.status === 429 || response.status === 401 || response.status === 403) stopped.current = true;
            throw new Error(result.error || "未能确认审核结果，请刷新核对");
          }
          succeeded.push(item.id);
        } catch (cause) {
          failed.push(`${item.title}：${cause instanceof Error ? cause.message : "处理失败"}`);
        }
        processed += 1;
        if (processed < snapshot.length && !stopped.current) await new Promise(resolve => setTimeout(resolve, 3200));
      }
    } finally {
      setChecked(value => value.filter(id => !succeeded.includes(id)));
      setFailures(failed);
      setProgress(`已通过并设为${visibility === "public" ? "对外" : "对内"} ${succeeded.length} 条；失败 ${failed.length} 条；未处理 ${snapshot.length - processed} 条。`);
      setBusy(false); running.current = false;
      onRetry();
      window.dispatchEvent(new Event("oa-library-updated"));
    }
  };
  if (loading && !busy) return <LoadingPanel label="正在加载待审核知识…" />;
  if (error && !busy) return <ErrorPanel message={error} onRetry={onRetry} />;
  return <div className="knowledge-list">
    <div className="knowledge-list-summary"><span>待审核 {pendingCount || items.length} 条{pendingCount > items.length ? `，当前显示前 ${items.length} 条` : ""}</span><small>批量操作会审核入库；请先核对内容。全选仅包含当前已加载且可审核的资料。</small></div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "12px 0" }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}><input type="checkbox" aria-label="全选当前待审资料" checked={all} disabled={busy || !eligible.length} onChange={() => { setConfirming(false); setChecked(all ? [] : eligible.map(item => item.id)); }} />全选</label>
      <span>已选 {chosen.length} 条</span>
      <Button type="button" variant="outline" disabled={busy || !chosen.length} onClick={() => { setChecked([]); setConfirming(false); }}>取消选择</Button>
      <label className="knowledge-bulk-scope"><span>批量审核范围</span><NativeSelect value={bulkVisibility} disabled={busy} onChange={event => { setBulkVisibility(event.target.value as KnowledgeVisibility); setConfirming(false); setBulkPublicConfirmation(""); }} aria-label="批量审核范围"><NativeSelectOption value="internal">对内</NativeSelectOption><NativeSelectOption value="public">对外</NativeSelectOption></NativeSelect></label>
      <Button type="button" disabled={busy || !chosen.length} onClick={() => { setBulkPublicConfirmation(""); setConfirming(true); }}>批量通过并设为{bulkVisibility === "public" ? "对外" : "对内"}</Button>
      {busy && <Button type="button" variant="outline" onClick={() => { stopped.current = true; }}>停止后续处理</Button>}
    </div>
    {confirming && !busy && <div role="group" aria-label="确认批量审核" style={{ padding: 12, border: "1px solid #ccc", borderRadius: 8 }}>
      <p>将选中的 {chosen.length} 条资料审核通过并设为{bulkVisibility === "public" ? "对外公开，供 chat.omindos.cn 检索。" : "对内，供已完成准入的 OA 成员检索。"}</p>
      {bulkVisibility === "public" && <label className="knowledge-public-confirmation"><span>二次确认：输入 <code>{PUBLIC_KNOWLEDGE_CONFIRMATION}</code></span><Input aria-label="批量对外公开确认" value={bulkPublicConfirmation} onChange={event => setBulkPublicConfirmation(event.target.value)} placeholder={PUBLIC_KNOWLEDGE_CONFIRMATION} autoComplete="off" spellCheck={false} /><small>请确认选中资料均已完成审核与脱敏。公开后仍可在 OA 内检索。</small></label>}
      <Button type="button" disabled={bulkVisibility === "public" && bulkPublicConfirmation !== PUBLIC_KNOWLEDGE_CONFIRMATION} onClick={() => void run()}>确认通过 {chosen.length} 条</Button>{" "}
      <Button type="button" variant="outline" onClick={() => setConfirming(false)}>取消</Button>
    </div>}
    {progress && <p role="status" aria-live="polite">{progress}{busy && " 请保持本页打开。"}</p>}
    {failures.length > 0 && <details><summary>查看失败明细（{failures.length} 条）</summary><ul>{failures.map((value, index) => <li key={index}>{value}</li>)}</ul></details>}
    {!items.length ? <EmptyPanel icon={Check} title="当前没有待审核知识" description="新的成员投稿会出现在这里。" /> : <div className="knowledge-review-list">{items.map(item => <article className="knowledge-review-row" key={item.id}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}><input type="checkbox" aria-label={`选择：${item.title}`} disabled={busy || item.canReview === false || item.status !== "pending"} checked={checked.includes(item.id)} onChange={() => toggle(item.id)} /><span>选择</span></label>
      <div className="knowledge-review-row-main"><div><span className="knowledge-category">{item.category}</span><time>{formatDate(item.createdAt)}</time></div><h3>{item.title}</h3>{item.summary && <p>{item.summary}</p>}{item.contentPartCount && item.contentPartCount > 1 && <small><KnowledgeMultipartReviewMeta item={item} /></small>}<small>提交人：{item.submitterName || item.submitterEmail || "项目成员"}</small></div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => onOpen(item)}>查看并选择范围</Button>
    </article>)}</div>}
  </div>;
}

function KnowledgeManageRow({ item, selected, selectable, disabled, onToggle, onOpen, onRevoke, onAdminEdit }: KnowledgeManageRowProps) {
  return <article className="knowledge-manage-row" data-selected={selected}>
    <label className="knowledge-manage-select"><input type="checkbox" aria-label={`选择范围调整：${item.title}`}
      checked={selected} disabled={disabled || !selectable} onChange={onToggle} />选择此资料</label>
    <div className="knowledge-manage-main"><div><span className="knowledge-category">{item.category}</span><KnowledgeDestinationBadge item={item} /><KnowledgeVisibilityBadge item={item} /><KnowledgeStatusBadge status={item.status} /></div><h3>{item.title}</h3>{item.summary && <p>{item.summary}</p>}<small>{item.submitterName || item.submitterEmail || "项目成员"} · 更新于 {formatDate(item.updatedAt)}</small></div>
    <div className="knowledge-manage-actions">{item.canAdminEdit && <Button type="button" disabled={disabled} onClick={() => onAdminEdit(item)}><Pencil className="size-3.5" />修改题目和内容</Button>}<Button type="button" variant="outline" disabled={disabled} onClick={() => onOpen(item)}>{item.status === "active" && item.canSetVisibility ? "同步到联合知识库" : "查看详情"}</Button>{item.status === "active" && item.canRevoke ? <Button type="button" variant="outline" className="knowledge-revoke-button" disabled={disabled} onClick={() => onRevoke(item)}>停止用于问答</Button> : item.status === "active" && !item.canSetVisibility ? <span className="knowledge-manage-state">本人投稿需由其他负责人处理</span> : item.status !== "active" ? <span className="knowledge-manage-state">{statusMeta[item.status]?.detail || "状态已记录"}</span> : null}</div>
  </article>;
}

function KnowledgeManagePanel({ items, loading, error, query, appliedQuery, sort, onQueryChange, onSortChange, onClearQuery, onRetry, onChanged, onFinished, onOpen, onRevoke, onAdminEdit }: { items: KnowledgeItem[]; loading: boolean; error: string; query: string; appliedQuery: string; sort: KnowledgeListSort; onQueryChange: (value: string) => void; onSortChange: (value: KnowledgeListSort) => void; onClearQuery: () => void; onRetry: () => void; onChanged: (items: KnowledgeVisibilityUpdate[]) => void; onFinished: () => void; onOpen: (item: KnowledgeItem) => void; onRevoke: (item: KnowledgeItem) => void; onAdminEdit: (item: KnowledgeItem) => void }) {
  const [stateFilter, setStateFilter] = useState<KnowledgeStateFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<KnowledgeScopeFilter>("all");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchTarget, setBatchTarget] = useState<KnowledgeVisibility>("public");
  const hasAppliedQuery = Boolean(appliedQuery);
  const filtered = hasAppliedQuery || stateFilter !== "all" || scopeFilter !== "all";
  const visible = items.filter(item => matchesKnowledgeListFilters(item, stateFilter, scopeFilter));
  const clearFilters = () => { setStateFilter("all"); setScopeFilter("all"); onClearQuery(); };
  const selectionContext = JSON.stringify([query, appliedQuery, sort, stateFilter, scopeFilter]);

  return <section className="knowledge-manage-panel">
    <div className="knowledge-manage-toolbar" role="search" aria-label="搜索和排序知识库">
      <label className="knowledge-manage-search">
        <span className="sr-only">搜索知识库</span>
        <Search className="size-4" aria-hidden="true" />
        <Input type="search" value={query} disabled={batchBusy}
          onChange={event => onQueryChange(Array.from(event.target.value).slice(0, KNOWLEDGE_LIST_QUERY_MAX_LENGTH).join(""))}
          placeholder="搜索标题、摘要、正文、分类或来源" maxLength={KNOWLEDGE_LIST_QUERY_MAX_LENGTH}
          autoComplete="off" enterKeyHint="search" />
        {query && <button type="button" className="knowledge-manage-search-clear" disabled={batchBusy} onClick={onClearQuery} aria-label="清空搜索关键词" title="清空搜索"><X className="size-4" /></button>}
      </label>
      <div className="knowledge-manage-filters">
        <NativeSelect value={stateFilter} disabled={batchBusy} onChange={event => setStateFilter(event.target.value as KnowledgeStateFilter)} aria-label="知识入库状态">{knowledgeStateFilterOptions.map(option => <NativeSelectOption value={option.value} key={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect value={scopeFilter} disabled={batchBusy} onChange={event => setScopeFilter(event.target.value as KnowledgeScopeFilter)} aria-label="知识可见范围">{knowledgeScopeFilterOptions.map(option => <NativeSelectOption value={option.value} key={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect>
        {filtered && <Button type="button" variant="outline" size="icon" disabled={batchBusy} onClick={clearFilters} aria-label="清除全部筛选" title="清除全部筛选"><X className="size-4" /></Button>}
      </div>
      <label className="knowledge-manage-sort"><span className="sr-only">知识库排序方式</span>
        <NativeSelect value={sort} disabled={batchBusy} onChange={event => onSortChange(event.target.value as KnowledgeListSort)} aria-label="知识库排序方式">
          {knowledgeManageSortOptions.map(option => <NativeSelectOption value={option.value} key={option.value}>{option.label}</NativeSelectOption>)}
        </NativeSelect>
      </label>
    </div>
    <KnowledgeBatchVisibility key={selectionContext} items={loading || error ? [] : visible} disabled={loading || Boolean(error)}
      target={batchTarget} onTargetChange={setBatchTarget} publicNotice={PUBLIC_DATA_ANONYMIZATION_NOTICE} onBusyChange={setBatchBusy} onChanged={onChanged} onFinished={onFinished}
      onOpen={onOpen} onRevoke={onRevoke} onAdminEdit={onAdminEdit} ItemRow={KnowledgeManageRow}>
      {loading ? <LoadingPanel label={query.trim() ? "正在搜索知识库…" : "正在加载知识库条目…"} />
        : error ? <ErrorPanel message={error} onRetry={onRetry} />
        : !visible.length ? <EmptyPanel icon={LibraryBig} title={filtered ? "没有找到匹配的知识" : "知识库还是空的"}
          description={filtered ? "请调整关键词、状态或范围，或清除全部筛选后查看知识记录。" : "审核通过的投稿会成为有效知识；其他状态的历史记录也会保留在这里。"}
          action={filtered ? <Button type="button" variant="outline" disabled={batchBusy} onClick={clearFilters}>清除全部筛选</Button> : undefined} />
        : <div className="knowledge-list-summary"><span>{filtered ? `显示 ${visible.length} / ${items.length} 条匹配记录` : `当前显示 ${items.length} 条知识记录`}</span>
          <small>{items.length === 1000 ? "最多显示前 1000 条；可继续缩小关键词范围" : "已入库知识可批量调整对内/对外；所有调整和撤销都会保留审核轨迹"}</small></div>}
    </KnowledgeBatchVisibility>
  </section>;
}


const eventLabels: Record<string, string> = {
  submitted: "提交审核",
  resubmitted: "重新提交",
  approved: "审核入库（仅 OA 内部）",
  approved_internal: "批准为仅 OA 内部",
  approved_public: "批准为对外公开",
  visibility_changed_internal: "调整为仅 OA 内部",
  visibility_changed_public: "调整为对外公开",
  admin_edited: "管理员修改题目和内容",
  admin_edit_staged: "管理员上传修改版本",
  returned: "退回修改",
  rejected: "拒绝入库",
  revoked: "停止问答",
};

function revisionStatusLabel(status?: KnowledgeRevision["status"]) {
  if (status === "superseded") return "已被新版替换";
  return status ? statusMeta[status]?.label || status : "状态未记录";
}

function KnowledgeHistory({ detail }: { detail: ReviewDetail }) {
  const revisions = [...detail.revisions].sort((left, right) => (right.revisionNo || 0) - (left.revisionNo || 0));
  const events = [...detail.events].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return <details className="knowledge-history">
    <summary>历史版本与审核记录 <span>{revisions.length} 个版本 · {events.length} 条事件</span></summary>
    <div className="knowledge-history-body">
      <div className="knowledge-history-revisions">{revisions.map((item) => <article key={item.id}>
        <header><strong>第 {item.revisionNo || 1} 版</strong><span>{revisionStatusLabel(item.status)}</span><time>{formatDate(item.createdAt)}</time></header>
        <small>提交人：{item.createdByName || item.createdByEmail || "项目成员"}</small>
        {item.summary && <p>{item.summary}</p>}
        {item.reviewNote && <div className="knowledge-history-note"><strong>审核意见</strong><p>{item.reviewNote}</p></div>}
        <details><summary>查看本版正文</summary><div className="knowledge-history-content"><OaRichAnswer answer={item.content || "本版本没有可显示的正文。"} /></div></details>
      </article>)}</div>
      <ol className="knowledge-event-history">{events.map((item: KnowledgeEvent) => <li key={item.id}>
        <div><strong>{eventLabels[item.action] || item.action}</strong><time>{formatDate(item.createdAt)}</time></div>
        <small>{item.actorName || item.actorEmail || "项目成员"}</small>
        {item.note && <p>{item.note}</p>}
      </li>)}</ol>
    </div>
  </details>;
}

function KnowledgeAssetPreview({ assets }: { assets: KnowledgeAsset[] }) {
  if (!assets.length) return null;
  return <section><h3>图片附件</h3><div className="knowledge-asset-grid">{assets.map((asset) => <figure className="knowledge-asset-preview" key={asset.path}>
    <img src={asset.url} alt={asset.path} loading="lazy" />
    <figcaption><span>{asset.path}</span><small>{asset.mimeType} · {(asset.byteSize / 1024).toFixed(1)} KB</small></figcaption>
  </figure>)}</div></section>;
}

function KnowledgeReviewDialog({ detail, open, loading, error, note, setNote, visibility, setVisibility, publicConfirmation, setPublicConfirmation, actioning, onOpenChange, onRetry, onAction, onAdminEdit }: { detail: ReviewDetail | null; open: boolean; loading: boolean; error: string; note: string; setNote: (value: string) => void; visibility: KnowledgeVisibility | ""; setVisibility: (value: KnowledgeVisibility) => void; publicConfirmation: string; setPublicConfirmation: (value: string) => void; actioning: KnowledgeAction | null; onOpenChange: (open: boolean) => void; onRetry: () => void; onAction: (action: Extract<KnowledgeAction, "approve" | "return" | "reject" | "set_visibility">, visibility?: KnowledgeVisibility, publicConfirmation?: string) => void; onAdminEdit: (item: KnowledgeItem) => void }) {
  const revision = detail ? currentRevision(detail) : undefined;
  const reviewContent = revision?.content || detail?.item.content || "";
  const sourceUrl = safeHttpUrl(revision?.sourceUrl || detail?.item.sourceUrl);
  const actionable = Boolean(detail && detail.item.status === "pending" && detail.item.canReview !== false && reviewContent.trim() && !loading && !error);
  const canAct = actionable && !actioning;
  const canApprove = canAct && Boolean(visibility) && (visibility !== "public" || publicConfirmation === PUBLIC_KNOWLEDGE_CONFIRMATION);
  const savedVisibility = detail ? knowledgeVisibility(detail.item) : undefined;
  const visibilityEditable = Boolean(detail && detail.item.status === "active" && detail.item.canSetVisibility && reviewContent.trim() && !loading && !error);
  const canEditVisibility = visibilityEditable && !actioning;
  const publicConfirmationRequired = visibility === "public" && (actionable || savedVisibility !== "public");
  const canSaveVisibility = canEditVisibility && Boolean(visibility) && visibility !== savedVisibility && (!publicConfirmationRequired || publicConfirmation === PUBLIC_KNOWLEDGE_CONFIRMATION);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="knowledge-review-dialog">
    <DialogHeader><div className="knowledge-dialog-icon"><ShieldCheck className="size-5" /></div><DialogTitle>{detail?.item.title || "知识投稿审核"}</DialogTitle><DialogDescription>{detail ? `${detail.item.submitterName || detail.item.submitterEmail || "项目成员"} · ${detail.item.category} · 第 ${detail.item.currentRevisionNo || revision?.revisionNo || 1} 版` : "核对投稿内容，并在批准时选择仅对内或对外公开。"}</DialogDescription></DialogHeader>
    {actionable && detail?.item.canReturn !== false ? <div className="flex flex-wrap items-center gap-3 border-b pb-3"><Button type="button" variant="outline" className="knowledge-return-button" disabled={!canAct} onClick={() => onAction("return")}><RotateCcw className="size-4" />一键退回</Button><p className="text-sm text-muted-foreground">未填写意见时，将使用“请补充或修改后重新提交”。</p></div> : null}
    {loading ? <LoadingPanel label="正在加载投稿正文…" /> : error ? <ErrorPanel message={error} onRetry={onRetry} /> : detail ? <div className="knowledge-review-detail">
      {detail.item.canAdminEdit && <Button type="button" variant="outline" disabled={Boolean(actioning)} onClick={() => onAdminEdit(detail.item)}><Pencil className="size-4" />修改题目和内容</Button>}
      {(revision?.summary || detail.item.summary) && <section><h3>摘要</h3><p>{revision?.summary || detail.item.summary}</p></section>}
      {detail.item.contentPartCount && detail.item.contentPartCount > 1 && <section><h3>导入方式</h3><p><KnowledgeMultipartReviewMeta item={detail.item} /></p></section>}
      <section><h3>知识正文</h3><div className="knowledge-review-content"><OaRichAnswer answer={reviewContent || "当前版本没有可显示的正文。"} assets={detail.assets} /></div>{!reviewContent && <p className="knowledge-review-blocked"><AlertTriangle className="size-4" />正文未完整加载，不能执行审核。请重新加载。</p>}</section>
      <KnowledgeAssetPreview assets={detail.assets || []} />
      {(revision?.sourceLabel || detail.item.sourceLabel || sourceUrl) && <section><h3>来源</h3><p>{revision?.sourceLabel || detail.item.sourceLabel || "投稿人提供的参考链接"}</p>{sourceUrl && <a className="knowledge-source-link" href={sourceUrl} target="_blank" rel="noreferrer">打开来源链接</a>}</section>}
      {!actionable && savedVisibility && <section><h3>当前同步状态</h3><p><KnowledgeDestinationBadge item={detail.item} /> <KnowledgeVisibilityBadge item={detail.item} />{savedVisibility === "public" ? " 已同步到 ARTS Robotics 公共知识库，供 chat.omindos.cn 检索。" : " 已同步到 OriginMind 内部知识库，仅 OA 成员可检索。"}</p></section>}
      <KnowledgeHistory detail={detail} />
      {actionable && <label className="form-field"><span className="field-label">审核意见 <small>退回意见可选；未填写时使用“请补充或修改后重新提交”。拒绝时至少填写 2 个字符。</small></span><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明核对结论，或写清需要修改的具体内容" rows={4} minLength={2} maxLength={1000} disabled={Boolean(actioning)} /></label>}
      {(actionable || visibilityEditable) && <KnowledgeAnonymizationNotice />}
      {(actionable || visibilityEditable) && <fieldset className="knowledge-visibility-choice" disabled={Boolean(actioning)}><legend>{actionable ? "审核后同步到" : "同步到联合知识库"} <b className="required-mark">*</b></legend><p>{actionable ? "批准前必须选择目标知识库；投稿不会绕过审核直接入库。" : "选择新的目标范围后提交；每次同步调整都会保留审计记录。"}</p><div className="knowledge-visibility-options">
        <label className={visibility === "internal" ? "selected" : ""}><input type="radio" name="knowledge-visibility" value="internal" checked={visibility === "internal"} onChange={() => { setVisibility("internal"); setPublicConfirmation(""); }} /><ShieldCheck className="size-4" /><span><strong>OriginMind · 内部</strong><small>仅登录 OA 且完成准入与保密签署的成员可检索。</small></span></label>
        <label className={visibility === "public" ? "selected public" : ""}><input type="radio" name="knowledge-visibility" value="public" checked={visibility === "public"} onChange={() => setVisibility("public")} /><Globe2 className="size-4" /><span><strong>ARTS Robotics · 公开</strong><small>同步到联合公共知识库，供 chat.omindos.cn 检索；访客无需登录 OA。</small></span></label>
      </div>{publicConfirmationRequired && <label className="knowledge-public-confirmation"><span>二次确认：输入 <code>{PUBLIC_KNOWLEDGE_CONFIRMATION}</code></span><Input value={publicConfirmation} onChange={(event) => setPublicConfirmation(event.target.value)} placeholder={PUBLIC_KNOWLEDGE_CONFIRMATION} autoComplete="off" spellCheck={false} disabled={Boolean(actioning)} /><small>必须逐字一致。设为公开后，该知识仍可在 OA 内检索，并将同时供 chat.omindos.cn 对外检索。</small></label>}</fieldset>}
    </div> : null}
    {actionable && <DialogFooter className="knowledge-review-actions">{detail?.item.canReject !== false && <Button type="button" variant="outline" className="knowledge-reject-button" disabled={!canAct || note.trim().length < 2} onClick={() => onAction("reject")}>{actioning === "reject" ? <LoaderCircle className="size-4" /> : <X className="size-4" />}拒绝</Button>}{detail?.item.canReturn !== false && <Button type="button" variant="outline" className="knowledge-return-button" disabled={!canAct} onClick={() => onAction("return")}>{actioning === "return" ? <LoaderCircle className="size-4" /> : <RotateCcw className="size-4" />}一键退回</Button>}<Button type="button" className="primary-button" disabled={!canApprove} onClick={() => onAction("approve", visibility || undefined, visibility === "public" ? publicConfirmation : undefined)}>{actioning === "approve" ? <LoaderCircle className="size-4" /> : visibility === "public" ? <Globe2 className="size-4" /> : <Check className="size-4" />}{visibility === "public" ? "确认公开并入库" : visibility === "internal" ? "通过并仅在 OA 内入库" : "先选择可见范围"}</Button></DialogFooter>}
    {visibilityEditable && <DialogFooter className="knowledge-review-actions"><Button type="button" variant="outline" disabled={Boolean(actioning)} onClick={() => onOpenChange(false)}>取消</Button><Button type="button" className="primary-button" disabled={!canSaveVisibility} onClick={() => onAction("set_visibility", visibility || undefined, publicConfirmationRequired ? publicConfirmation : undefined)}>{actioning === "set_visibility" ? <LoaderCircle className="size-4" /> : visibility === "public" ? <Globe2 className="size-4" /> : <ShieldCheck className="size-4" />}{!visibility || visibility === savedVisibility ? "请选择新的目标" : visibility === "public" ? "确认同步到 ARTS Robotics" : "确认同步到 OriginMind"}</Button></DialogFooter>}
  </DialogContent></Dialog>;
}

function KnowledgeRevokeDialog({ item, note, setNote, submitting, onOpenChange, onConfirm }: { item: KnowledgeItem | null; note: string; setNote: (value: string) => void; submitting: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <Dialog open={Boolean(item)} onOpenChange={onOpenChange}><DialogContent className="knowledge-revoke-dialog"><DialogHeader><div className="knowledge-dialog-icon knowledge-dialog-icon-danger"><AlertTriangle className="size-5" /></div><DialogTitle>停止这条知识用于问答？</DialogTitle><DialogDescription>“{item?.title || "该知识"}”将立即退出可检索范围，已有记录和审核轨迹继续保留。</DialogDescription></DialogHeader><label className="form-field"><span className="field-label">撤销原因 <b className="required-mark">*</b></span><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="至少 2 个字符；说明信息错误、已经过期或不再适用的原因" rows={4} minLength={2} maxLength={1000} required disabled={submitting} /></label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button><Button type="button" className="knowledge-revoke-confirm" onClick={onConfirm} disabled={submitting || note.trim().length < 2}>{submitting ? <LoaderCircle className="size-4" /> : <X className="size-4" />}确认停止用于问答</Button></DialogFooter></DialogContent></Dialog>;
}

export function KnowledgeView({ canReviewKnowledge, isAdmin = false, activeSection, onSectionChange }: { canReviewKnowledge: boolean; isAdmin?: boolean; activeSection?: KnowledgeTab; onSectionChange?: (tab: KnowledgeTab) => void }) {
  const [internalTab, setInternalTab] = useState<KnowledgeTab>("ask");
  const activeTab = activeSection ?? internalTab;
  const setActiveTab = (tab: KnowledgeTab) => { setInternalTab(tab); onSectionChange?.(tab); };
  const [returnedPackageItem, setReturnedPackageItem] = useState<KnowledgeItem | null>(null);
  const [adminEditItem, setAdminEditItem] = useState<KnowledgeItem | null>(null);
  const [draft, setDraft] = useState<KnowledgeDraft>(emptyDraft);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [editingLoadingId, setEditingLoadingId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mine, setMine] = useState<KnowledgeItem[]>([]);
  const [mineLoading, setMineLoading] = useState(true);
  const [mineError, setMineError] = useState("");
  const [reviewItems, setReviewItems] = useState<KnowledgeItem[]>([]);
  const [reviewPendingCount, setReviewPendingCount] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(canReviewKnowledge);
  const [reviewError, setReviewError] = useState("");
  const [manageItems, setManageItems] = useState<KnowledgeItem[]>([]);
  const [manageLoading, setManageLoading] = useState(canReviewKnowledge);
  const [manageError, setManageError] = useState("");
  const [manageQuery, setManageQuery] = useState("");
  const [debouncedManageQuery, setDebouncedManageQuery] = useState("");
  const [manageSort, setManageSort] = useState<KnowledgeListSort>("updated_desc");
  const manageRequest = useRef<AbortController | null>(null);
  const [reviewTarget, setReviewTarget] = useState<KnowledgeItem | null>(null);
  const [reviewDetail, setReviewDetail] = useState<ReviewDetail | null>(null);
  const [reviewDetailLoading, setReviewDetailLoading] = useState(false);
  const [reviewDetailError, setReviewDetailError] = useState("");
  const reviewDetailRequest = useRef<AbortController | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewVisibility, setReviewVisibility] = useState<KnowledgeVisibility | "">("");
  const [publicConfirmation, setPublicConfirmation] = useState("");
  const [reviewAction, setReviewAction] = useState<KnowledgeAction | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<KnowledgeItem | null>(null);
  const [revokeNote, setRevokeNote] = useState("");
  const [revoking, setRevoking] = useState(false);

  const loadMine = useCallback(async (signal?: AbortSignal) => {
    setMineLoading(true);
    setMineError("");
    try {
      const response = await fetch("/api/knowledge?scope=mine", { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal });
      const data = await responseJson<KnowledgeListResponse>(response, "我的投稿加载失败");
      setMine(data.items ?? []);
    } catch (error) {
      if (signal?.aborted) return;
      setMineError(error instanceof Error ? error.message : "请稍后重试");
    } finally {
      if (!signal?.aborted) setMineLoading(false);
    }
  }, []);

  const removeDeletedItems = (ids: string[]) => {
    const deleted = new Set(ids);
    setMine(current => current.filter(item => !deleted.has(item.id)));
    setManageItems(current => current.filter(item => !deleted.has(item.id)));
    setReviewItems(current => current.filter(item => !deleted.has(item.id)));
    if (editingItem && deleted.has(editingItem.id)) { setEditingItem(null); setDraft(emptyDraft()); }
    if (returnedPackageItem && deleted.has(returnedPackageItem.id)) setReturnedPackageItem(null);
    if (adminEditItem && deleted.has(adminEditItem.id)) setAdminEditItem(null);
    if (reviewTarget && deleted.has(reviewTarget.id)) { reviewDetailRequest.current?.abort(); setReviewTarget(null); setReviewDetail(null); }
    if (ids.length) window.dispatchEvent(new Event("oa-library-updated"));
  };

  const loadReview = useCallback(async (signal?: AbortSignal) => {
    if (!canReviewKnowledge) return;
    setReviewLoading(true);
    setReviewError("");
    try {
      const response = await fetch("/api/knowledge?scope=review", { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal });
      const data = await responseJson<KnowledgeListResponse>(response, "待审核知识加载失败");
      setReviewItems(data.items ?? []);
      setReviewPendingCount(data.pendingCount ?? data.items?.length ?? 0);
    } catch (error) {
      if (signal?.aborted) return;
      setReviewError(error instanceof Error ? error.message : "请稍后重试");
    } finally {
      if (!signal?.aborted) setReviewLoading(false);
    }
  }, [canReviewKnowledge]);

  const loadManage = useCallback(async (query: string, sort: KnowledgeListSort) => {
    if (!canReviewKnowledge) return;
    manageRequest.current?.abort();
    const controller = new AbortController();
    manageRequest.current = controller;
    setManageLoading(true);
    setManageError("");
    try {
      const params = new URLSearchParams({
        scope: "all",
        q: normalizeKnowledgeListQuery(query),
        sort,
      });
      const response = await fetch(`/api/knowledge?${params.toString()}`, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const data = await responseJson<KnowledgeListResponse>(response, "知识库记录加载失败");
      setManageItems(data.items ?? []);
    } catch (error) {
      if (controller.signal.aborted) return;
      setManageError(error instanceof Error ? error.message : "请稍后重试");
    } finally {
      if (manageRequest.current === controller) {
        manageRequest.current = null;
        setManageLoading(false);
      }
    }
  }, [canReviewKnowledge]);

  useEffect(() => {
    const controller = new AbortController();
    const timerId = window.setTimeout(() => {
      void loadMine(controller.signal);
      void loadReview(controller.signal);
    }, 0);
    return () => { window.clearTimeout(timerId); controller.abort(); };
  }, [loadMine, loadReview]);

  useEffect(() => {
    const normalizedQuery = normalizeKnowledgeListQuery(manageQuery);
    const timerId = window.setTimeout(() => setDebouncedManageQuery(normalizedQuery), 300);
    return () => window.clearTimeout(timerId);
  }, [manageQuery]);

  useEffect(() => {
    if (!canReviewKnowledge) return;
    const timerId = window.setTimeout(() => void loadManage(debouncedManageQuery, manageSort), 0);
    return () => {
      window.clearTimeout(timerId);
      const request = manageRequest.current;
      request?.abort();
      if (manageRequest.current === request) manageRequest.current = null;
    };
  }, [canReviewKnowledge, debouncedManageQuery, loadManage, manageSort]);

  useEffect(() => {
    const refreshVisibleKnowledge = () => {
      if (document.visibilityState !== "visible") return;
      void loadMine();
      void loadReview();
      void loadManage(debouncedManageQuery, manageSort);
    };
    window.addEventListener("focus", refreshVisibleKnowledge);
    document.addEventListener("visibilitychange", refreshVisibleKnowledge);
    return () => {
      window.removeEventListener("focus", refreshVisibleKnowledge);
      document.removeEventListener("visibilitychange", refreshVisibleKnowledge);
    };
  }, [debouncedManageQuery, loadManage, loadMine, loadReview, manageSort]);

  const submitKnowledge = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      title: draft.title.trim(),
      category: draft.category.trim(),
      summary: draft.summary.trim() || undefined,
      content: draft.content.trim(),
      sourceLabel: draft.sourceLabel.trim() || undefined,
      sourceUrl: draft.sourceUrl.trim() || undefined,
    };
    if (!payload.title || !payload.category || !payload.content) {
      toast.info("请填写标题、分类和知识正文");
      return;
    }
    if (payload.sourceUrl && !safeHttpUrl(payload.sourceUrl)) {
      toast.info("来源链接格式不正确", { description: "请填写完整、可访问的来源链接。" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(editingItem ? `/api/knowledge/${encodeURIComponent(editingItem.id)}` : "/api/knowledge", {
        method: editingItem ? "PATCH" : "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(editingItem ? { action: "resubmit", mutationRevision: editingItem.mutationRevision, ...payload } : payload),
      });
      await responseJson<{ item?: KnowledgeItem; error?: string }>(response, editingItem ? "知识未重新提交" : "知识未提交");
      toast.success(editingItem ? "知识已重新提交" : "知识已提交审核", { description: "审核人将核对内容，并在批准时选择对内或对外公开。" });
      setDraft(emptyDraft());
      setEditingItem(null);
      await loadMine();
      setActiveTab("mine");
    } catch (error) {
      toast.error(editingItem ? "知识未重新提交" : "知识未提交", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = async (item: KnowledgeItem) => {
    if (item.contentPartCount && item.contentPartCount > 1) { setReturnedPackageItem(item); setActiveTab("submit"); return; }
    setReturnedPackageItem(null);
    setEditingLoadingId(item.id);
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(item.id)}`, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      const data = await responseJson<KnowledgeDetailResponse>(response, "知识详情加载失败");
      if (!data.item) throw new Error("知识详情不完整");
      const detail: ReviewDetail = { item: data.item, revisions: data.revisions ?? [], events: data.events ?? [] };
      const revision = currentRevision(detail);
      setDraft({
        title: revision?.title || data.item.title || "",
        category: revision?.category || data.item.category || categories[0],
        summary: revision?.summary || data.item.summary || "",
        content: revision?.content || data.item.content || "",
        sourceLabel: revision?.sourceLabel || data.item.sourceLabel || "",
        sourceUrl: revision?.sourceUrl || data.item.sourceUrl || "",
      });
      setEditingItem(data.item);
      setActiveTab("submit");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error("暂时无法修改", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setEditingLoadingId("");
    }
  };

  const cancelEditing = () => {
    setEditingItem(null);
    setDraft(emptyDraft());
  };

  const loadReviewDetail = useCallback(async (item: KnowledgeItem) => {
    reviewDetailRequest.current?.abort();
    const controller = new AbortController();
    reviewDetailRequest.current = controller;
    setReviewDetailLoading(true);
    setReviewDetailError("");
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(item.id)}`, { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const data = await responseJson<KnowledgeDetailResponse>(response, "知识详情加载失败");
      if (!data.item || data.item.id !== item.id) throw new Error("知识详情不完整");
      if (controller.signal.aborted) return;
      setReviewDetail({ item: data.item, revisions: data.revisions ?? [], events: data.events ?? [], assets: data.assets ?? [] });
    } catch (error) {
      if (controller.signal.aborted) return;
      setReviewDetailError(error instanceof Error ? error.message : "请稍后重试");
    } finally {
      if (reviewDetailRequest.current === controller) {
        reviewDetailRequest.current = null;
        setReviewDetailLoading(false);
      }
    }
  }, []);

  const openReview = (item: KnowledgeItem) => {
    setReviewTarget(item);
    setReviewDetail({ item, revisions: [], events: [] });
    setReviewNote("");
    setReviewVisibility("");
    setPublicConfirmation("");
    void loadReviewDetail(item);
  };

  const closeReview = () => {
    if (reviewAction) return;
    reviewDetailRequest.current?.abort();
    reviewDetailRequest.current = null;
    setReviewTarget(null);
    setReviewDetail(null);
    setReviewDetailLoading(false);
    setReviewDetailError("");
    setReviewNote("");
    setReviewVisibility("");
    setPublicConfirmation("");
  };

  const performReview = async (action: Extract<KnowledgeAction, "approve" | "return" | "reject" | "set_visibility">, visibility?: KnowledgeVisibility, confirmation?: string) => {
    if (!reviewTarget || reviewAction) return;
    if (!reviewDetail || reviewDetail.item.id !== reviewTarget.id) {
      toast.info("请等待当前投稿正文加载完成");
      return;
    }
    const note = reviewNote.trim() || (action === "return" ? "请补充或修改后重新提交" : "");
    if ((action === "return" || action === "reject") && note.length < 2) {
      toast.info("审核意见至少需要 2 个字符", { description: action === "return" ? "请明确说明需要修改的内容。" : "请说明拒绝入库的原因。" });
      return;
    }
    if ((action === "approve" || action === "set_visibility") && !visibility) {
      toast.info("请先选择可见范围", { description: "选择“对内”或“对外公开”后才能批准。" });
      return;
    }
    if ((action === "approve" || action === "set_visibility") && visibility === "public" && knowledgeVisibility(reviewDetail.item) !== "public" && confirmation !== PUBLIC_KNOWLEDGE_CONFIRMATION) {
      toast.info("公开确认文字不一致", { description: `请逐字输入 ${PUBLIC_KNOWLEDGE_CONFIRMATION}` });
      return;
    }
    if (action === "set_visibility" && (reviewDetail.item.status !== "active" || visibility === knowledgeVisibility(reviewDetail.item))) {
      toast.info("请选择新的可见范围");
      return;
    }
    setReviewAction(action);
    try {
      const approvalScope = (action === "approve" || action === "set_visibility") && visibility
        ? { visibility, ...(visibility === "public" && knowledgeVisibility(reviewDetail.item) !== "public" ? { publicConfirmation: confirmation } : {}) }
        : {};
      const response = await fetch(`/api/knowledge/${encodeURIComponent(reviewTarget.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, mutationRevision: reviewDetail.item.mutationRevision, note: note || undefined, ...approvalScope }),
      });
      await responseJson<{ item?: KnowledgeItem; error?: string }>(response, "审核动作未保存");
      toast.success(action === "set_visibility" ? visibility === "public" ? "知识已调整为对外公开" : "知识已调整为仅 OA 内部" : action === "approve" ? visibility === "public" ? "知识已对外公开" : "知识已在 OA 内部入库" : action === "return" ? "知识已退回修改" : "知识已拒绝", { description: action === "set_visibility" || action === "approve" ? visibility === "public" ? "该版本可供 chat.omindos.cn 的 ARTS Robotics AI assistant 检索。" : "该版本仅供已完成准入的 OA 成员检索。" : "投稿人可以在“我的提交”中查看审核意见。" });
      reviewDetailRequest.current?.abort();
      reviewDetailRequest.current = null;
      setReviewTarget(null);
      setReviewDetail(null);
      setReviewNote("");
      setReviewVisibility("");
      setPublicConfirmation("");
      await Promise.all([loadReview(), loadManage(debouncedManageQuery, manageSort), loadMine()]);
    } catch (error) {
      toast.error("审核动作未保存", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setReviewAction(null);
    }
  };

  const performRevoke = async () => {
    if (!revokeTarget || revokeNote.trim().length < 2) return;
    setRevoking(true);
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(revokeTarget.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "revoke", mutationRevision: revokeTarget.mutationRevision, note: revokeNote.trim() }),
      });
      await responseJson<{ item?: KnowledgeItem; error?: string }>(response, "知识未停止使用");
      toast.success("知识已停止用于问答", { description: "原文、版本和审核记录均已保留。" });
      setRevokeTarget(null);
      setRevokeNote("");
      await Promise.all([loadManage(debouncedManageQuery, manageSort), loadMine()]);
    } catch (error) {
      toast.error("知识未停止使用", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setRevoking(false);
    }
  };

  const tabCount = useMemo(() => reviewPendingCount > 99 ? "99+" : String(reviewPendingCount), [reviewPendingCount]);
  const visibleTab = !canReviewKnowledge && (activeTab === "review" || activeTab === "manage") ? "ask" : activeTab;
  const manageQueryPending = normalizeKnowledgeListQuery(manageQuery) !== debouncedManageQuery;
  const clearManageQuery = () => {
    setManageQuery("");
    setDebouncedManageQuery("");
  };

  return <div className="knowledge-view" data-section={visibleTab}>
    <section className="page-heading knowledge-heading"><div><div className="eyebrow"><span className="eyebrow-line" />OA 内部知识与问答</div><h1>实验室 AI（内部）</h1><p>登录并完成 OA 准入与保密签署后，可在这里提问、投稿和查看审核状态。项目负责人或 OA 管理员批准时必须选择“对内”或“对外公开”。</p></div><div className="knowledge-live-note"><span /><div><strong>仅限 OA 成员</strong><small>登录并完成准入后使用</small></div></div></section>
    <section className="knowledge-scope-summary" aria-label="实验室知识可见范围说明"><div><ShieldCheck className="size-5" /><p><strong>对内：在 OA 里面问</strong><span>仅已登录并完成准入与保密签署的成员可检索。</span></p></div><div><Globe2 className="size-5" /><p><strong>对外：供 ARTS Robotics AI assistant 使用</strong><span>设为公开须二次确认，随后供 <a href="https://chat.omindos.cn" target="_blank" rel="noreferrer">chat.omindos.cn</a> 检索。</span></p></div></section>
    {canReviewKnowledge && (visibleTab === "manage" || visibleTab === "review") && <nav className="knowledge-review-navigation" aria-label="审核与管理功能"><Button type="button" variant={visibleTab === "manage" ? "default" : "outline"} aria-pressed={visibleTab === "manage"} onClick={() => setActiveTab("manage")}>资料管理</Button><Button type="button" variant={visibleTab === "review" ? "default" : "outline"} aria-pressed={visibleTab === "review"} onClick={() => setActiveTab("review")}>批量审核{reviewPendingCount > 0 && <span className="knowledge-tab-count">{tabCount}</span>}</Button></nav>}
    <Tabs className="knowledge-tabs" value={visibleTab} onValueChange={(value) => setActiveTab(value as KnowledgeTab)}>
      <TabsList aria-label="实验室 AI 功能"><TabsTrigger value="ask"><Bot className="size-4" />知识问答</TabsTrigger><TabsTrigger value="submit"><Send className="size-4" />提交知识</TabsTrigger><TabsTrigger value="mine"><FileText className="size-4" />我的提交</TabsTrigger>{canReviewKnowledge && <TabsTrigger value="review"><ShieldCheck className="size-4" />待审核{reviewPendingCount > 0 && <span className="knowledge-tab-count">{tabCount}</span>}</TabsTrigger>}{canReviewKnowledge && <TabsTrigger value="manage"><LibraryBig className="size-4" />知识库管理</TabsTrigger>}</TabsList>
      <div className="oa-chat-tab" hidden={visibleTab !== "ask"}><KnowledgeAskPanel isAdmin={isAdmin} /></div>
      <div hidden={visibleTab !== "submit"}><KnowledgePackageImport key={adminEditItem?.id || returnedPackageItem?.id || "new-package"} returnedItem={returnedPackageItem} adminItem={adminEditItem} onCancelReturn={() => { setReturnedPackageItem(null); setAdminEditItem(null); setActiveTab("manage"); }} onSubmitted={() => { if (adminEditItem) { toast.success("修改已保存"); setActiveTab("manage"); window.dispatchEvent(new Event("oa-library-updated")); } setAdminEditItem(null); void loadMine(); void loadReview(); void loadManage(debouncedManageQuery, manageSort); }} />{!returnedPackageItem && !adminEditItem && editingItem && <KnowledgeSubmitPanel draft={draft} setDraft={setDraft} editingItem={editingItem} submitting={submitting} onSubmit={submitKnowledge} onCancelEdit={cancelEditing} />}</div>
      <TabsContent value="mine"><KnowledgeMinePanel items={mine} loading={mineLoading || Boolean(editingLoadingId)} error={mineError} onRetry={() => void loadMine()} onEdit={item => void startEditing(item)} onDeleted={removeDeletedItems} onFinished={() => { void loadMine(); void loadReview(); void loadManage(debouncedManageQuery, manageSort); }} editingId={editingLoadingId} /></TabsContent>
      {canReviewKnowledge && <TabsContent value="review"><KnowledgeReviewPanel items={reviewItems} pendingCount={reviewPendingCount} loading={reviewLoading} error={reviewError} onRetry={() => { void loadReview(); void loadManage(debouncedManageQuery, manageSort); }} onOpen={openReview} /></TabsContent>}
      {canReviewKnowledge && <TabsContent value="manage"><KnowledgeManagePanel items={manageItems} loading={manageLoading || manageQueryPending} error={manageError} query={manageQuery} appliedQuery={debouncedManageQuery} sort={manageSort} onQueryChange={setManageQuery} onSortChange={setManageSort} onClearQuery={clearManageQuery} onRetry={() => void loadManage(debouncedManageQuery, manageSort)} onChanged={changed => { const apply = (items: KnowledgeItem[]) => items.map(item => { const update = changed.find(row => row.id === item.id); return update ? { ...item, ...update } : item; }); setManageItems(apply); setMine(apply); }} onFinished={() => { void loadManage(debouncedManageQuery, manageSort); void loadMine(); window.dispatchEvent(new Event("oa-library-updated")); }} onOpen={openReview} onRevoke={(item) => { setRevokeTarget(item); setRevokeNote(""); }} onAdminEdit={(item) => { setReturnedPackageItem(null); setAdminEditItem(item); setActiveTab("submit"); }} /></TabsContent>}
    </Tabs>
    <KnowledgeReviewDialog detail={reviewDetail} open={Boolean(reviewTarget)} loading={reviewDetailLoading} error={reviewDetailError} note={reviewNote} setNote={setReviewNote} visibility={reviewVisibility} setVisibility={setReviewVisibility} publicConfirmation={publicConfirmation} setPublicConfirmation={setPublicConfirmation} actioning={reviewAction} onOpenChange={(open) => { if (!open) closeReview(); }} onRetry={() => { if (reviewTarget) void loadReviewDetail(reviewTarget); }} onAdminEdit={item => { closeReview(); setReturnedPackageItem(null); setAdminEditItem(item); setActiveTab("submit"); }} onAction={(action, visibility, confirmation) => void performReview(action, visibility, confirmation)} />
    <KnowledgeRevokeDialog item={revokeTarget} note={revokeNote} setNote={setRevokeNote} submitting={revoking} onOpenChange={(open) => { if (!open && !revoking) { setRevokeTarget(null); setRevokeNote(""); } }} onConfirm={() => void performRevoke()} />
  </div>;
}
