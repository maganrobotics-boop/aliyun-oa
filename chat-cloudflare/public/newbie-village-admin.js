"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const state = { records: [], selected: null, student: null, overview: null, tab: "overview", studentsPage: 1, questionsPage: 1, questionEmail: "", generation: 0, requests: {} };
const elements = {
  loginPanel: $(".login-panel"), loginForm: $(".login-form"), loginStatus: $(".login-status"),
  app: $(".admin-app"), logout: $(".logout"), filter: $(".status-filter"),
  records: $(".agreements-list"), listStatus: $(".list-status"), dialog: $(".review-dialog"),
  reviewStatus: $(".review-status"), studentDialog: $(".student-dialog"),
};
const statusLabels = { not_signed: "未签署", pending: "待审核", approved: "已通过", rejected: "已驳回", not_started: "尚未开始", in_progress: "进行中", completed: "已完成（自报）" };
const count = (value) => Math.max(0, Number(value) || 0);

function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== null && text !== undefined) item.textContent = String(text);
  return item;
}
function button(label, className, action) {
  const item = node("button", className, label);
  item.type = "button";
  item.addEventListener("click", action);
  return item;
}
function status(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}
async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store",
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败，请稍后重试。");
    error.status = response.status;
    throw error;
  }
  return payload;
}
function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(date);
}
function beginRequest(kind) {
  state.requests[kind] = (state.requests[kind] || 0) + 1;
  const requestId = state.requests[kind];
  const generation = state.generation;
  return () => generation === state.generation && requestId === state.requests[kind];
}
function handleError(error, target) {
  if (error.status === 401 || error.status === 403) {
    showLogin("管理会话已失效，请重新登录。");
    return;
  }
  status(target, `${error.message} 可点击“刷新数据”重试。`, true);
}
function showLogin(message = "") {
  state.generation += 1;
  state.records = [];
  state.selected = null;
  state.student = null;
  state.overview = null;
  state.questionEmail = "";
  state.studentsPage = 1;
  state.questionsPage = 1;
  state.tab = "overview";
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  document.querySelectorAll(".metrics,.task-summary,.students-list,.questions-list,.agreements-list,.pagination,.student-detail-meta,.student-detail-tasks").forEach((item) => item.replaceChildren());
  document.querySelectorAll(".review-person,.student-detail-email,#student-detail-heading").forEach((item) => { item.textContent = ""; });
  $(".students-search").reset();
  $(".questions-search").reset();
  $(".student-question-filter").hidden = true;
  $(".overview-content").hidden = true;
  elements.loginPanel.hidden = false;
  elements.app.hidden = true;
  elements.logout.hidden = true;
  status(elements.loginStatus, message);
}
function showApp() {
  elements.loginPanel.hidden = true;
  elements.app.hidden = false;
  elements.logout.hidden = false;
  setTab("overview");
}
function setTab(tab, load = true) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((item) => {
    const active = item.dataset.tab === tab;
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".tab-panel").forEach((item) => { item.hidden = item.id !== `panel-${tab}`; });
  if (load) void loadCurrent();
}
function loadCurrent() {
  return ({ overview: loadOverview, students: loadStudents, questions: loadQuestions, agreements: loadRecords })[state.tab]();
}
function detail(label, value) {
  const box = node("div");
  box.append(node("span", "", label), node("strong", "", value || "—"));
  return box;
}
function tag(value) {
  return node("span", `tag ${Object.hasOwn(statusLabels, value) ? value : "not_started"}`, statusLabels[value] || "未知状态");
}
function empty(target, text) {
  target.replaceChildren(node("div", "panel empty", text));
}
function progress(completed, inProgress, total) {
  const track = node("div", "progress-track");
  track.setAttribute("aria-hidden", "true");
  const done = node("div", "progress-completed");
  const active = node("div", "progress-active");
  const denominator = Math.max(1, count(total));
  const doneWidth = Math.min(100, count(completed) / denominator * 100);
  done.style.width = `${doneWidth}%`;
  active.style.width = `${Math.min(100 - doneWidth, count(inProgress) / denominator * 100)}%`;
  track.append(done, active);
  return track;
}
function taskTitle(taskId) {
  return (state.overview?.tasks || []).find((task) => task.id === taskId)?.title || taskId || "课程任务";
}
function renderOverview(data) {
  const summary = data.summary || {};
  const metrics = [
    ["已知注册账号", summary.registered, `学生 ${count(summary.students)} 人 · 教职工 ${count(summary.staff)} 人`],
    ["已开始学习", summary.started, "至少一关已开始或已完成"],
    ["全部完成（自报）", summary.completed, "完成全部课程任务的账号"],
    ["已记录提问", summary.questions, `已签署协议 ${count(summary.agreementsSigned)} 人`],
  ];
  $(".metrics").replaceChildren(...metrics.map(([label, value, subtitle]) => {
    const card = node("div", "metric");
    card.append(node("div", "metric-label", label), node("div", "metric-value", count(value).toLocaleString("zh-CN")), node("div", "metric-subtitle", subtitle));
    return card;
  }));
  const registrationNote = data.registrationNote || "注册统计为系统当前可识别的累计账号，包含学生与教职工。历史账号的首次注册时间可能无法追溯。";
  $(".registration-note").textContent = `${registrationNote} 历史回填账号：${count(summary.registrationInferred)} 个。`;
  $(".progress-note").textContent = data.progressNote || "统计包含学生和教职工。以下进度由使用者自报，完成不代表教师验收通过。";
  if (data.questionNote) $(".question-note").textContent = data.questionNote;
  const rows = (data.tasks || []).map((task) => {
    const row = node("div", "task-summary-row");
    row.append(node("div", "task-summary-name", task.title || task.id), progress(task.completed, task.inProgress, task.total), node("div", "task-summary-label", `完成 ${count(task.completed)} · 进行中 ${count(task.inProgress)} / ${count(task.total)} 人`));
    return row;
  });
  if (rows.length) {
    const legend = node("div", "legend");
    legend.append(node("span", "", "已完成（自报）"), node("span", "", "进行中"));
    $(".task-summary").replaceChildren(...rows, legend);
  } else empty($(".task-summary"), "暂未读取到课程任务，请稍后刷新。");
  const select = $('[name="course"]', $(".questions-search"));
  const selectedCourse = select.value;
  const all = node("option", "", "全部课程");
  all.value = "";
  select.replaceChildren(all, ...(data.tasks || []).map((task) => {
    const option = node("option", "", task.title || task.id);
    option.value = task.id;
    return option;
  }));
  select.value = selectedCourse;
  $(".overview-content").hidden = false;
}
async function loadOverview() {
  const current = beginRequest("overview");
  const target = $(".overview-status");
  status(target, "正在读取注册与学习概况…");
  try {
    const data = await requestJson("/api/admin/newbie-overview");
    if (!current()) return;
    state.overview = data;
    renderOverview(data);
    status(target, `数据更新于 ${formatTime(Date.now())}（北京时间）`);
  } catch (error) {
    if (!current()) return;
    $(".overview-content").hidden = true;
    handleError(error, target);
  }
}
function renderPagination(target, pagination, onPage) {
  const total = count(pagination?.total);
  const page = Math.max(1, count(pagination?.page));
  const totalPages = Math.max(1, count(pagination?.totalPages));
  target.replaceChildren();
  if (!total) return;
  const controls = node("div", "pagination-actions");
  const previous = button("上一页", "secondary", () => onPage(page - 1));
  const next = button("下一页", "secondary", () => onPage(page + 1));
  previous.disabled = page <= 1;
  next.disabled = page >= totalPages;
  controls.append(previous, node("span", "", `${page} / ${totalPages}`), next);
  target.append(node("span", "", `共 ${total} 条 · 每页 ${count(pagination?.pageSize) || 20} 条`), controls);
}
function studentRow(student) {
  const row = node("tr");
  const labels = ["学生 / 账号", "年级与方向", "学习进度（自报）", "最近活动", ""];
  const cells = labels.map((label) => { const cell = node("td"); cell.dataset.label = label; return cell; });
  cells[0].append(node("div", "student-name", student.displayName || "未填写姓名"), node("div", "student-secondary", student.email));
  if (student.role === "staff") cells[0].append(node("div", "student-secondary", "教职工"));
  cells[1].append(node("div", "", [student.grade, student.major].filter(Boolean).join(" · ") || "尚未填写"), node("div", "student-secondary", student.direction || "未填写项目方向"));
  const learning = node("div", "student-progress");
  learning.append(node("strong", "", `${count(student.completed)} / ${count(student.total)} 关`), progress(student.completed, student.inProgress, student.total), node("div", "student-secondary", `进行中 ${count(student.inProgress)} · 提问 ${count(student.questionCount)}`));
  cells[2].append(learning);
  cells[3].append(node("div", "", formatTime(student.lastActivityAt)), node("div", "student-secondary", `协议：${statusLabels[student.agreementStatus] || "未知"}`));
  cells[4].append(button("查看详情", "secondary row-link", () => openStudent(student)));
  row.append(...cells);
  return row;
}
function renderStudents(records) {
  const target = $(".students-list");
  if (!records.length) { empty(target, "暂无符合条件的账号。可调整搜索词或学习状态后查询。"); return; }
  const wrapper = node("div", "table-container");
  const table = node("table");
  table.setAttribute("aria-label", "学生学习进度列表");
  const head = node("thead");
  const heading = node("tr");
  ["学生 / 账号", "年级与方向", "学习进度（自报）", "最近活动", "详情"].forEach((label) => { const cell = node("th", "", label); cell.scope = "col"; heading.append(cell); });
  head.append(heading);
  const body = node("tbody");
  body.append(...records.map(studentRow));
  table.append(head, body);
  wrapper.append(table);
  target.replaceChildren(wrapper);
}
async function loadStudents() {
  const current = beginRequest("students");
  const target = $(".students-status");
  const form = new FormData($(".students-search"));
  const query = new URLSearchParams({ q: String(form.get("q") || "").trim(), status: String(form.get("status") || "all"), page: String(state.studentsPage), pageSize: "20" });
  status(target, "正在读取学生进度…");
  $(".students-pagination").replaceChildren();
  try {
    const data = await requestJson(`/api/admin/newbie-students?${query}`);
    if (!current()) return;
    renderStudents(data.records || []);
    renderPagination($(".students-pagination"), data.pagination, (page) => { state.studentsPage = page; void loadStudents(); });
    status(target, `找到 ${count(data.pagination?.total)} 个账号（含教职工账号）。点击详情查看各关任务与学习证据。`);
  } catch (error) {
    if (!current()) return;
    $(".students-list").replaceChildren();
    handleError(error, target);
  }
}
function openStudent(student) {
  state.student = student;
  $("#student-detail-heading").textContent = student.displayName || "未填写姓名";
  $(".student-detail-email").textContent = student.email;
  const registeredLabel = student.registrationSource === "inferred" ? "历史账号（首次时间未知）" : formatTime(student.registeredAt);
  $(".student-detail-meta").replaceChildren(
    detail("账号角色", student.role === "staff" ? "教职工" : "学生"),
    detail("年级 / 专业", [student.grade, student.major].filter(Boolean).join(" / ")),
    detail("项目方向", student.direction), detail("注册时间", registeredLabel),
    detail("最近登录", formatTime(student.lastLoginAt)), detail("协议审核", statusLabels[student.agreementStatus] || "未知"),
  );
  const progressById = new Map((student.tasks || []).map((task) => [task.taskId, task]));
  const tasks = (state.overview?.tasks || []).map((task) => ({ taskId: task.id, title: task.title, ...(progressById.get(task.id) || { status: "not_started" }) }));
  for (const task of student.tasks || []) if (!tasks.some((item) => item.taskId === task.taskId)) tasks.push(task);
  if (tasks.length) $(".student-detail-tasks").replaceChildren(...tasks.map((task) => {
    const article = node("article", "task-detail");
    const head = node("div", "task-detail-header");
    head.append(node("div", "task-detail-title", task.title || taskTitle(task.taskId)), tag(task.status || "not_started"));
    article.append(head, node("div", `task-evidence${task.evidence ? "" : " empty-evidence"}`, task.evidence || "尚未提交学习证据。"), node("div", "task-time", `最后更新：${formatTime(task.updatedAt)}`));
    return article;
  }));
  else empty($(".student-detail-tasks"), "尚无任务进度记录。");
  $(".student-questions").textContent = `查看该生提问（${count(student.questionCount)}）`;
  elements.studentDialog.showModal();
}
function questionCard(question) {
  const article = node("article", "record");
  const head = node("div", "record-head");
  const identity = node("div");
  identity.append(node("h2", "", question.displayName || "未填写姓名"), node("div", "record-email", question.email));
  head.append(identity, button("该生提问", "secondary row-link", () => filterQuestionsForStudent(question.email)));
  const context = node("div", "question-context");
  context.append(node("span", "", question.courseTitle || taskTitle(question.courseId)), node("span", "", formatTime(question.createdAt)));
  const content = node("div", "question-text", question.question);
  article.append(head, context, content);
  if (String(question.question || "").length > 450) {
    content.classList.add("question-preview");
    const toggle = button("展开完整提问", "text-button question-toggle", () => {
      const folded = content.classList.toggle("question-preview");
      toggle.textContent = folded ? "展开完整提问" : "收起";
      toggle.setAttribute("aria-expanded", String(!folded));
    });
    toggle.setAttribute("aria-expanded", "false");
    article.append(toggle);
  }
  return article;
}
function filterQuestionsForStudent(email) {
  state.questionEmail = email || "";
  state.questionsPage = 1;
  $(".questions-search").reset();
  elements.studentDialog.close();
  setTab("questions");
}
async function loadQuestions() {
  const current = beginRequest("questions");
  const target = $(".questions-status");
  const form = new FormData($(".questions-search"));
  const query = new URLSearchParams({ q: String(form.get("q") || "").trim(), course: String(form.get("course") || ""), email: state.questionEmail, page: String(state.questionsPage), pageSize: "20" });
  $(".student-question-filter").hidden = !state.questionEmail;
  $(".student-question-filter span").textContent = `当前学生：${state.questionEmail}`;
  status(target, "正在读取课程提问…");
  $(".questions-pagination").replaceChildren();
  try {
    const data = await requestJson(`/api/admin/newbie-questions?${query}`);
    if (!current()) return;
    const records = data.records || [];
    if (records.length) $(".questions-list").replaceChildren(...records.map(questionCard));
    else empty($(".questions-list"), "暂无符合条件的提问。历史提问不会自动补回；仅展示功能启用后记录的课程提问。");
    renderPagination($(".questions-pagination"), data.pagination, (page) => { state.questionsPage = page; void loadQuestions(); });
    status(target, `共 ${count(data.pagination?.total)} 条提问 · 按时间从新到旧排列 · 时间为北京时间`);
  } catch (error) {
    if (!current()) return;
    $(".questions-list").replaceChildren();
    handleError(error, target);
  }
}
function recordCard(record) {
  const article = node("article", "record");
  const head = node("div", "record-head");
  const identity = node("div");
  identity.append(node("h2", "", record.signerName), node("div", "record-email", record.email));
  head.append(identity, tag(record.reviewStatus));
  const meta = node("div", "record-meta");
  meta.append(detail("协议版本", record.agreementVersion), detail("签署时间", formatTime(record.acceptedAt)), detail("内容摘要", record.contentSha256));
  article.append(head, meta);
  if (record.reviewNote) article.append(node("p", "", `审核备注：${record.reviewNote}`));
  if (record.reviewStatus === "pending") {
    const actions = node("div", "record-actions");
    actions.append(button("审核", "primary", () => openReview(record)));
    article.append(actions);
  }
  return article;
}
async function loadRecords() {
  const current = beginRequest("agreements");
  status(elements.listStatus, "正在读取内部归档…");
  try {
    const data = await requestJson(`/api/admin/newbie-agreements?status=${encodeURIComponent(elements.filter.value)}`);
    if (!current()) return;
    state.records = data.records || [];
    if (state.records.length) elements.records.replaceChildren(...state.records.map(recordCard));
    else empty(elements.records, "当前没有符合条件的签署记录。");
    status(elements.listStatus, `共 ${state.records.length} 条记录`);
  } catch (error) {
    if (!current()) return;
    elements.records.replaceChildren();
    handleError(error, elements.listStatus);
  }
}
function openReview(record) {
  state.selected = record;
  $(".review-person").textContent = `${record.signerName} · ${record.email} · ${record.agreementVersion}`;
  $('[name="reviewNote"]', elements.dialog).value = record.reviewNote || "";
  status(elements.reviewStatus, "");
  elements.dialog.showModal();
}
async function review(reviewStatus) {
  if (!state.selected) return;
  const reviewNote = $('[name="reviewNote"]', elements.dialog).value.trim();
  if (reviewStatus === "rejected" && !reviewNote) { status(elements.reviewStatus, "请填写驳回原因，便于同学修改。", true); $('[name="reviewNote"]', elements.dialog).focus(); return; }
  const generation = state.generation;
  elements.dialog.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  status(elements.reviewStatus, reviewStatus === "approved" ? "正在通过…" : "正在驳回…");
  try {
    await requestJson("/api/admin/newbie-agreements/review", { method: "POST", body: JSON.stringify({ email: state.selected.email, agreementVersion: state.selected.agreementVersion, reviewStatus, reviewNote }) });
    if (generation !== state.generation) return;
    elements.dialog.close();
    await loadRecords();
  } catch (error) {
    if (generation === state.generation) handleError(error, elements.reviewStatus);
  } finally {
    elements.dialog.querySelectorAll("button").forEach((item) => { item.disabled = false; });
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("button", elements.loginForm);
  submit.disabled = true;
  status(elements.loginStatus, "正在登录…");
  try {
    const form = new FormData(elements.loginForm);
    await requestJson("/api/auth/login", { method: "POST", body: JSON.stringify({ password: String(form.get("password") || "") }) });
    elements.loginForm.reset();
    showApp();
  } catch (error) { status(elements.loginStatus, error.message, true); }
  finally { submit.disabled = false; }
});
document.querySelectorAll("[data-tab]").forEach((item) => item.addEventListener("click", () => setTab(item.dataset.tab)));
$(".tabs").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const index = tabs.indexOf(document.activeElement);
  if (index < 0 || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  setTab(tabs[next].dataset.tab);
});
$(".refresh-current").addEventListener("click", () => void loadCurrent());
$(".view-students").addEventListener("click", () => setTab("students"));
$(".students-search").addEventListener("submit", (event) => { event.preventDefault(); state.studentsPage = 1; void loadStudents(); });
$('[name="status"]', $(".students-search")).addEventListener("change", () => { state.studentsPage = 1; void loadStudents(); });
$(".questions-search").addEventListener("submit", (event) => { event.preventDefault(); state.questionsPage = 1; void loadQuestions(); });
$('[name="course"]', $(".questions-search")).addEventListener("change", () => { state.questionsPage = 1; void loadQuestions(); });
$(".clear-student-filter").addEventListener("click", () => { state.questionEmail = ""; state.questionsPage = 1; void loadQuestions(); });
$(".student-questions").addEventListener("click", () => { if (state.student) filterQuestionsForStudent(state.student.email); });
elements.studentDialog.querySelector(".close").addEventListener("click", () => elements.studentDialog.close());
elements.filter.addEventListener("change", () => void loadRecords());
$(".refresh").addEventListener("click", () => void loadRecords());
elements.logout.addEventListener("click", async () => {
  elements.logout.disabled = true;
  try {
    await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
    showLogin("已退出管理端。");
  } catch (error) {
    showLogin("当前页面已隐藏管理数据，但退出请求未完成。请重试登录后退出，或关闭此浏览器会话。");
  } finally { elements.logout.disabled = false; }
});
elements.dialog.querySelector(".close").addEventListener("click", () => elements.dialog.close());
elements.dialog.querySelector(".approve").addEventListener("click", () => void review("approved"));
elements.dialog.querySelector(".reject").addEventListener("click", () => void review("rejected"));
$(".review-form").addEventListener("submit", (event) => event.preventDefault());

requestJson("/api/auth/status")
  .then((result) => result.signedIn ? showApp() : showLogin())
  .catch(() => showLogin("无法读取管理状态，请刷新重试。"));
