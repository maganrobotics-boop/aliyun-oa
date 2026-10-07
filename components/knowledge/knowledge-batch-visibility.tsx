"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Globe2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PUBLIC_KNOWLEDGE_CONFIRMATION } from "@/lib/knowledge-policy";
import { canBatchSetKnowledgeVisibility, KNOWLEDGE_VISIBILITY_BATCH_SIZE,
  type KnowledgeVisibilityInput, type KnowledgeVisibilityUpdate, type KnowledgeBatchVisibilityResult } from "@/lib/knowledge-visibility-batch";
import type { KnowledgeItem, KnowledgeVisibility } from "@/lib/knowledge-types";

export type KnowledgeManageRowProps = {
  item: KnowledgeItem; selected: boolean; selectable: boolean; disabled: boolean; onToggle: () => void;
  onOpen: (item: KnowledgeItem) => void; onRevoke: (item: KnowledgeItem) => void; onAdminEdit: (item: KnowledgeItem) => void;
};

export function KnowledgeBatchVisibility({ items, disabled, target, onTargetChange, publicNotice, onBusyChange, onChanged, onFinished,
  onOpen, onRevoke, onAdminEdit, ItemRow, children }: {
  items: KnowledgeItem[]; disabled: boolean; target: KnowledgeVisibility; onTargetChange: (target: KnowledgeVisibility) => void; publicNotice: string;
  onBusyChange: (busy: boolean) => void; onChanged: (items: KnowledgeVisibilityUpdate[]) => void; onFinished: () => void;
  onOpen: (item: KnowledgeItem) => void; onRevoke: (item: KnowledgeItem) => void; onAdminEdit: (item: KnowledgeItem) => void;
  ItemRow: ComponentType<KnowledgeManageRowProps>; children?: ReactNode;
}) {
  const [checked, setChecked] = useState<KnowledgeVisibilityInput[]>([]);
  const [confirmation, setConfirmation] = useState<KnowledgeItem[]>([]);
  const [publicConfirmation, setPublicConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const running = useRef(false), stopped = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopped.current = true; };
  }, []);
  const eligible = items.filter(item => canBatchSetKnowledgeVisibility(item, target));
  const selected = eligible.filter(item => checked.some(entry => entry.id === item.id && entry.mutationRevision === item.mutationRevision));
  const all = eligible.length > 0 && selected.length === eligible.length;
  const locked = busy || disabled;
  const targetLabel = target === "public" ? "对外" : "对内";
  const toggle = (item: KnowledgeItem) => {
    if (running.current || disabled || !canBatchSetKnowledgeVisibility(item, target)) return;
    setChecked(current => current.some(entry => entry.id === item.id)
      ? current.filter(entry => entry.id !== item.id) : [...current, { id: item.id, mutationRevision: item.mutationRevision! }]);
  };
  const prepare = () => {
    if (running.current || disabled || !selected.length) return;
    setPublicConfirmation(""); setConfirmation(selected.map(item => ({ ...item })));
  };
  const run = async () => {
    if (running.current || disabled || !confirmation.length
      || (target === "public" && publicConfirmation !== PUBLIC_KNOWLEDGE_CONFIRMATION)) return;
    const snapshot = confirmation, scope = target, token = publicConfirmation;
    let processed = 0, changedCount = 0;
    const failed: string[] = [];
    running.current = true; stopped.current = false;
    setBusy(true); onBusyChange(true); setConfirmation([]); setPublicConfirmation(""); setFailures([]);
    try {
      for (let offset = 0; offset < snapshot.length; offset += KNOWLEDGE_VISIBILITY_BATCH_SIZE) {
        if (stopped.current) break;
        const batch = snapshot.slice(offset, offset + KNOWLEDGE_VISIBILITY_BATCH_SIZE);
        if (mounted.current) setProgress(`正在调整 ${processed + 1}–${processed + batch.length} / ${snapshot.length} 条资料…`);
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch("/api/knowledge/batch-visibility", {
            method: "POST", credentials: "same-origin", signal: controller.signal,
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ items: batch.map(item => ({ id: item.id, mutationRevision: item.mutationRevision })),
              visibility: scope, ...(scope === "public" ? { publicConfirmation: token } : {}) }),
          });
          const result = await response.json().catch(() => ({})) as Partial<KnowledgeBatchVisibilityResult> & { error?: string };
          if (!response.ok) throw new Error(result.error || "调整结果未能确认，请刷新核对");
          const expected = new Set(batch.map(item => item.id));
          if (!Array.isArray(result.changed) || !Array.isArray(result.failed)
            || result.changed.some(item => !item || typeof item.id !== "string" || item.visibility !== scope
              || typeof item.mutationRevision !== "string" || !item.mutationRevision.trim() || typeof item.updatedAt !== "string")
            || result.failed.some(item => !item || typeof item.id !== "string" || typeof item.error !== "string")
            || (result.stopped !== undefined && typeof result.stopped !== "boolean"))
            throw new Error("调整结果不完整，请刷新核对");
          const actual = [...result.changed, ...result.failed].map(item => item.id);
          if (actual.length !== batch.length || new Set(actual).size !== batch.length || actual.some(id => !expected.has(id)))
            throw new Error("调整结果不完整，请刷新核对");
          changedCount += result.changed.length;
          failed.push(...result.failed.map(item => `${batch.find(row => row.id === item.id)?.title || item.id}：${item.error}`));
          onChanged(result.changed);
          if (mounted.current) setChecked(current => current.filter(item => !result.changed!.some(row => row.id === item.id)));
          if (result.stopped) stopped.current = true;
        } catch (cause) {
          const message = cause instanceof Error && cause.name !== "AbortError" ? cause.message : "调整结果未能确认，请刷新核对";
          failed.push(...batch.map(item => `${item.title}：${message}`));
          stopped.current = true;
        } finally { window.clearTimeout(timer); }
        processed += batch.length;
        if (processed < snapshot.length && !stopped.current) await new Promise(resolve => setTimeout(resolve, 3200));
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false); onBusyChange(false); setFailures(failed);
        setProgress(`已改为${scope === "public" ? "对外" : "对内"} ${changedCount} 条；失败 ${failed.length} 条；未处理 ${snapshot.length - processed} 条。`);
      }
      onFinished();
    }
  };

  return <div className="knowledge-batch-visibility">
    <div className="knowledge-visibility-toolbar" aria-label="批量调整资料范围">
      <label><input type="checkbox" aria-label="全选可调整范围的筛选结果" checked={all} disabled={locked || !eligible.length}
        onChange={() => setChecked(all ? [] : eligible.map(item => ({ id: item.id, mutationRevision: item.mutationRevision! })))} />全选筛选结果</label>
      <span>已选择 {selected.length} / {eligible.length} 条可调整资料</span>
      <label><span>批量改为</span><NativeSelect aria-label="批量调整目标范围" value={target} disabled={locked}
        onChange={event => { onTargetChange(event.target.value as KnowledgeVisibility); setChecked([]); setConfirmation([]); setPublicConfirmation(""); }}>
        <NativeSelectOption value="internal">对内</NativeSelectOption><NativeSelectOption value="public">对外</NativeSelectOption>
      </NativeSelect></label>
      <Button type="button" disabled={locked || !selected.length} onClick={prepare}>
        {target === "public" ? <Globe2 className="size-4" /> : <ShieldCheck className="size-4" />}批量改为{targetLabel}
      </Button>
      {busy && <Button type="button" variant="outline" onClick={() => { stopped.current = true; }}>停止后续处理</Button>}
      <small>仅处理有权限的已入库资料，已是目标范围的资料无需重复调整。</small>
    </div>
    {progress && <div className="knowledge-visibility-progress" role="status">{busy && <LoaderCircle className="size-4" />}{progress}</div>}
    {failures.length > 0 && <details className="knowledge-visibility-failures"><summary>查看 {failures.length} 条失败原因</summary>
      <ul>{failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul></details>}
    {children}
    <div className="knowledge-manage-list">{items.map(item => <ItemRow key={item.id} item={item}
      selected={selected.some(row => row.id === item.id)} selectable={canBatchSetKnowledgeVisibility(item, target)}
      disabled={locked} onToggle={() => toggle(item)} onOpen={onOpen} onRevoke={onRevoke} onAdminEdit={onAdminEdit} />)}</div>
    <Dialog open={confirmation.length > 0} onOpenChange={open => { if (!open && !busy) { setConfirmation([]); setPublicConfirmation(""); } }}>
      <DialogContent className="knowledge-visibility-dialog">
        <DialogHeader><DialogTitle>确认将 {confirmation.length} 条资料改为{targetLabel}？</DialogTitle>
          <DialogDescription>{target === "public" ? "确认后，这些资料将供 chat.omindos.cn 对外检索与问答。" : "确认后，这些资料仅供 OA 内部检索与问答，并停止用于对外问答。"}每条调整都会保留审核记录。</DialogDescription>
        </DialogHeader>
        <ul className="knowledge-visibility-confirm-list">{confirmation.map(item => <li key={item.id}>
          <strong>{item.title}</strong><small>{item.visibility === "public" ? "对外" : "对内"} → {targetLabel}</small>
        </li>)}</ul>
        {target === "public" && <div className="knowledge-visibility-confirmation">
          <p>{publicNotice}</p>
          <label htmlFor="knowledge-batch-scope-confirmation">请逐字输入 <code>{PUBLIC_KNOWLEDGE_CONFIRMATION}</code> 确认公开</label>
          <Input id="knowledge-batch-scope-confirmation" aria-label="批量对外公开确认" value={publicConfirmation}
            onChange={event => setPublicConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => { setConfirmation([]); setPublicConfirmation(""); }}>取消</Button>
          <Button type="button" disabled={disabled || (target === "public" && publicConfirmation !== PUBLIC_KNOWLEDGE_CONFIRMATION)}
            onClick={() => void run()}>确认改为{targetLabel} {confirmation.length} 条</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
