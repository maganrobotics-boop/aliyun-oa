'use client';

import { useEffect, useState } from 'react';
import { knowledgeImageReferences, updateKnowledgeImageDescription } from '@/lib/knowledge-image-references.mjs';
import './oa-file-controls.css';

type DraftImage = { path: string; alt?: string; file?: File; url?: string };
export type KnowledgeTextDraft = { title: string; body: string };

function ImagePreview({ image, alt }: { image: DraftImage; alt: string }) {
  const [localUrl, setLocalUrl] = useState('');
  useEffect(() => {
    if (!image.file) return;
    const url = URL.createObjectURL(image.file);
    const timer = setTimeout(() => setLocalUrl(url), 0);
    return () => { clearTimeout(timer); URL.revokeObjectURL(url); };
  }, [image.file]);
  const url = image.url || localUrl;
  return url ? <img src={url} alt={alt} loading="lazy" /> : null;
}

export function OaKnowledgeDraftFields({ draft, images, disabled = false, onChange }: {
  draft: KnowledgeTextDraft; images: DraftImage[]; disabled?: boolean;
  onChange: (draft: KnowledgeTextDraft) => void;
}) {
  const references = knowledgeImageReferences(draft.body);
  const [visible, setVisible] = useState(6);
  const referenced = images.filter(image => references.has(image.path));
  return <div className="oa-knowledge-draft-fields">
    <label><span>题目</span><input aria-label="资料题目" value={draft.title} minLength={2} maxLength={100} disabled={disabled} onChange={event => onChange({ ...draft, title: event.target.value })} /></label>
    <label><span>正文</span><textarea aria-label="资料正文" value={draft.body} rows={12} disabled={disabled} onChange={event => onChange({ ...draft, body: event.target.value })} /></label>
    <p className="oa-upload-summary">可直接修改正文及图片下方的说明；图片路径用于保留原图，请核对引用。</p>
    {referenced.length > 0 && <details className="oa-draft-image-descriptions" open>
      <summary>图片说明（{referenced.length} 张）</summary>
      <div>{referenced.slice(0, visible).map(image => {
        const alt = references.get(image.path) || '';
        return <figure key={image.path}><ImagePreview image={image} alt={alt} /><figcaption>{image.path}</figcaption>
          <label><span>图片说明</span><textarea aria-label={`图片说明：${image.path}`} rows={2} maxLength={1000} value={alt} disabled={disabled} onChange={event => onChange({ ...draft, body: updateKnowledgeImageDescription(draft.body, image.path, event.target.value) })} /></label>
        </figure>;
      })}</div>
      {visible < referenced.length && <button type="button" onClick={() => setVisible(value => value + 6)}>继续显示图片说明</button>}
    </details>}
  </div>;
}
