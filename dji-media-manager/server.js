import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { generateImageThumbnail } from './desktop/image.js';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const THUMB_DIR = process.env.DJI_MEDIA_MANAGER_CACHE
  ? path.join(process.env.DJI_MEDIA_MANAGER_CACHE, 'thumbnails')
  : path.join(__dirname, '.cache', 'thumbnails');
const BRANDING_DIR = process.env.DJI_MEDIA_MANAGER_BRANDING
  ? path.resolve(process.env.DJI_MEDIA_MANAGER_BRANDING)
  : path.join(__dirname, 'resources', 'branding');
let MEDIA_ROOT = process.env.DJI_MEDIA_ROOT ? path.resolve(process.env.DJI_MEDIA_ROOT) : '';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 5178);
const PREVIEW_CHUNK_SIZE = 4 * 1024 * 1024;
const HIDDEN_FILE_PREFIX = '._';
const THUMB_WIDTH = 480;
const THUMB_QUALITY = 4;
const THUMB_CONCURRENCY = 2;
const THUMB_TIMEOUT_MS = 15000;


function isAccessibleDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function discoverMediaRoots() {
  const candidates = [];
  const addDirectoryIfAccessible = value => {
    if (isAccessibleDirectory(value)) candidates.push(path.resolve(value));
  };

  if (process.platform === 'darwin') {
    let volumes = [];
    try {
      volumes = fs.readdirSync('/Volumes', { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => path.join('/Volumes', entry.name));
    } catch {
      volumes = [];
    }

    for (const volume of volumes) {
      const dcim = path.join(volume, 'DCIM');
      if (isAccessibleDirectory(dcim)) {
        try {
          for (const entry of fs.readdirSync(dcim, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              candidates.push(path.join(dcim, entry.name));
            }
          }
        } catch {
          candidates.push(dcim);
        }
        candidates.push(dcim);
      } else {
        candidates.push(volume);
      }
    }
  } else if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (!isAccessibleDirectory(drive)) continue;
      const dcim = path.join(drive, 'DCIM');
      if (isAccessibleDirectory(dcim)) {
        try {
          for (const entry of fs.readdirSync(dcim, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              candidates.push(path.join(dcim, entry.name));
            }
          }
        } catch {
          candidates.push(dcim);
        }
        candidates.push(dcim);
      } else {
        candidates.push(drive);
      }
    }
  } else {
    for (const mediaRoot of ['/media', '/run/media', '/mnt']) {
      addDirectoryIfAccessible(mediaRoot);
    }
  }

  const unique = [...new Set(candidates.map(value => path.resolve(value)))].filter(isAccessibleDirectory);
  const score = value => (value.includes(`${path.sep}DCIM${path.sep}DJI_`) ? 0 : value.includes(`${path.sep}DCIM`) ? 1 : 2);
  return unique.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

if (!MEDIA_ROOT) {
  MEDIA_ROOT = discoverMediaRoots()[0] || os.homedir();
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.dng', 'image/x-adobe-dng'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime']
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function isInsideMediaRoot(target) {
  const relative = path.relative(MEDIA_ROOT, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveMediaPath(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new HttpError(400, '文件名不能为空');
  }
  // basename prevents encoded slashes and nested-path tricks.
  const target = path.resolve(MEDIA_ROOT, path.basename(name));
  if (!isInsideMediaRoot(target)) {
    throw new HttpError(403, '路径超出允许的媒体目录');
  }
  return target;
}

function fileSizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function mediaType(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.dng'].includes(ext)) return 'photo';
  if (['.mp4', '.mov'].includes(ext)) return 'video';
  return 'other';
}

function isPreviewable(name) {
  const ext = path.extname(name).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.mp4', '.mov'].includes(ext);
}


let activeThumbnailJobs = 0;
const thumbnailQueue = [];
const thumbnailJobs = new Map();

let bundledFfmpegPath = '';
async function resolveBundledFfmpeg() {
  if (bundledFfmpegPath) return bundledFfmpegPath;
  if (process.env.FFMPEG_PATH) {
    bundledFfmpegPath = process.env.FFMPEG_PATH;
    return bundledFfmpegPath;
  }
  // Development fallback: ffmpeg-static binary inside node_modules.
  try {
    const module = await import('ffmpeg-static');
    const resolved = module.default || module;
    if (resolved && typeof resolved === 'string') {
      bundledFfmpegPath = resolved;
      return bundledFfmpegPath;
    }
  } catch {}
  // Runtime fallback: system PATH.
  const candidates = process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg'];
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      bundledFfmpegPath = path.resolve(candidate);
      return bundledFfmpegPath;
    } catch {}
  }
  bundledFfmpegPath = '';
  return bundledFfmpegPath;
}

function runThumbnailCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      child.kill('SIGKILL');
      reject(new Error('缩略图生成超时'));
    }, THUMB_TIMEOUT_MS);

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(signal ? `缩略图进程被终止：${signal}` : stderr.trim() || `缩略图进程退出码 ${code}`));
    });
  });
}

async function generateThumbnail(inputPath, outputPath, extension) {
  const tempPath = `${outputPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const ffmpegPath = await resolveBundledFfmpeg();
    if (!ffmpegPath) {
      // Without the packaged ffmpeg binary, macOS can still thumbnail still
      // images using the system-provided sips helper.
      if (['.mp4', '.mov'].includes(extension)) throw new Error('未找到内置 ffmpeg');
      await generateImageThumbnail(inputPath, tempPath, THUMB_WIDTH, 60);
    } else {
      await runThumbnailCommand(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        ...(extension === '.mp4' || extension === '.mov' ? ['-ss', '0.3'] : []),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', `scale=${THUMB_WIDTH}:-2`,
        '-q:v', String(THUMB_QUALITY),
        '-y',
        '-f', 'image2',
        tempPath
      ]);
    }
    await fsp.rename(tempPath, outputPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function requestThumbnail(target, stat) {
  const extension = path.extname(target).toLowerCase();
  const token = `${stat.size}-${stat.mtimeMs}`;
  const hash = crypto.createHash('sha256').update(`${target}\n${token}`).digest('hex').slice(0, 20);
  const outputPath = path.join(THUMB_DIR, `${path.basename(target)}.${hash}.jpg`);
  const existingJob = thumbnailJobs.get(outputPath);
  if (existingJob) return existingJob;

  const job = new Promise((resolve, reject) => {
    const task = async () => {
      try {
        await fsp.access(outputPath).catch(async () => {
          await fsp.mkdir(THUMB_DIR, { recursive: true });
          await generateThumbnail(target, outputPath, extension);
        });
        resolve(outputPath);
      } catch (error) {
        reject(error);
      } finally {
        thumbnailJobs.delete(outputPath);
        activeThumbnailJobs -= 1;
        const next = thumbnailQueue.shift();
        if (next) next();
      }
    };

    if (activeThumbnailJobs < THUMB_CONCURRENCY) {
      activeThumbnailJobs += 1;
      task();
    } else {
      thumbnailQueue.push(task);
    }
  });

  thumbnailJobs.set(outputPath, job);
  return job;
}

async function serveThumbnail(request, res, target) {
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    throw new HttpError(404, '文件不存在');
  }
  if (!stat.isFile()) throw new HttpError(404, '目标不是文件');
  const outputPath = await requestThumbnail(target, stat);
  const body = await fsp.readFile(outputPath);
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': body.length,
    'Cache-Control': 'private, max-age=86400'
  });
  res.end(body);
}

async function listMediaFiles() {
  let entries;
  try {
    entries = await fsp.readdir(MEDIA_ROOT, { withFileTypes: true });
  } catch (error) {
    if (['ENOENT', 'ENOTFOUND', 'EIO'].includes(error.code)) {
      throw new HttpError(503, `无法读取存储卡目录：${MEDIA_ROOT}`);
    }
    if (error.code === 'EACCES') {
      throw new HttpError(403, 'macOS 拒绝访问外置存储卡，请在系统设置中允许当前终端/应用访问可移动卷');
    }
    throw error;
  }

  const files = await Promise.all(
    entries
      .filter(entry => entry.isFile() && !entry.name.startsWith(HIDDEN_FILE_PREFIX))
      .map(async entry => {
        const full = path.join(MEDIA_ROOT, entry.name);
        const stat = await fsp.stat(full);
        return {
          name: entry.name,
          path: full,
          size: stat.size,
          sizeText: fileSizeText(stat.size),
          mtime: stat.mtimeMs,
          type: mediaType(entry.name),
          previewable: isPreviewable(entry.name)
        };
      })
  );
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { root: MEDIA_ROOT, files };
}

function serveMedia(res, request, target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new HttpError(404, '文件不存在');
  }
  if (!stat.isFile()) throw new HttpError(404, '目标不是文件');

  const mime = MIME_TYPES.get(path.extname(target).toLowerCase()) || 'application/octet-stream';
  const rangeHeader = request.headers.range;
  const isVideo = ['.mp4', '.mov'].includes(path.extname(target).toLowerCase());
  let start = 0;
  let end = stat.size - 1;
  let status = 200;

  // Photos must be delivered whole; an image cannot issue follow-up Range
  // requests the way a <video> element can.
  if (isVideo) {
    end = Math.min(end, PREVIEW_CHUNK_SIZE - 1);
    if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    if (match[1] === '') {
      const suffixLength = Number(match[2]);
      start = Math.max(0, stat.size - suffixLength);
      end = stat.size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? stat.size - 1 : Number(match[2]);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1, start + PREVIEW_CHUNK_SIZE - 1);
    status = 206;
    }
  }

  res.writeHead(status, {
    'Content-Type': mime,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {})
  });

  const stream = fs.createReadStream(target, { start, end });
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { error: '读取文件失败' });
    else res.destroy();
  });
  stream.pipe(res);
}

function serveBranding(res, pathname) {
  if (!pathname.startsWith('/branding/')) return false;
  const relative = pathname.slice('/branding/'.length);
  const target = path.resolve(BRANDING_DIR, relative);
  const root = path.resolve(BRANDING_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) throw new HttpError(403, '禁止访问');
  let stat;
  try { stat = fs.statSync(target); } catch { throw new HttpError(404, '资源不存在'); }
  if (!stat.isFile()) throw new HttpError(404, '资源不存在');
  res.writeHead(200, {
    'Content-Type': MIME_TYPES.get(path.extname(target).toLowerCase()) || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

function serveStatic(res, pathname) {
  if (serveBranding(res, pathname)) return;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    throw new HttpError(403, '禁止访问');
  }
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new HttpError(404, '页面不存在');
  }
  if (!stat.isFile()) throw new HttpError(404, '页面不存在');
  res.writeHead(200, {
    'Content-Type': MIME_TYPES.get(path.extname(target).toLowerCase()) || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(target).pipe(res);
}

function shellTrashTarget() {
  return process.platform === 'darwin'
    ? 'osascript'
    : process.platform === 'win32'
      ? 'powershell.exe'
      : 'gio';
}

async function moveToTrash(paths) {
  const trashed = [];
  const failed = [];

  if (process.platform === 'darwin') {
    const uniquePaths = [...new Set(paths.map(value => path.resolve(value)))];
    for (const value of uniquePaths) {
      try {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const script = `tell application "Finder" to delete POSIX file "${escaped}"`;
        await new Promise((resolve, reject) => {
          const child = spawn(shellTrashTarget(), ['-e', script], {
            stdio: ['ignore', 'ignore', 'pipe']
          });
          let stderr = '';
          child.stderr.on('data', chunk => { stderr += chunk; });
          child.on('error', reject);
          child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `osascript 退出码 ${code}`)));
        });
        trashed.push({ path: value, trashed: true });
      } catch (error) {
        failed.push({ path: value, error: error.message });
      }
    }
    return { trashed, failed };
  }

  if (process.platform === 'win32') {
    for (const value of paths) {
      const target = path.resolve(value);
      try {
        const escapedTarget = target.replace(/'/g, "''");
        const command = [
          '$ErrorActionPreference = "Stop"',
          'Add-Type -AssemblyName Microsoft.VisualBasic',
          `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escapedTarget}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
        ].join('; ');
        await new Promise((resolve, reject) => {
          const child = spawn(shellTrashTarget(), [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            command
          ], { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', chunk => { stderr += chunk; });
          child.on('error', reject);
          child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `PowerShell 退出码 ${code}`)));
        });
        trashed.push({ path: target, trashed: true });
      } catch (error) {
        failed.push({ path: target, error: error.message });
      }
    }
    return { trashed, failed };
  }

  for (const value of paths) {
    const target = path.resolve(value);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(shellTrashTarget(), ['trash', target], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `gio 退出码 ${code}`)));
      });
      trashed.push({ path: target, trashed: true });
    } catch (error) {
      failed.push({ path: target, error: error.message });
    }
  }
  return { trashed, failed };
}

async function deleteFiles(payload) {
  const requestedPaths = Array.isArray(payload?.paths) ? payload.paths : [];
  const permanent = payload?.permanent === true;
  if (requestedPaths.length === 0) throw new HttpError(400, '请至少选择一个文件');
  if (requestedPaths.length > 1000) throw new HttpError(413, '单次删除数量过多');

  const validated = [];
  const validationFailures = [];
  const seen = new Set();

  for (const requestedPath of requestedPaths) {
    if (typeof requestedPath !== 'string' || seen.has(requestedPath)) continue;
    seen.add(requestedPath);
    try {
      // The client sends absolute paths from /api/files. Recompute it under the
      // allowed root so a malicious payload cannot target another location.
      const target = resolveMediaPath(path.basename(requestedPath));
      const stat = await fsp.stat(target);
      if (!stat.isFile()) throw new HttpError(400, '只能删除普通文件');
      validated.push(target);
    } catch (error) {
      validationFailures.push({
        name: path.basename(String(requestedPath)),
        error: error.code === 'ENOENT' ? '文件不存在' : error.message
      });
    }
  }

  if (permanent) {
    const deleted = [];
    const failed = [...validationFailures];
    for (const target of validated) {
      try {
        await fsp.unlink(target);
        deleted.push({ name: path.basename(target), path: target, permanent: true });
      } catch (error) {
        failed.push({ name: path.basename(target), error: error.message });
      }
    }
    return { deleted, failed, trashed: [], root: MEDIA_ROOT };
  }

  const trashResult = await moveToTrash(validated);
  const deleted = trashResult.trashed.map(item => ({
    name: path.basename(item.path),
    path: item.path,
    permanent: false
  }));
  return {
    deleted,
    trashed: trashResult.trashed,
    failed: [...validationFailures, ...trashResult.failed],
    root: MEDIA_ROOT
  };
}

async function handleApi(request, res, pathname) {
  try {
    if (pathname === '/api/roots' && request.method === 'GET') {
      sendJson(res, 200, { current: MEDIA_ROOT, roots: discoverMediaRoots() });
      return;
    }
    if (pathname === '/api/root' && request.method === 'POST') {
      const payload = await readJsonBody(request);
      const requested = typeof payload?.path === 'string' ? path.resolve(payload.path.trim()) : '';
      if (!requested || !path.isAbsolute(requested)) throw new HttpError(400, process.platform === 'win32' ? '请输入盘符开头的绝对路径，例如 D:\\DCIM\\DJI_001' : '请输入以 / 开头的绝对路径');
      let stat;
      try {
        stat = await fsp.stat(requested);
      } catch {
        throw new HttpError(404, '路径不存在或无法访问');
      }
      if (!stat.isDirectory()) throw new HttpError(400, '路径必须是目录');
      MEDIA_ROOT = requested;
      sendJson(res, 200, { current: MEDIA_ROOT, roots: discoverMediaRoots() });
      return;
    }
    if (pathname === '/api/files' && request.method === 'GET') {
      sendJson(res, 200, await listMediaFiles());
      return;
    }
    if (pathname.startsWith('/api/thumb/') && request.method === 'GET') {
      const rawName = decodeURIComponent(pathname.slice('/api/thumb/'.length));
      await serveThumbnail(request, res, resolveMediaPath(rawName));
      return;
    }
    if (pathname.startsWith('/api/preview/') && request.method === 'GET') {
      const rawName = decodeURIComponent(pathname.slice('/api/preview/'.length));
      serveMedia(res, request, resolveMediaPath(rawName));
      return;
    }
    if (pathname === '/api/delete' && request.method === 'POST') {
      const payload = await readJsonBody(request);
      sendJson(res, 200, await deleteFiles(payload));
      return;
    }
    throw new HttpError(404, '接口不存在');
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(res, status, { error: error.message || '服务器内部错误' });
  }
}

const server = http.createServer(async (request, res) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (pathname.startsWith('/api/')) {
    await handleApi(request, res, pathname);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(res, 405, { error: '不支持的请求方法' });
    return;
  }
  try {
    serveStatic(res, pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (!res.headersSent) sendJson(res, status, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : PORT;
  const url = `http://${HOST}:${actualPort}`;
  console.log(`DJI 素材管理已启动： ${url}`);
  console.log(`受控目录： ${MEDIA_ROOT}`);
  if (process.env.DJI_MEDIA_MANAGER_IPC === '1') {
    console.log(`LOCAL_SERVER_URL=${url}`);
  }
});
