import { LedgerError } from './expense-ledger.mjs';
const same = (a,b) => a?.memberId === b?.memberId && a?.accountUserId === b?.accountUserId && a?.email === b?.email;
export function weeklyReviewPayload(payload, policy, requesterEmail) {
  if (!policy) throw new LedgerError('尚未配置石老师和冯永玄的审核账号，请联系管理员。',409);
  const route=policy.technical.filter(p=>p.email!==requesterEmail);
  if (!route.length) throw new LedgerError('需要一位独立技术审核人。',409);
  return {...payload, circulationRecipients:[], circulationConfirmations:[], circulationApprovers:route,
    circulationApprovals:[], circulationOrdered:false, circulationAnyTechnical:true,
    technicalWeekly:true, weeklyReviewVersion:2};
}
export function assertWeeklyReviewRoute(payload, policy, requesterEmail) {
  if (payload.weeklyReviewVersion!==2) return;
  const expected=weeklyReviewPayload({},policy,requesterEmail).circulationApprovers;
  const stored=payload.circulationApprovers, decisions=payload.circulationApprovals;
  if (!Array.isArray(stored)||stored.length!==expected.length||stored.some((p,i)=>!same(p,expected[i]))
      || !Array.isArray(decisions)||decisions.length>1||decisions.some(d=>!d.confirmedAt||!expected.some(p=>same(p,d))))
    throw new LedgerError('周报审核人或身份已变化，请退回后重新提交。',409);
}
// Read archived evidence against its immutable route, not today's staff configuration.
export function weeklyAccepted(row,payload) {
  if (row.approval_status!=='已归档'||!row.confirmed_at||payload.technicalWeekly!==true||payload.circulationAnyTechnical!==true) return false;
  const route=payload.circulationApprovers,decisions=payload.circulationApprovals;
  if (!Array.isArray(route)||!route.length||!Array.isArray(decisions)||!decisions.length) return false;
  if (decisions.some(d=>!d.confirmedAt||!route.some(p=>same(p,d))||d.memberId===row.member_id)) return false;
  if(payload.weeklyReviewVersion===2) return decisions.length===1;
  const tech=route.slice(0,-1),owner=route.at(-1);
  return tech.some(p=>decisions.some(d=>same(p,d)))&&decisions.some(d=>same(owner,d));
}
