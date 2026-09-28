/* Generated from Chat's DOM-safe answer renderer; do not edit. */
/* eslint-disable */

let answerMathEngine = null;


function cleanPublicChatText(value) {
  return String(value || "").trim();
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}


function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/gu, '\n').split('\n');
  const out = []; let paragraph = []; let items = []; let listType = '';
  const flushParagraph = () => { if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; };
  const flushList = () => { if (items.length) out.push(`<${listType}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${listType}>`); items = []; listType = ''; };
  const flush = () => { flushParagraph(); flushList(); };
  const cells = line => line.trim().replace(/^\||\|$/gu, '').split('|').map(x => x.trim());
  const separator = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line || '');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/u);
    if (fence) {
      flush(); const block=[]; const marker=fence[1];
      const close=new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`,'u');
      while (++i < lines.length && !close.test(lines[i])) block.push(lines[i]);
      const language=(fence[2].trim().match(/^[A-Za-z0-9_+-]{1,30}$/u)||[''])[0];
      out.push(`<pre class="om-code-block"><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(block.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const mathOpen=line.match(/^\s*(\$\$|\\\[)/u);
    if (mathOpen) {
      const close=mathOpen[1]==='$$'?'$$':'\\]'; let tex=line.slice(mathOpen[0].length); let j=i;
      while (!tex.includes(close) && j+1<lines.length) tex+='\n'+lines[++j];
      if (tex.includes(close)) {
        flush(); const end=tex.indexOf(close); out.push(renderAnswerMath(tex.slice(0,end),true,mathOpen[1]+tex.slice(0,end)+close));
        const tail=tex.slice(end+close.length).trim(); if(tail)paragraph.push(tail); i=j; continue;
      }
    }
    const heading=line.match(/^(#{1,3})\s+(.+)$/u);
    if(heading){flush();const level=heading[1].length+2;out.push(`<h${level}>${inline(heading[2])}</h${level}>`);continue;}
    if(line.includes('|') && separator(lines[i+1])) {
      flush();const head=cells(line);const rows=[];i+=1;
      while(i+1<lines.length && lines[i+1].trim() && lines[i+1].includes('|'))rows.push(cells(lines[++i]));
      out.push(`<table><thead><tr>${head.map(x=>`<th>${inline(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);continue;
    }
    const bullet=line.match(/^\s*([-*+]|\d+[.)])\s+(.+)$/u);
    if(bullet){flushParagraph();const type=/^\d/u.test(bullet[1])?'ol':'ul';if(items.length&&listType!==type)flushList();listType=type;items.push(bullet[2]);continue;}
    flushList();paragraph.push(line.trim());
  }
  flush();return out.join('') || '<p>暂无内容。</p>';
}




function renderAnswerBody(answer) {
  const container = document.createElement("div");
  container.className = "answer-content";
  const html = renderMarkdown(answer);
  if ("innerHTML" in container) {
    container.innerHTML = html;
    return container;
  }
  appendControlledHtml(container, html);
  return container;
}


function userFacingAnswer(value) {
  return cleanPublicChatText(value);
}


function appendControlledHtml(root, html) {
  const decode = (value) => value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&");
  const stack = [root];
  const pattern = /<\/?([a-z0-9]+)(?:\s[^>]*)?>|([^<]+)/giu;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[2]) {
      stack.at(-1).append(document.createTextNode(decode(match[2])));
      continue;
    }
    const tag = match[1].toLowerCase();
    if (match[0][1] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = document.createElement(tag);
    stack.at(-1).append(node);
    stack.push(node);
  }
}


function answerMathTokenAt(text, index) {
  let left = "";
  let right = "";
  let display = false;
  if (text.startsWith("\\[", index)) { left = "\\["; right = "\\]"; display = true; }
  else if (text.startsWith("\\(", index)) { left = "\\("; right = "\\)"; }
  else if (text.startsWith("$$", index)) { left = right = "$$"; display = true; }
  else if (text[index] === "$" && text[index - 1] !== "$" && text[index + 1] !== "$") { left = right = "$"; }
  else return null;
  const start = index + left.length;
  const end = text.indexOf(right, start);
  if (end === -1) return null;
  const content = text.slice(start, end);
  const trimmed = content.trim();
  if (left === "$") {
    if (!trimmed || /\r|\n/u.test(content) || /\d/u.test(text[end + 1] || "")) return null;
    const padded = content !== trimmed;
    const looksMathematical = /\\[a-zA-Z]|[_^=+*/<>\-≤≥≠−]/u.test(trimmed) || /^[\p{L}\p{N}.]+$/u.test(trimmed);
    if (padded && !looksMathematical) return null;
  }
  return { raw: text.slice(index, end + right.length), tex: content, display, end: end + right.length };
}


function normalizeAnswerMathTex(value) {
  return String(value).replace(
    /\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}([\s\S]*?)\\end\{\1\}/gu,
    (original, environment, body) => {
      if (/\\(?:begin|end|text|verb|multicolumn|hline)\b/u.test(body)) return original;
      const lines = body.split("\n");
      const rows = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.trim());
      if (rows.length < 2 || rows.length > 50) return original;
      const columns = rows.map(({ line }) => (line.match(/(?<!\\)&/gu) || []).length);
      if (columns[0] < 1 || columns.some((count) => count !== columns[0])) return original;
      const preceding = rows.slice(0, -1);
      if (preceding.some(({ line }) => !/(?<!\\)\\{1,2}[ \t\r]*$/u.test(line))) return original;
      for (const { line, index } of preceding) {
        lines[index] = line.replace(/(?<!\\)\\([ \t\r]*)$/u, (_, spaces) => "\\\\" + spaces);
      }
      return `\\begin{${environment}}${lines.join("\n")}\\end{${environment}}`;
    },
  );
}


function renderAnswerMath(tex, display, raw) {
  const normalizedTex = normalizeAnswerMathTex(tex);
  const mathClass = display ? "math-display answer-math-block" : "math-inline";
  const fallback = `<span class="${mathClass}" data-math-status="fallback" data-tex="${escapeHtml(normalizedTex)}" data-display="${display ? "true" : "false"}" data-raw="${escapeHtml(raw)}">${escapeHtml(raw)}</span>`;
  if (!answerMathEngine?.renderToString || normalizedTex.length > 8000) return fallback;
  try {
    const html = answerMathEngine.renderToString(normalizedTex.trim(), {
      displayMode: display,
      output: "mathml",
      trust: false,
      throwOnError: true,
      strict: "ignore",
      maxExpand: 1000,
      maxSize: 10,
    });
    return `<span class="${mathClass}" data-math-status="rendered">${html}</span>`;
  } catch {
    return fallback;
  }
}


function inline(text) {
  const tokens = [];
  let protectedText = "";
  for (let index = 0; index < String(text).length;) {
    // Only HTTP(S) links; student HTML and unsafe URI schemes stay inert text.
    if (text[index] === '[') {
      const link = text.slice(index).match(/^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/iu);
      if (link) {
        const token = `\uE000C${tokens.length}\uE001`;
        tokens.push(`<a href="${escapeHtml(link[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(link[1])}</a>`);
        protectedText += token; index += link[0].length; continue;
      }
    }
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        const token = `\uE000C${tokens.length}\uE001`;
        tokens.push(`<code>${escapeHtml(text.slice(index + 1, end))}</code>`);
        protectedText += token;
        index = end + 1;
        continue;
      }
    }
    const math = (text[index] === "$" || text[index] === "\\") ? answerMathTokenAt(text, index) : null;
    if (math) {
      const token = `\uE000C${tokens.length}\uE001`;
      tokens.push(renderAnswerMath(math.tex, math.display, math.raw));
      protectedText += token;
      index = math.end;
      continue;
    }
    protectedText += text[index++];
  }
  return escapeHtml(protectedText)
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/\uE000C(\d+)\uE001/gu, (_, index) => tokens[Number(index)] || "");
}
export { renderAnswerBody, userFacingAnswer };
