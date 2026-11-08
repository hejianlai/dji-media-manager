import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;

const serverEntry = path.join(__dirname, '..', 'server.js');
const publicDir = path.join(__dirname, '..', 'public');

async function waitUntilHealthy(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error(`本地服务启动超时：${url}`);
}

function startServer() {
  const cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(path.join(cacheDir, 'thumbnails'), { recursive: true });

  const executable = process.execPath;
  const args = isDev
    ? [serverEntry]
    : [path.join(process.resourcesPath, 'app.asar', 'desktop', 'server-entry.cjs')];

  // In packaged mode, Electron binary runs the bundled CJS loader directly.
  serverProcess = spawn(executable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: '0',
      HOST: '127.0.0.1',
      DJI_MEDIA_MANAGER_CACHE: cacheDir,
      DJI_MEDIA_MANAGER_IPC: '1',
      DJI_MEDIA_MANAGER_BRANDING: isDev
        ? path.join(__dirname, '..', 'resources', 'branding')
        : path.join(process.resourcesPath, 'branding'),
      FFMPEG_PATH: path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    }
  });

  let stdoutBuffer = '';
  serverProcess.stdout?.on('data', chunk => {
    stdoutBuffer += chunk.toString('utf8');
    const match = /LOCAL_SERVER_URL=(\S+)/.exec(stdoutBuffer);
    if (match) {
      serverProcess.__url = match[1];
      stdoutBuffer = '';
      openWindow(match[1]).catch(error => {
        console.error(error);
        app.quit();
      });
    }
  });

  serverProcess.stderr?.on('data', chunk => console.error(chunk.toString('utf8')));
  serverProcess.on('exit', (code, signal) => {
    if (!app.isQuitting) {
      console.error(`服务进程退出：code=${code} signal=${signal}`);
      app.quit();
    }
  });
}

async function openWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    title: 'DJI Media Manager',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: requestedUrl }) => {
    if (requestedUrl.startsWith(`${url}/reward.html`)) {
      openRewardWindow();
      return { action: 'deny' };
    }
    shell.openExternal(requestedUrl);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(url);
  mainWindow.show();
  app.focus({ steal: true });
  console.log('MAIN_WINDOW_SHOWN', mainWindow.isVisible(), JSON.stringify(mainWindow.getBounds()));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let rewardWindow = null;

function openRewardWindow() {
  if (rewardWindow && !rewardWindow.isDestroyed()) {
    rewardWindow.focus();
    return;
  }
  const baseUrl = serverProcess?.__url;
  if (!baseUrl) return;
  rewardWindow = new BrowserWindow({
    width: 760,
    height: 620,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '支持作者',
    backgroundColor: '#f7f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  rewardWindow.loadURL(`${baseUrl}/reward.html`);
  rewardWindow.on('closed', () => { rewardWindow = null; });
}

function setApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        {
          label: 'About DJI Media Manager',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: 'DJI Media Manager',
              detail: [
                `版本：${app.getVersion()}`,
                '微信号：JackHe6',
                '本项目基于 MIT 许可；内置 ffmpeg 遵守其自身开源许可。'
              ].join('\n')
            });
          }
        },
        { type: 'separator' },
        {
          label: '支持作者',
          click: openRewardWindow
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : [])
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setApplicationMenu();
  startServer();
});

app.on('window-all-closed', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
  else if (!mainWindow) app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});
