"use client";

import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { knowledgeStateFilterOptions, matchesKnowledgeListFilters, type KnowledgeStateFilter } from "@/lib/knowledge-list-filters";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KNOWLEDGE_DELETE_BATCH_SIZE, type KnowledgeBatchDeleteResult } from "@/lib/knowledge-delete-policy";
import type { KnowledgeItem } from "@/lib/knowledge-types";

export function KnowledgeBatchDelete({ items, disabled, onDeleted, onFinished, onEdit, ItemCard, children }: {
  items: KnowledgeItem[];
  disabled: boolean;
  onDeleted: (ids: string[]) => void;
  onFinished: () => void;
  onEdit: (item: KnowledgeItem) => void;
  ItemCard: ComponentType<{ item: KnowledgeItem; onEdit?: (item: KnowledgeItem) => void; onDelete?: (item: KnowledgeItem) => void; deleting?: boolean }>;
  children?: ReactNode;
}) {
  const [stateFilter, setStateFilter] = useState<KnowledgeStateFilter>("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<KnowledgeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const running = useRef(false);
  const stopped = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopped.current = true; };
  }, []);
  const visibleItems = items.filter(item => matchesKnowledgeListFilters(item, stateFilter, "all"));
  const eligible = visibleItems.filter(item => item.canDelete === true && Boolean(item.mutationRevision));
  const selected = eligible.filter(item => checked.includes(item.id));
  const all = eligible.length > 0 && selected.length === eligible.length;
  const changeState = (value: KnowledgeStateFilter) => {
    if (running.current || disabled) return;
    setStateFilter(value);
    setChecked([]);
    setConfirmation([]);
  };
  const toggle = (id: string) => {
    if (running.current || disabled) return;
    setChecked(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  };
  const prepare = (selectedItems: KnowledgeItem[]) => {
    if (running.current || disabled || !selectedItems.length) return;
    setConfirmation(selectedItems.map(item => ({ ...item })));
  };
  const run = async () => {
    if (running.current || !confirmation.length) return;
    const snapshot = confirmation;
    const deleted: string[] = [];
    const failed: string[] = [];
    let processed = 0;
    running.current = true; stopped.current = false;
    setBusy(true); setConfirmation([]); setFailures([]);
    try {
      for (let offset = 0; offset < snapshot.length; offset += KNOWLEDGE_DELETE_BATCH_SIZE) {
        if (stopped.current) break;
        const batch = snapshot.slice(offset, offset + KNOWLEDGE_DELETE_BATCH_SIZE);
        if (mounted.current) setProgress(`正在删除 ${processed + 1}–${processed + batch.length} / ${snapshot.length} 条资料…`);
        try {
          const response = await fetch("/api/knowledge/batch-delete", {
            method: "POST", credentials: "same-origin",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ items: batch.map(item => ({ id: item.id, mutationRevision: item.mutationRevision })) }),
          });
          const result = await response.json().catch(() => ({})) as Partial<KnowledgeBatchDeleteResult> & { error?: string };
          if (!response.ok) {
            if ([401, 403, 429].includes(response.status)) stopped.current = true;
            throw new Error(result.error || "删除结果未能确认，请刷新核对");
          }
          const expectedIds = new Set(batch.map(item => item.id));
          const actualIds = [...(result.deletedIds ?? []), ...(result.failed ?? []).map(item => item.id)];
          if (!Array.isArray(result.deletedIds) || !Array.isArray(result.failed)
            || actualIds.length !== batch.length || new Set(actualIds).size !== batch.length
            || actualIds.some(id => !expectedIds.has(id))) {
            stopped.current = true;
            throw new Error("删除结果不完整，请刷新核对");
          }
          deleted.push(...result.deletedIds);
          for (const failure of result.failed) {
            const title = batch.find(item => item.id === failure.id)?.title || failure.id;
            failed.push(`${title}：${failure.error}`);
          }
          onDeleted(result.deletedIds);
          if (mounted.current) setChecked(current => current.filter(id => !result.deletedIds!.includes(id)));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "删除失败";
          failed.push(...batch.map(item => `${item.title}：${message}`));
          stopped.current = true;
        }
        processed += batch.length;
        if (processed < snapshot.length && !stopped.current) await new Promise(resolve => setTimeout(resolve, 3200));
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false); setFailures(failed);
        setProgress(`已删除 ${deleted.length} 条；失败 ${failed.length} 条；未处理 ${snapshot.length - processed} 条。`);
      }
      onFinished();
    }
  };

  return <>
    <div className="knowledge-own-delete-toolbar">
      <label className="knowledge-own-state-filter"><span>状态</span>
        <NativeSelect aria-label="本人资料状态" value={stateFilter} disabled={busy || disabled}
          onChange={event => changeState(event.target.value as KnowledgeStateFilter)}>
          {knowledgeStateFilterOptions.map(option => <NativeSelectOption value={option.value} key={option.value}>{option.label}</NativeSelectOption>)}
        </NativeSelect>
      </label>
      <label><input type="checkbox" aria-label="全选当前本人资料" checked={all} disabled={busy || disabled || !eligible.length}
        onChange={() => setChecked(all ? [] : eligible.map(item => item.id))} />全选筛选结果</label>
      <span>显示 {visibleItems.length} / {items.length} 条</span>
      <span>已选择 {selected.length} / {eligible.length} 条</span>
      <Button type="button" variant="outline" disabled={busy || disabled || !selected.length} onClick={() => prepare(selected)}>
        <Trash2 className="size-4" />批量删除
      </Button>
      {busy && <Button type="button" variant="outline" onClick={() => { stopped.current = true; }}>停止后续删除</Button>}
    </div>
    {progress && <div className="knowledge-delete-progress" role="status">{busy && <LoaderCircle className="size-4" />}{progress}</div>}
    {failures.length > 0 && <details className="knowledge-delete-failures"><summary>查看 {failures.length} 条失败原因</summary><ul>{failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul></details>}
    {children}
    {items.length > 0 && visibleItems.length === 0 && !disabled && <div className="knowledge-empty">
      <strong>当前状态下没有资料</strong><p>切换状态后可继续选择本人资料。</p>
      <Button type="button" variant="outline" onClick={() => changeState("all")}>查看全部状态</Button>
    </div>}
    <div className="knowledge-item-grid">{visibleItems.map(item => <div className="knowledge-own-item" data-selected={checked.includes(item.id)} key={item.id}>
      <label className="knowledge-own-item-select"><input type="checkbox" aria-label={`选择：${item.title}`}
        checked={selected.some(value => value.id === item.id)} disabled={busy || disabled || item.canDelete !== true || !item.mutationRevision}
        onChange={() => toggle(item.id)} />选择此资料</label>
      <ItemCard item={item} onEdit={busy || disabled ? undefined : onEdit}
        onDelete={item.canDelete === true && !disabled ? item => prepare([item]) : undefined} deleting={busy} />
    </div>)}</div>
    <Dialog open={confirmation.length > 0} onOpenChange={open => { if (!open && !busy) setConfirmation([]); }}>
      <DialogContent className="knowledge-delete-dialog">
        <DialogHeader><DialogTitle>确认删除 {confirmation.length} 条本人资料？</DialogTitle>
          <DialogDescription>删除后将从资料列表移除，已入库的资料会停止用于对内和对外问答。历史版本和审核记录保留。</DialogDescription>
        </DialogHeader>
        <ul className="knowledge-delete-confirm-list">{confirmation.map(item => <li key={item.id}>{item.title}</li>)}</ul>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmation([])}>取消</Button>
          <Button type="button" variant="destructive" onClick={() => void run()}>确认删除 {confirmation.length} 条</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
