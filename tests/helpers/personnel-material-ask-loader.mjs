// Isolate authentication, rate limiting and unused knowledge/model services.
// The ask route, Unicode validation, SQL and intake remain production code.
const mocks = {
  db: 'export const getDb = async()=>globalThis.__aiWorkbenchTest.env.DB; export const getD1Database = getDb;',
  auth: 'export const getAuthorizedUser = async()=>globalThis.__aiWorkbenchTest.actor;',
  rate: 'export const consumeWriteRateLimit = async()=>true;',
  knowledge: 'export async function getActiveKnowledgeChunks(){throw new Error("Material must not retrieve knowledge");}',
  model: 'export async function answerOaChatQuestion(){throw new Error("Material must not use a model");} export function questionRequestsKnowledgeImages(){throw new Error("Material must not query knowledge images");}',
};
export async function resolve(source, context, nextResolve) {
  if (context.parentURL?.endsWith('/app/api/lab-ai/ask/route.ts')) {
    const key = source.endsWith('/db') ? 'db' : source.endsWith('/_lib/auth') ? 'auth'
      : source.endsWith('/write-rate-limit') ? 'rate' : source.endsWith('/knowledge-store') ? 'knowledge'
      : source.endsWith('/oa-chat-client') ? 'model' : null;
    if (key) return { url: `data:text/javascript,${encodeURIComponent(mocks[key])}`, shortCircuit: true };
  }
  return nextResolve(source, context);
}
