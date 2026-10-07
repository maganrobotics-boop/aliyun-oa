"use client";

import { useEffect, useRef, useState } from "react";
import { OaGenericImport } from "./oa-generic-import";
import { KnowledgeAdminEditor } from "./knowledge-admin-editor";
import { OaKnowledgeDraftFields } from "./oa-knowledge-draft-fields";
import { Button } from "@/components/ui/button";
import { prepareKnowledgePackage, reviseKnowledgePackage, submitKnowledgePackage, unpackKnowledgeZip, type KnowledgePackage } from "@/lib/knowledge-package.mjs";

function PreviewImage({ file, alt }: { file: File; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    // The URL is local only; clean it on replacement and unmount.
    const timer = setTimeout(() => setUrl(objectUrl), 0);
    return () => { clearTimeout(timer); URL.revokeObjectURL(objectUrl); };
  }, [file]);
  return url ? <img src={url} alt={alt || file.name} loading="lazy" /> : null;
}

export function KnowledgePackageImport({ onSubmitted, returnedItem, adminItem, onCancelReturn }: {
  onSubmitted: () => void;
  returnedItem?: { id: string; title: string } | null;
  adminItem?: { id: string; title: string } | null;
  onCancelReturn?: () => void;
}) {
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [pkg, setPackage] = useState<KnowledgePackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [receivedId, setReceivedId] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [replaceAdminPackage, setReplaceAdminPackage] = useState(false);
  const prepared = useRef<KnowledgePackage | null>(null);

  async function select(files: File[], folder: boolean) {
    if (!files.length || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setPackage(null); setProgress("正在本地检查资料…");
    try {
      const selected = folder ? files : await unpackKnowledgeZip(files[0]);
      const next = await prepareKnowledgePackage(selected, folder);
      setPackage(next); prepared.current = null; setReceivedId(""); setAttempted(false); setConfirmed(false); setProgress("检查完成，可修改题目、正文和图片说明，确认后提交。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "资料无法解析。"); setProgress(""); }
    finally { lock.current = false; setBusy(false); }
  }

  async function submit() {
    if (!pkg || !confirmed || lock.current || receivedId) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (!prepared.current) prepared.current = await reviseKnowledgePackage(pkg, pkg);
      setAttempted(true);
      const result = await submitKnowledgePackage(prepared.current, { onProgress: setProgress, returnedKnowledgeItemId: returnedItem?.id, adminKnowledgeItemId: adminItem?.id } as Parameters<typeof submitKnowledgePackage>[1] & { adminKnowledgeItemId?: string });
      setReceivedId(result.item.id); onSubmitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传未完成，请保留当前页面重试。");
      setProgress("尚未完成完整提交。资料保留在当前页面，重试不会自动批准或公开。");
    } finally { lock.current = false; setBusy(false); }
  }

  if (!returnedItem && !adminItem) return <OaGenericImport onSubmitted={onSubmitted} />;
  if (adminItem && !replaceAdminPackage) return <KnowledgeAdminEditor item={adminItem} onSaved={onSubmitted} onCancel={onCancelReturn} onReplace={() => setReplaceAdminPackage(true)} />;
  return <section className="oa-package-import" aria-label="图文资料上传">
    <h2>{adminItem ? "更新已入库资料" : returnedItem ? "重新上传退回资料" : "上传图文包"}</h2>
    <p>{adminItem ? "上传新的 Markdown 与 assets/ 图片即可修改文字、增删图片并通过 Markdown 调整图片位置。完整保存前，OA 与 Chat 继续使用旧版本。" : "支持单篇或多章节 Markdown＋assets/ 图片；有 manifest.json 时按目录合并，否则按文件名顺序合并。先预览，再完整提交 OA 待审核。"}</p>
    {returnedItem && <p className="oa-package-warning">正在更新“{returnedItem.title}”，保留原条目与历史审核记录。<Button type="button" variant="outline" onClick={onCancelReturn} disabled={busy}>取消重提</Button></p>}
    {adminItem && <p className="oa-package-warning">正在修改正式知识“{adminItem.title}”。新版本完整上传后自动生效，旧版本和管理员操作记录永久保留。<Button type="button" variant="outline" onClick={onCancelReturn} disabled={busy}>取消修改</Button></p>}
    <div className="oa-package-actions">
      <Button type="button" variant="outline" onClick={() => zipInput.current?.click()} disabled={busy}>上传 ZIP</Button>
      <Button type="button" variant="outline" onClick={() => folderInput.current?.click()} disabled={busy}>上传文件夹</Button>
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden aria-label="选择 ZIP 资料" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void select(files, false); }} />
      <input ref={node => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden aria-label="选择资料文件夹" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void select(files, true); }} />
    </div>
    <small>支持根目录 MD / Markdown、可选 manifest.json 和 assets/ 下的 JPG、PNG、WebP 图片。每包最多 100 个文件；ZIP ≤ 100 MB、解压后合计 ≤ 200 MB、合并正文 ≤ 5 MB、单图 ≤ 8 MB。正文须为 UTF-8 编码；文件夹选择不可用时，请使用 ZIP。</small>
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert" className="oa-package-error">{error}</p>}
    {pkg && <div className="oa-package-preview">
      <OaKnowledgeDraftFields draft={{ title: pkg.title, body: pkg.body }} images={pkg.availableImages || pkg.images} disabled={busy || attempted || Boolean(receivedId)} onChange={draft => { setPackage(current => current ? { ...current, ...draft } : current); prepared.current = null; setConfirmed(false); }} />
      <p>1 条资料 · {pkg.documents?.length || 1} 篇正文 · {pkg.images.length} 张正文引用图片 · {pkg.body.length.toLocaleString("zh-CN")} 字符。正文与图片说明保留原文，公式源代码不作改写。</p>
      {pkg.unusedPaths.length > 0 && <p className="oa-package-warning">以下图片没有在正文中引用，本次不会入库：{pkg.unusedPaths.join("、")}。需要入库时，请先在正文中引用后重新选择资料。</p>}
      <div className="oa-package-images">{pkg.images.map(image => <figure key={`${pkg.id}:${image.path}`}><PreviewImage file={image.file} alt={image.alt} /><figcaption>{image.path}{image.alt ? ` — ${image.alt}` : ""}</figcaption></figure>)}</div>
      <label className="oa-package-confirm"><input type="checkbox" checked={confirmed} disabled={busy || Boolean(receivedId)} onChange={event => setConfirmed(event.target.checked)} /><span>已核对正文、图片和脱敏情况；理解资料须经 OA 审核后才按批准范围参与问答。</span></label>
      <Button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || !confirmed || pkg.title.trim().length < 2 || Boolean(receivedId)}>{receivedId ? adminItem ? "修改已生效" : "已完整提交待审核" : busy ? "处理中…" : error ? "重试完整提交" : adminItem ? "保存并启用新版本" : "提交 OA 待审核"}</Button>
      {receivedId && <p>资料编号：{receivedId}。可在左侧“我的资料”查看审核状态。</p>}
    </div>}
  </section>;
}
