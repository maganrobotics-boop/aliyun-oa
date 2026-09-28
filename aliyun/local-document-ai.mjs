/** Aliyun-only, local document conversion. No external requests or persistent uploads. */
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_INPUT = 10 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_OUTPUT = 5 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FORMATS = new Map([
  ['application/pdf', 'pdf'], [DOCX, 'docx'],
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
]);
const gateKey = Symbol.for('originmind.aliyun.document-parser');
const gate = globalThis[gateKey] ||= { running: 0, context: new AsyncLocalStorage() };
const NOTICE = 'PDF 仅读取文字层；DOCX 读取正文和表格，图片、公式、页眉页脚等不作识别；图片仅识别中英文文字。扫描 PDF 请先转成图片。';
let capabilitiesCache;
let capabilitiesPending;

function failure(name) { const error = new Error('Local document conversion failed'); error.name = name; return error; }

function publicFailure(error, mime = '') {
  if (error?.name === 'LocalDocumentExtractionError') return error;
  const cases = {
    RateLimitedError: [429, '当前有文件正在解析，请稍后重试；原文件未归档。'],
    MaxFileSizeError: [413, '文件或解析正文超出限制，请拆分后重试；系统未截断内容。'],
    TimeoutError: [503, '文件解析超时，请拆分文件后重试；原文件未归档。'],
    ServiceUnavailableError: [503, '当前文件类型的本地解析组件不可用，请稍后重试。'],
    BadRequestError: [422, mime === 'application/pdf' ? 'PDF 未能提取有效文字，请确认文件未加密且完整；扫描 PDF 请先转成图片上传。' : '未识别到足够内容，请确认文件完整、图片清晰；也可改传 TXT 或 MD。'],
  };
  const [status, publicMessage] = cases[error?.name] || [503, '本地文件解析暂不可用，请稍后重试；原文件未归档。'];
  const result = new Error(publicMessage);
  result.name = 'LocalDocumentExtractionError'; result.status = status; result.publicMessage = publicMessage;
  return result;
}

async function withExtractionSlot(callback) {
  if (gate.context.getStore()) return callback();
  if (gate.running >= 1) throw publicFailure(failure('RateLimitedError'));
  gate.running++;
  try { return await gate.context.run(true, callback); }
  finally { gate.running--; }
}

/** The route validates DOCX first. These independent limits also protect direct callers. */
const DOCX_SCRIPT = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with zipfile.ZipFile(sys.argv[1]) as z:
    items = z.infolist()
    if len(items) > 1200 or sum(i.file_size for i in items) > 40 * 1024 * 1024:
        raise ValueError('archive limit')
    info = z.getinfo('word/document.xml')
    if info.file_size > 10 * 1024 * 1024:
        raise ValueError('document limit')
    raw = z.read(info)
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('external entity')
    root = ET.fromstring(raw)
    body = root.find(W + 'body')
    if body is None:
        raise ValueError('document body missing')
    # Preserve body paragraphs and table rows in document order. Drawings, equations,
    # headers/footers and embedded objects are deliberately not interpreted.
    def prose(node):
        out = []
        for part in node.iter():
            if part.tag == W + 't': out.append(part.text or '')
            elif part.tag == W + 'tab': out.append('\t')
            elif part.tag in (W + 'br', W + 'cr'): out.append('\n')
        return ''.join(out)
    for node in body:
        if node.tag == W + 'p':
            print(prose(node))
        elif node.tag == W + 'tbl':
            for row in node.findall(W + 'tr'):
                print('\t'.join(' / '.join(prose(p) for p in cell.findall(W + 'p')) for cell in row.findall(W + 'tc')))
            print()
`;

/** Native parsers are isolated child processes; never invoke a shell. */
function runParser(command, args, directory, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = []; let outputBytes = 0, errorBytes = 0, terminalError;
    const child = spawn('/usr/bin/prlimit', [
      '--as=402653184', '--cpu=30', '--nofile=64', '--fsize=16777216', '--', command, ...args,
    ], {
      cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: directory, OMP_THREAD_LIMIT: '1' },
    });
    const stop = name => {
      terminalError ||= failure(name);
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => stop('TimeoutError'), timeoutMs);
    child.once('error', () => { terminalError ||= failure('ServiceUnavailableError'); });
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) stop('MaxFileSizeError');
      else if (!terminalError) chunks.push(chunk);
    });
    // Do not return native parser diagnostics: they may contain document text/paths.
    child.stderr.on('data', chunk => {
      errorBytes += chunk.length;
      if (errorBytes > 8192) stop('BadRequestError');
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (terminalError) reject(terminalError);
      else if (code !== 0) reject(failure(code === 126 || code === 127 ? 'ServiceUnavailableError' : 'BadRequestError'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/** Compatibility binding consumed by the existing authenticated extraction route. */
async function convert({ blob } = {}) {
    const mime = String(blob?.type || '').split(';')[0].toLowerCase();
    const extension = FORMATS.get(mime);
    if (!extension || !Number.isSafeInteger(blob?.size) || blob.size < 1) throw failure('BadRequestError');
    if (blob.size > (mime.startsWith('image/') ? MAX_IMAGE : MAX_INPUT)) throw failure('MaxFileSizeError');
    let directory;
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), 'originmind-extract-'));
      await chmod(directory, 0o700);
      const input = path.join(directory, `input.${extension}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== blob.size) throw failure('BadRequestError');
      await writeFile(input, bytes, { mode: 0o600, flag: 'wx' });
      let text;
      if (mime === 'application/pdf') {
        // Text-layer PDFs only. Scanned PDFs produce an explicit empty-result error.
        text = await runParser('/usr/bin/pdftotext', ['-layout', '-enc', 'UTF-8', input, '-'], directory);
      } else if (mime === DOCX) {
        text = await runParser('/usr/bin/python3', ['-I', '-c', DOCX_SCRIPT, input], directory);
      } else {
        const languages = await runParser('/usr/bin/tesseract', ['--list-langs'], directory, 5_000);
        const available = new Set(languages.split(/\r?\n/u).map(value => value.trim()));
        if (!available.has('chi_sim') || !available.has('eng')) throw failure('ServiceUnavailableError');
        text = await runParser('/usr/bin/tesseract', [input, 'stdout', '-l', 'chi_sim+eng'], directory);
      }
      const normalized = text.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();
      if (normalized.length < 10) throw failure('BadRequestError');
      if (Buffer.byteLength(normalized, 'utf8') > MAX_OUTPUT) throw failure('MaxFileSizeError');
      return { format: 'text', data: normalized };
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}

async function inspectCapabilities() {
  const executable = async name => { try { await access(`/usr/bin/${name}`, constants.X_OK); return true; } catch { return false; } };
  const formats = [];
  let directory;
  if (await executable('prlimit')) {
    if (await executable('pdftotext')) formats.push('pdf');
    if (await executable('python3')) formats.push('docx');
    if (await executable('tesseract')) {
      try {
        directory = await mkdtemp(path.join(os.tmpdir(), 'originmind-parser-check-'));
        await chmod(directory, 0o700);
        const languages = await runParser('/usr/bin/tesseract', ['--list-langs'], directory, 5_000);
        const available = new Set(languages.split(/\r?\n/u).map(value => value.trim()));
        if (available.has('chi_sim') && available.has('eng')) formats.push('png', 'jpg', 'jpeg', 'webp');
      } catch { /* Missing OCR dependencies never disable the independent document parsers. */ }
      finally { if (directory) await rm(directory, { recursive: true, force: true }); }
    }
  }
  const value = { binaryExtractionAvailable: formats.length > 0, formats, pdfScansSupported: false, notice: NOTICE };
  capabilitiesCache = { value, expires: Date.now() + 60_000 };
  return value;
}

async function getDocumentCapabilities() {
  if (capabilitiesCache && capabilitiesCache.expires > Date.now()) return capabilitiesCache.value;
  if (capabilitiesPending) return capabilitiesPending;
  capabilitiesPending = inspectCapabilities();
  try { return await capabilitiesPending; }
  finally { capabilitiesPending = undefined; }
}

export const localDocumentAi = Object.freeze({
  withExtractionSlot,
  getDocumentCapabilities,
  /** Local route uses this method so truthful status/message survive shared CF error mapping. */
  async extractValidatedDocument(upload, bytes) {
    try {
      const result = await withExtractionSlot(() => convert({ blob: new Blob([bytes], { type: upload.mimeType }) }));
      return { text: result.data, tokens: null, notice: NOTICE };
    } catch (error) { throw publicFailure(error, upload.mimeType); }
  },
  /** Keep the familiar binding available for any existing shared consumers. */
  async toMarkdown(input) {
    try { return await withExtractionSlot(() => convert(input)); }
    catch (error) {
      if (error?.name === 'LocalDocumentExtractionError' && error.status === 429) throw failure('RateLimitedError');
      throw error;
    }
  },
});
