/** Source-bound proposals only. A proposal is never an approved accomplishment or payment. */
/** @type {ReadonlyArray<{key:'procurement'|'work'|'achievement',label:string}>} */
export const MATERIAL_CATEGORIES = Object.freeze([
  { key: 'procurement', label: '采购账单' },
  { key: 'work', label: '从事的工作' },
  { key: 'achievement', label: '取得的成果' },
]);
export const MATERIAL_MAX_TEXT = 30000;
const tidy = s => String(s || '').normalize('NFKC').trim();
const purchase = /采购|购买|买了|账单|发票|报销|退款|付款|支付|收据|订单|代付/u;
const activity = /工作|任务|项目|负责|研究|调研|设计|开发|测试|实验|联调|验证|实现|训练|定位|导航|抓取|装配|加工|调试|部署|制作|提交/u;
const outcome = /成果|取得|完成|实现|通过|成功|获奖|获得|发表|验收|提升|降低|修复|达到|产出|交付/u;
const unfinished = /尚未|未完成|未实现|未通过|待完成|待验收|待验证|计划|打算|建议|下周|下月|将要|准备购买/u;
const metadata = /^(?:编制|编写|作者|审核|审批|主持|参会人|参与人员|导师|指导教师|负责人名单|会议日期|日期|版本|资料来源|来源)\s*[:：]/u;
const cleanLine = s => tidy(s).replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.、)）]\s*)/u, '').replace(/\*\*/gu, '');
function headerCategory(s) {
  const x = cleanLine(s).replace(/[:：]$/u, '');
  if (/^(?:采购账单|采购与报销|采购|账单|设备采购与报销)$/u.test(x)) return 'procurement';
  if (/^(?:从事的工作|本人工作|工作内容|工作进展|本周工作|工作|已完成工作)$/u.test(x)) return 'work';
  if (/^(?:取得的成果|工作成果|项目成果|成果|实验结果|本周成果)$/u.test(x)) return 'achievement';
  return null;
}
export function isPersonnelMaterialMessage(text) {
  if (typeof text !== 'string') return false;
  const s = tidy(text);
  // Questions, lookups and hypotheticals must never produce confirmation records.
  if (!s || /[?？]|(?:请问|查询|查一下|查出来|查找|假设|例如|举例)/u.test(s)) return false;
  // A person's category name alone is a lookup, without source facts to submit.
  if (!s.includes('\n') && /(?:采购账单|从事的工作|取得的成果)\s*[。！!：:]?$/u.test(s)) return false;
  return /采购账单|从事的工作|取得的成果/u.test(s)
    || (/周报|周会记录|会议纪要|工作汇报|发票|账单/u.test(s) && s.length >= 30)
    || (/^(?:我|本人).*(?:本周|今天|本月)/u.test(s) && (purchase.test(s) || activity.test(s)))
    || (/\n|[:：]/u.test(s) && s.length >= 30 && outcome.test(s) && activity.test(s));
}
function tokensFor(member) {
  return [...new Set([member.name, member.email, ...(member.aliases || [])].map(tidy).filter(s => s.length >= 2))]
    .sort((a, b) => b.length - a.length);
}
function subject(line, roster) {
  const s = cleanLine(line).replace(/^\|\s*/u, '').replace(/^(?:姓名|购买人|付款人|报销人|工作人)\s*[:：]\s*/u, '');
  const result = [];
  for (const m of roster) {
    for (const token of tokensFor(m)) {
      // Full registered name/email at the subject position. References later in a
      // sentence, author lists and bare substrings do not assign somebody's work.
      if (s.startsWith(token) && (!s[token.length] || /[\s.:：|,，、（(·—–-]/u.test(s[token.length])
        || /^(?:共同|一起|协同|联合|和|与|及|的|在|已|正在|从事|开展|进行|完成|负责|购买|采购|提交|开发|测试|获得|取得|实现|参与|本周|周报)/u.test(s.slice(token.length)))) {
        result.push({ member: m, token }); break;
      }
    }
  }
  const longest = Math.max(0, ...result.map(x => x.token.length));
  return result.filter(x => x.token.length === longest);
}
function subjects(line, roster) {
  const first = subject(line, roster);
  if (first.length !== 1) return { matches: first, ambiguous: first.length > 1 };
  const matches = [...first];
  let rest = cleanLine(line).replace(/^\|\s*/u, '').replace(/^(?:姓名|购买人|付款人|报销人|工作人)\s*[:：]\s*/u, '').slice(first[0].token.length).trim();
  while (/^(?:、|，|,|和|与|及|&)\s*/u.test(rest)) {
    rest = rest.replace(/^(?:、|，|,|和|与|及|&)\s*/u, '');
    const next = subject(rest, roster);
    if (next.length > 1) return { matches: [], ambiguous: true };
    if (!next.length) break;
    if (!matches.some(x => x.member.id === next[0].member.id)) matches.push(next[0]);
    rest = rest.slice(next[0].token.length).trim();
  }
  return { matches, ambiguous: false };
}
export function extractPersonnelMaterial(text, roster, { senderId, title = '' } = {}) {
  if (typeof text !== 'string' || text.trim().length < 2 || text.length > MATERIAL_MAX_TEXT) throw new Error('MATERIAL_INVALID');
  const entries = new Map(), unresolved = [];
  const filenameSubject=subject(title,roster);
  let current = filenameSubject.length===1?[filenameSubject[0].member]:[], section = null;
  const add = (member, category, quote) => {
    let entry = entries.get(member.id);
    if (!entry) { entry = { memberId: member.id, accountUserId: member.accountUserId, name: member.name,
      procurement: [], work: [], achievement: [], quotes: [] }; entries.set(member.id, entry); }
    if (!entry[category].includes(quote)) entry[category].push(quote);
    if (!entry.quotes.includes(quote)) entry.quotes.push(quote);
  };
  for (const original of text.replace(/\r\n?/gu, '\n').split('\n')) {
    const s = cleanLine(original);
    if (!s || /^!\[|^https?:\/\/|^\|?\s*:?-{3,}/u.test(s)) continue;
    if (metadata.test(s)) { current = []; section = null; continue; }
    const category = headerCategory(s);
    if (category) { section = category; continue; }
    let { matches, ambiguous } = subjects(original, roster);
    if (!matches.length && /^(?:我|本人)(?:的|本周|本月|今天|[:：\s])/u.test(s)) {
      const owner = roster.find(m => m.id === senderId);
      if (owner) matches = [{ member: owner, token: '' }];
    }
    if (ambiguous) { unresolved.push({ reason: '姓名对应多个账号', quote: original }); current = []; section = null; continue; }
    if (matches.length) {
      current = matches.map(x => x.member);
      // A new person's heading resets the preceding person's category.
      section = null;
    } else if (/^#{1,6}\s/u.test(original) && !category) {
      // An unrecognised person/project heading must not inherit the previous person.
      current = []; section = null;
    }
    if (!current.length) {
      if ((purchase.test(s) || activity.test(s) || outcome.test(s)) && !/^\|.*姓名.*\|/u.test(s))
        unresolved.push({ reason: '未能唯一关联本人账号', quote: original });
      continue;
    }
    if (/^#{1,6}\s/u.test(original) && matches.length) continue;
    if (current.length === 1 && (s === current[0].name || s === current[0].email || (matches.length === 1 && /^[\s:：|—-]*$/u.test(s.slice(matches[0].token.length))))) continue;
    const quote = original.trim();
    const inline = /(?:采购账单|采购|账单)\s*[:：]/u.test(s) ? 'procurement'
      : /(?:取得的成果|成果)\s*[:：]/u.test(s) ? 'achievement'
      : /(?:从事的工作|工作内容|工作)\s*[:：]/u.test(s) ? 'work' : null;
    const selected = inline || section;
    if (current.length > 1 && (selected === 'procurement' || purchase.test(s))) {
      unresolved.push({ reason: '共同采购未明确账单归属，请本人核对', quote }); continue;
    }
    if (selected==='achievement'&&unfinished.test(s)) {
      if(activity.test(s))current.forEach(member=>add(member,'work',quote));
      else unresolved.push({reason:'计划或尚未完成，不能计为已取得成果',quote});
    }
    else if (selected) current.forEach(member=>add(member, selected, quote));
    else if (purchase.test(s)) current.forEach(member=>add(member, 'procurement', quote));
    else {
      if (activity.test(s)) current.forEach(member=>add(member, 'work', quote));
      if (outcome.test(s)&&!unfinished.test(s)) current.forEach(member=>add(member, 'achievement', quote));
    }
  }
  return { entries: [...entries.values()], unresolved: unresolved.slice(0, 100) };
}
export function materialContent(entry) {
  return MATERIAL_CATEGORIES.map(({ key, label }) => {
    const full = entry[key].join('\n');
    const body = full.length > 1000 ? full.slice(0, 900) + '\n（内容较长，请核对原文并补充本人确认内容。）' : full;
    return `## ${label}\n${body || '本份材料未提取到此项，请本人核对。'}`;
  }).join('\n\n');
}
export function readMaterialCategories(content) {
  const result = { procurement: '', work: '', achievement: '' };
  let current = null;
  for (const line of String(content || '').split('\n')) {
    const heading = headerCategory(line);
    if (heading) { current = heading; continue; }
    if (current) result[current] += (result[current] ? '\n' : '') + line;
  }
  for (const key of Object.keys(result)) {
    result[key] = result[key].trim();
    if (result[key] === '本份材料未提取到此项，请本人核对。') result[key] = '';
  }
  return result;
}
