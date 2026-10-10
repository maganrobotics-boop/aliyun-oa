'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, FolderOpen } from 'lucide-react';
import { CHAT_ATTACHMENT_ACCEPT, readChatAttachments, type ChatAttachmentBundle } from '@/lib/oa-chat-attachments.mjs';
import { OaSourceArchive, OaUploadRules } from './oa-file-controls';

/** Sidebar and in-chat entry points share parsing and the same explicit OA submission. */
export function OaGenericImport({ onSubmitted }: { onSubmitted: () => void }) {
  const [bundle, setBundle] = useState<ChatAttachmentBundle | null>(null), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; active.current?.abort(); }; }, []);
  async function select(files: File[], folder: boolean) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(''); setBundle(null);
    try {
      const next = await readChatAttachments(files, { folder, signal: controller.signal, onProgress: text => { if (live.current) setProgress(text); } });
      if (live.current) { setBundle(next); setProgress('已解析，可修改题目、正文和图片说明，确认后提交审核。'); }
    } catch (cause) { if (live.current) { setError(cause instanceof Error ? cause.message : '解析失败，请重试。'); setProgress(''); } }
    finally { active.current = null; if (live.current) setBusy(false); }
  }
  return <section className="oa-generic-source oa-upload-compact" aria-label="上传资料">
    <header className="oa-upload-toolbar">
      <div><h2>资料上传</h2><p>文档、图片、ZIP · 周报和周会可生成个人工作确认单</p></div>
      <div className="oa-upload-buttons">
        <button type="button" className="oa-upload-primary" disabled={busy || submitting} onClick={() => fileInput.current?.click()}><Upload size={18} />{busy ? '正在解析…' : submitting ? '正在提交…' : '上传资料'}</button>
        <button type="button" className="oa-upload-folder" disabled={busy || submitting} onClick={() => folderInput.current?.click()}><FolderOpen size={17} />文件夹</button>
      </div>
    </header>
    <input ref={fileInput} type="file" hidden multiple accept={CHAT_ATTACHMENT_ACCEPT} aria-label="选择资料文件或 ZIP" disabled={busy} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; if (files.length) void select(files, false); }} />
    <input ref={node => { folderInput.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" hidden multiple aria-label="选择资料文件夹" disabled={busy} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; if (files.length) void select(files, true); }} />
    <details className="oa-upload-help"><summary>支持格式与大小</summary><OaUploadRules /></details>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert" className="oa-file-warning">{error}</p>}
    {bundle && <div className="oa-generic-preview" key={bundle.id}>
      <p className="oa-upload-summary">{bundle.parts.length} 篇正文 · {bundle.pkg.images.length} 张图片。修改后将提交当前编辑的内容。</p>
      {bundle.warnings.map((warning, index) => <p className="oa-file-warning" key={index}>{warning}</p>)}
      <OaSourceArchive bundle={bundle} editorVisible onSubmitted={onSubmitted} onBusyChange={setSubmitting} />
    </div>}
  </section>;
}
