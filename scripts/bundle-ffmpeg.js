import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('ffmpeg-static/package.json'));
const targetDir = path.join(__dirname, '..', 'resources', 'ffmpeg');
const baseUrl = process.env.FFMPEG_BINARIES_URL || 'https://npmmirror.com/mirrors/ffmpeg-static/';
const releaseTag = process.env.FFMPEG_BINARY_RELEASE || 'b6.0';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function ensureMacBinary(arch) {
  const destDir = path.join(targetDir, arch);
  const dest = path.join(destDir, 'ffmpeg');
  if (fs.existsSync(dest)) return dest;

  // Prefer the platform binary npm installed for the current arch.
  if (process.platform === 'darwin' && process.arch === arch) {
    const from = path.join(root, 'ffmpeg');
    if (fs.existsSync(from)) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(from, dest);
      fs.chmodSync(dest, 0o755);
      return dest;
    }
  }

  const gz = `${dest}.gz`;
  const url = `${baseUrl.replace(/\/$/, '')}/${releaseTag}/ffmpeg-darwin-${arch}.gz`;
  const curlArgs = ['-L', '--fail', '--silent', '--show-error'];
  if (process.env.FFMPEG_NO_PROXY === '1') curlArgs.push('--noproxy', '*');
  curlArgs.push(url, '-o', gz);
  fs.mkdirSync(destDir, { recursive: true });
  await run('curl', curlArgs);
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(gz);
    const output = fs.createWriteStream(dest);
    input.pipe(zlib.createGunzip()).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
  fs.rmSync(gz, { force: true });
  fs.chmodSync(dest, 0o755);
  return dest;
}

// Current platform convenience binary for local dev (linux/win handled by ffmpeg-static).
const platformBinary = path.join(root, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

try {
  if (process.platform === 'darwin') {
    await ensureMacBinary('arm64');
    await ensureMacBinary('x64');
  } else if (fs.existsSync(platformBinary)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(platformBinary, path.join(targetDir, path.basename(platformBinary)));
    fs.chmodSync(path.join(targetDir, path.basename(platformBinary)), 0o755);
  }

  const lic = path.join(root, 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(targetDir, 'ffmpeg-static-LICENSE'));
  const readmeSource = path.join(__dirname, 'bundle-readme.md');
  if (fs.existsSync(readmeSource)) fs.copyFileSync(readmeSource, path.join(targetDir, 'README.md'));
  console.log('ffmpeg bundle ready');
} catch (error) {
  console.error(error.message);
  console.error('Set FFMPEG_BINARIES_URL=https://npmmirror.com/mirrors/ffmpeg-static/ and retry.');
  process.exit(1);
}
