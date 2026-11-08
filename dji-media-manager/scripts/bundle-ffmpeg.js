import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('ffmpeg-static/package.json'));
const targetDir = path.join(__dirname, '..', 'resources', 'ffmpeg');
const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const target = path.join(targetDir, executableName);

const candidates = [
  path.join(root, executableName),
  path.join(root, process.platform, process.arch, executableName),
];

fs.mkdirSync(targetDir, { recursive: true });
let found;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    found = candidate;
    break;
  }
}
if (!found) {
  console.error('未找到对应平台的 ffmpeg 二进制。请在对应系统上重新 npm install，或设置 FFMPEG_BINARIES_URL 镜像后重试。');
  process.exit(1);
}

fs.copyFileSync(found, target);
fs.chmodSync(target, 0o755);

// Bundle license docs.
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(targetDir, 'ffmpeg-static-LICENSE'));

const readmeSource = path.join(__dirname, 'bundle-readme.md');
const readmeTarget = path.join(targetDir, 'README.md');
fs.copyFileSync(readmeSource, readmeTarget);

console.log(`Bundled ffmpeg: ${found} -> ${target}`);
