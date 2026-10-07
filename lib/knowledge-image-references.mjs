// Read image references as data only. Never render HTML or fetch source URLs.
const MARKDOWN_IMAGE = /!\[([^\]\r\n]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu;
const HTML_IMAGE = /<img\b(?:[^<>"']|"[^"']*"|'[^']*')*>/giu;
const HTML_ATTRIBUTE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
const ASSET_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|webp|jpe?g)$/iu;

function decodeEntities(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/giu, (entity, body) => {
    if (body[0] !== "#") return named[body.toLowerCase()] || entity;
    const point = /^#x/iu.test(body) ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : entity;
  });
}

function normalizePath(value) {
  let path;
  try { path = decodeURIComponent(decodeEntities(value).trim()); } catch { return null; }
  path = path.split(/[?#]/u, 1)[0].replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!ASSET_PATH.test(path) || path.includes("//") || path.split("/").some(part => part === "." || part === "..")) return null;
  return path;
}

function proseOnly(value) {
  let fence = null;
  const withoutFences = value.split(/(?<=\n)/u).map(line => {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (fence) {
      if (opening && opening[1][0] === fence.character && opening[1].length >= fence.length &&
          line.slice(opening[0].length).trim() === "") fence = null;
      return line.replace(/[^\r\n]/gu, " ");
    }
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      return line.replace(/[^\r\n]/gu, " ");
    }
    return line;
  }).join("");
  return withoutFences
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, match => " ".repeat(match.length))
    .replace(/<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, match => " ".repeat(match.length))
    .replace(/(`+)([^`]|(?!\1)`)*?\1(?!`)/gu, match => " ".repeat(match.length));
}

/** Ordered references in supported Markdown and Pandoc/Word HTML image syntax. */
function imageCandidates(content) {
  const prose = proseOnly(String(content || ""));
  const candidates = [];
  for (const match of prose.matchAll(MARKDOWN_IMAGE)) {
    candidates.push({ offset: match.index, end: match.index + match[0].length, syntax: 'markdown', path: match[2] || match[3], alt: match[1] });
  }
  for (const match of prose.matchAll(HTML_IMAGE)) {
    if (match[0].length > 16_384) continue;
    const attributes = new Map();
    let duplicate = false;
    for (const attr of match[0].slice(4, -1).matchAll(HTML_ATTRIBUTE)) {
      const key = attr[1].toLowerCase();
      if (key !== "src" && key !== "alt") continue;
      if (attributes.has(key)) { duplicate = true; break; }
      attributes.set(key, attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    if (!duplicate && attributes.has("src")) {
      candidates.push({ offset: match.index, end: match.index + match[0].length, syntax: 'html', path: attributes.get("src"), alt: decodeEntities(attributes.get("alt") || "") });
    }
  }
  return candidates.sort((left, right) => left.offset - right.offset);
}

export function knowledgeImageReferences(content, strict = false) {
  const references = new Map();
  for (const candidate of imageCandidates(content)) {
    const path = normalizePath(candidate.path);
    if (!path && strict) {
      let raw = decodeEntities(candidate.path).trim().replaceAll('\\', '/').replace(/^\.\//u, '');
      try { raw = decodeURIComponent(raw); } catch { /* invalid encoding is rejected for local assets */ }
      if (/^assets\//iu.test(raw)) throw new Error('正文中的图片路径不合法，请使用已上传的 assets/ 图片。');
    }
    if (path && !references.has(path)) references.set(path, candidate.alt);
  }
  return references;
}

/** Update every live reference to one image; examples, paths and surrounding prose stay intact. */
export function updateKnowledgeImageDescription(content, path, description) {
  const label = String(description).replaceAll('[', '［').replaceAll(']', '］').replace(/[\r\n]+/gu, ' ');
  const escaped = label.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  let output = '', cursor = 0;
  for (const candidate of imageCandidates(content)) {
    if (normalizePath(candidate.path) !== path || candidate.offset < cursor) continue;
    const original = content.slice(candidate.offset, candidate.end);
    let replacement;
    if (candidate.syntax === 'markdown') replacement = `![${label}]${original.slice(original.indexOf(']') + 1)}`;
    else {
      const attribute = [...original.slice(4, -1).matchAll(HTML_ATTRIBUTE)].find(match => match[1].toLowerCase() === 'alt');
      replacement = attribute
        ? original.slice(0, 4 + attribute.index) + `alt="${escaped}"` + original.slice(4 + attribute.index + attribute[0].length)
        : original.replace(/\s*\/?>$/u, ending => ` alt="${escaped}"${ending}`);
    }
    output += content.slice(cursor, candidate.offset) + replacement;
    cursor = candidate.end;
  }
  return output + content.slice(cursor);
}
