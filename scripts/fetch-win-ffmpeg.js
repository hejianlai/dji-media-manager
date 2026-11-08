import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(__dirname, '..', 'resources', 'ffmpeg');
const target = path.join(targetDir, 'ffmpeg.exe');
const baseUrl = process.env.FFMPEG_BINARIES_URL || 'https://github.com/eugeneware/ffmpeg-static/releases/download';
const releaseTag = process.env.FFMPEG_BINARY_RELEASE || 'b6.0';
const url = `${baseUrl}/${releaseTag}/ffmpeg-win32-x64.gz`;
const gzipPath = `${target}.gz`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

fs.mkdirSync(targetDir, { recursive: true });
try {
  const curlArgs = ['-L', '--fail', '--silent', '--show-error'];
  if (process.env.FFMPEG_NO_PROXY === '1') curlArgs.push('--noproxy', '*');
  curlArgs.push(url, '-o', gzipPath);
  await run('curl', curlArgs);
  await run('gunzip', ['-kf', gzipPath]);
  // gunzip -k keeps .gz; ffmpeg.exe already extracted without suffix.
  fs.rmSync(gzipPath, { force: true });
  fs.chmodSync(target, 0o755);
  fs.copyFileSync(path.join(__dirname, 'bundle-readme.md'), path.join(targetDir, 'README.md'));
  console.log(`Windows ffmpeg ready: ${target}`);
} catch (error) {
  console.error(error.message);
  console.error('可设置镜像：export FFMPEG_BINARIES_URL=https://npmmirror.com/mirrors/ffmpeg-static');
  process.exit(1);
}
