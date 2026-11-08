import path from 'node:path';
import { spawn } from 'node:child_process';

const commandPaths = new Map([
  ['darwin', '/usr/bin/sips'],
  ['win32', null]
]);

export function bundledImageCommand() {
  return commandPaths.get(process.platform) || null;
}

export function generateImageThumbnail(inputPath, outputPath, width, quality) {
  const command = bundledImageCommand();
  if (!command) return Promise.reject(new Error('当前平台不支持内置图片缩略图命令'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(quality),
      '-Z', String(width),
      inputPath,
      '--out', outputPath
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `sips 退出码 ${code}`)));
  });
}
