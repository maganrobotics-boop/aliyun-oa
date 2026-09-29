// OA uses the verified local math module and only authenticated image routes.
export function extendOaRenderer(source, mathName) {
  const replace = (oldText, newText) => {
    if (!source.includes(oldText)) throw new Error(`Renderer source changed: ${oldText}`);
    source = source.replaceAll(oldText, newText);
  };
  replace('let answerMathEngine = null;', `import answerMathEngine from '../public/assets/${mathName}';`);
  replace('function renderMarkdown(markdown) {', 'function renderMarkdown(markdown, images = new Map()) {');
  replace("inline(paragraph.join(' '))", "inline(paragraph.join(' '), images)");
  replace('inline(x)', 'inline(x, images)');
  replace('inline(heading[2])', 'inline(heading[2], images)');
  replace('function renderAnswerBody(answer) {', 'function renderAnswerBody(answer, assets = []) {');
  replace('const html = renderMarkdown(answer);', 'const html = renderMarkdown(answer, knowledgeImageMap(assets));');
  replace('function inline(text) {', 'function inline(text, images = new Map()) {');
  replace('    // Only HTTP(S) links;', `    if (text.startsWith('![', index)) {
      const image = text.slice(index).match(/^!\\[([^\\]\\n]*)\\]\\((?:<([^>\\n]+)>|([^\\s)]+))(?:\\s+"[^"\\n]*")?\\)/u);
      if (image) {
        const imagePath = normalizeImagePath(image[2] || image[3]);
        const url = images.get(imagePath);
        const token = '\\uE000C' + tokens.length + '\\uE001';
        tokens.push(url ? '<img class="oa-knowledge-image" src="' + escapeHtml(url) + '" alt="' + escapeHtml(image[1]) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '<span class="oa-image-unavailable">图片未加载：' + escapeHtml(image[1] || imagePath) + '</span>');
        protectedText += token; index += image[0].length; continue;
      }
    }
    // Only HTTP(S) links;`);
  return source + String.raw`
function normalizeImagePath(value) {
  try {
    const decoded = decodeURIComponent(String(value || '')).replace(/^\.\//u, '');
    if (!decoded || /[\\\u0000-\u001f]/u.test(decoded) || decoded.split('/').some(x => x === '..' || x === '.')) return '';
    return decoded;
  } catch { return ''; }
}
function knowledgeImageMap(assets) {
  const result = new Map();
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset || typeof asset.url !== 'string') continue;
    const path = normalizeImagePath(asset.path);
    const url = asset.url;
    if (!path.startsWith('assets/') || !/\.(?:png|jpe?g|webp)$/iu.test(path)) continue;
    if (!/^\/api\/knowledge\/[^/?#]+\/assets\/[^?#]+(?:\?[^#]*)?$/u.test(url)) continue;
    if (!normalizeImagePath(url.split('?')[0]) || /["<>\\]/u.test(url)) continue;
    result.set(path, url);
  }
  return result;
}
`;
}
