'use client';

import { useEffect, useRef } from 'react';
import { renderAnswerBody, userFacingAnswer } from '@/lib/oa-chat-renderer.mjs';
import './shared-chat.generated.css';
import './oa-rich-content.css';

export function OaRichAnswer({ answer, assets }: { answer: string; assets?: readonly { path: string; url: string }[] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    element.replaceChildren(renderAnswerBody(userFacingAnswer(answer), assets));
    return () => element.replaceChildren();
  }, [answer, assets]);
  return <div ref={host} className="oa-rich-answer" />;
}
