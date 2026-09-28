'use client';

import { useEffect, useRef } from 'react';
import { renderAnswerBody, userFacingAnswer } from '@/lib/oa-chat-renderer.mjs';
import './shared-chat.generated.css';

export function OaRichAnswer({ answer }: { answer: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    element.replaceChildren(renderAnswerBody(userFacingAnswer(answer)));
    return () => element.replaceChildren();
  }, [answer]);
  return <div ref={host} className="oa-rich-answer" />;
}
