import { industrialProjects } from './project-catalogue.mjs';
// Student-provided material is kept separate from server-read learning evidence.
export const APPLICATION_DECISION_PATH = '/api/internal/project-application-decision';
export const APPLICATION_PATH = '/api/internal/project-applications';
export const APPLICATION_MAX_BYTES = 8 * 1024 * 1024;
export const APPLICATION_FILE_BYTES = 5 * 1024 * 1024;
export const APPLICATION_VERSION = 1;
const encoder = new TextEncoder();
export const applicationError = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const applicationJson = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
export function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)); }
export function applicationText(value, maximum, label, minimum = 0) {
  if (typeof value !== 'string' || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || value.length > maximum || value.trim().length < minimum) applicationError(`${label}内容或长度不正确。`);
  return value.trim();
}
export function applicationEmail(value) {
  const email = applicationText(value, 254, '账号', 3).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) applicationError('账号格式不正确。');
  return email;
}
export function applicationId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)) applicationError('申请编号不正确。');
  return value;
}
export function validateApplicationFields(value) {
  const limits = { name: [60, 1, '姓名'], school: [120, 2, '学校、专业与年级'], academicResults: [600, 2, '课程成绩'], introduction: [800, 2, '个人介绍'], experience: [600, 2, '技能与项目经历'], project: [160, 2, '意向项目'], availability: [120, 1, '可投入时间'] };
  if (!exactKeys(value, Object.keys(limits)) || Object.keys(value).length !== Object.keys(limits).length) applicationError('请填写完整的项目报名资料。');
  return Object.fromEntries(Object.entries(limits).map(([key, [maximum, minimum, label]]) => [key, applicationText(value[key], maximum, label, minimum)]));
}
export function validateApplicationFiles(value = []) {
  if (!Array.isArray(value) || value.length > 3) applicationError('最多上传 3 份材料。');
  let total = 0;
  return value.map(file => {
    if (!exactKeys(file, ['name', 'base64']) || typeof file.base64 !== 'string' || file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.base64) || !file.base64) applicationError('附件编码不正确。');
    const name = applicationText(file.name, 120, '附件名称', 1);
    if (/[\/\\\r\n]/u.test(name)) applicationError('附件名称不正确。');
    const size = file.base64.length / 4 * 3 - (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0);
    total += size;
    if (size > 3 * 1024 * 1024 || total > APPLICATION_FILE_BYTES) applicationError('单份材料不得超过 3 MB，合计不得超过 5 MB。', 413);
    const decoded=atob(file.base64);if(btoa(decoded)!==file.base64)applicationError('附件编码不正确。');
    const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
    let mimeType = '';
    if (/\.pdf$/iu.test(name) && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') mimeType = 'application/pdf';
    if (/\.png$/iu.test(name) && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) mimeType = 'image/png';
    if (/\.jpe?g$/iu.test(name) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mimeType = 'image/jpeg';
    if (!mimeType) applicationError('请上传 PDF、PNG 或 JPG 材料，文件格式需与名称一致。');
    return { name, size, mimeType, bytes };
  });
}
export function projectApplicationIntent(question) {
  if (typeof question !== 'string') return false;
  if(/项目工作(?:课程|课)|学习.*项目.*课|项目.*课.*学习/u.test(question))return false;
  const q = question.normalize('NFKC').replace(/\s+/gu, '');
  if (/(?:不想|不打算|不愿|不要|不参与|不参加|不加入|不报名|不申请|取消报名)/u.test(q)) return false;
  return /(?:项目|课题).{0,8}(?:怎么|如何|可以).{0,8}(?:报名|申请|参与)/u.test(q) || /(?:想|希望|打算|申请|可以|能否|怎么|如何|我要|我能).{0,16}(?:参与|参加|加入|报名).{0,12}(?:项目|实验室|课题|团队)|(?:参与|参加|加入|报名).{0,12}(?:项目|实验室|课题|团队).{0,8}(?:申请|报名|可以|如何|怎么)|^(?:项目报名|申请入组|加入实验室|报名项目)$/u.test(q);
}
export const PROJECT_APPLICATION_GUIDANCE = '参与实验室项目，请先查看官网现有的三个工业项目：'+industrialProjects.map(p=>`${p.title}（${p.url}）`).join('；')+'。请提供姓名、学校/专业/年级、课程成绩、个人介绍、技能与项目经历、项目意向和每周可投入时间。须先通过新手村最后一关；平台自动附上真实章节进度、作业记录、结业结果和助教点评。核对后提交给马淦老师，进入 OA 待处理。课程项目每学期只能选一个，选定后立即开放章节并通知 OA，无需等待报名审批。';
export async function applicationHash(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function signedBytes(timestamp, nonce, body, pathname = APPLICATION_PATH) { return encoder.encode(`project-application/v1\nPOST\n${pathname}\n${timestamp}\n${nonce}\n${body}`); }
async function signingKey(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) applicationError('项目申请服务暂未就绪。', 503);
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
export async function signApplication(body, secret, { now = Date.now(), nonce = crypto.randomUUID(), pathname = APPLICATION_PATH } = {}) {
  const timestamp = String(Math.floor(now / 1000));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret, 'sign'), signedBytes(timestamp, nonce, body, pathname)));
  return { 'content-type': 'application/json', 'x-project-time': timestamp, 'x-project-nonce': nonce, authorization: `Project-HMAC ${[...signature].map(byte => byte.toString(16).padStart(2, '0')).join('')}` };
}
export async function readApplicationBody(request, maximum = APPLICATION_MAX_BYTES) {
  if (!request.body) applicationError('申请内容为空。');
  const reader = request.body.getReader(), parts = []; let length = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) { await reader.cancel(); applicationError('申请材料过大。', 413); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { applicationError('申请编码不正确。'); }
}
export async function verifyApplication(request, secret, now = Date.now(), pathname = APPLICATION_PATH) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== pathname || request.headers.has('origin') || request.headers.has('cookie')) applicationError('仅限已授权的学习系统。', 401);
  const timestamp = request.headers.get('x-project-time') || '', nonce = request.headers.get('x-project-nonce') || '';
  const signature = /^Project-HMAC ([a-f0-9]{64})$/u.exec(request.headers.get('authorization') || '')?.[1];
  if (!signature || !/^\d{10,12}$/u.test(timestamp) || !/^[a-f0-9-]{36}$/u.test(nonce) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 60) applicationError('服务认证失败。', 401);
  const body = await readApplicationBody(request);
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret, 'verify'), Uint8Array.from(signature.match(/../gu), hex => parseInt(hex, 16)), signedBytes(timestamp, nonce, body, pathname));
  if (!valid) applicationError('服务认证失败。', 401);
  let payload; try { payload = JSON.parse(body); } catch { applicationError('申请格式不正确。'); }
  return { payload, nonce };
}
export function learningSummary(snapshot) {
  const latest = snapshot.currentChapter?.title || '暂无章节记录';
  const graduation = { passed: '已通过', needs_retry: '尚未通过', not_attempted: '尚未参加' }[snapshot.graduation?.status] || '暂无结业记录';
  return `最近学习：${latest}；已提交 ${snapshot.submittedChapters}/${snapshot.totalChapters} 章；${snapshot.submissionCount} 份作业，${snapshot.reviewedCount} 份已有助教点评；结业测试：${graduation}。`;
}
export function applicationContent(fields, snapshot, { selection, labProjectId } = {}) {
  const project = industrialProjects.find(p => p.id === labProjectId);
  const prefix = selection ? `课程项目选题：${selection.semesterLabel}；选定后已开放对应章节，无需等待审批。\n\n` : project ? `实验室项目：${project.title}\n官网介绍：${project.url}\n\n` : '';
  return prefix + [['姓名', fields.name], ['学校/专业/年级', fields.school], ['学生提供的课程成绩', fields.academicResults], ['个人介绍', fields.introduction], ['技能与项目经历', fields.experience], ['意向项目', fields.project], ['每周可投入时间', fields.availability], ['平台学习记录', learningSummary(snapshot)], ['记录时间', snapshot.capturedAt], ['成绩说明', '平台作业尚无统一数值评分；已提交、助教点评和结业通过分别记录。学生自述成绩及附件待老师核查。']].map(([label, value]) => `${label}：${value}`).join('\n\n');
}
