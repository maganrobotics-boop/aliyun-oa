"use client";
import { Plus } from 'lucide-react';
import { useOaConversation } from './knowledge/oa-conversation-context';
export function OaResearchTools({ onLibrary }: { onLibrary: () => void }) {
 const chat = useOaConversation();
 return <div className="oa-research-tools"><button type="button" className="oa-internal-library" onClick={onLibrary}>内部资料</button><button type="button" className="oa-research-new" aria-label="新建聊天" onClick={chat.newAi}><Plus size={23} /></button></div>;
}
