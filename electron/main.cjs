const { app, BrowserWindow, ipcMain, systemPreferences, session, desktopCapturer } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 520,
    title: 'SideBro AI — Desktop Capture Agent',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Load either the Vite dev server or the built client served by the backend over http
  // (IPv4 127.0.0.1 avoids macOS IPv6 ::1 ECONNREFUSED). Loading via file:// is avoided because
  // every relative /api request would fail there.
  const devUrl = 'http://127.0.0.1:5173/?mode=desktop';
  const serverUrl = `http://127.0.0.1:${process.env.PORT || 3001}/?mode=desktop`;

  // Forward renderer console logs to terminal for easy debugging
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelStr = ['DEBUG', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[Electron Renderer][${levelStr}] ${message} (${sourceId}:${line})`);
  });

  // Try the dev server first, then the backend-served build; keep retrying while either starts up.
  const candidates = [devUrl, serverUrl];
  let attempt = 0;
  const loadNext = () => {
    if (!mainWindow) return;
    const url = candidates[attempt % candidates.length];
    attempt++;
    mainWindow.loadURL(url).catch(err => {
      console.warn(`[Electron] Could not load ${url}: ${err.message}`);
      setTimeout(loadNext, attempt < candidates.length ? 0 : 2000);
    });
  };
  loadNext();

  // Allow F12 or Cmd+Option+I to toggle DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}


app.whenReady().then(async () => {
  // Explicitly allow microphone and screen media permissions for the web renderer
  if (session && session.defaultSession) {
    // Only grant permissions to the app's own pages (dev server or local backend), never to other origins.
    const isAppOrigin = (origin) => {
      try {
        const { hostname, port } = new URL(origin);
        return (hostname === '127.0.0.1' || hostname === 'localhost') &&
          (port === '5173' || port === String(process.env.PORT || 3001));
      } catch {
        return false;
      }
    };

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'mediaKeySystem', 'screen', 'clipboard-sanitized-write'];
      callback(isAppOrigin(webContents.getURL()) && allowed.includes(permission));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      return isAppOrigin(requestingOrigin) && ['media', 'mediaKeySystem', 'screen', 'clipboard-sanitized-write'].includes(permission);
    });

    // Support getDisplayMedia for system audio loopback capture on macOS / Windows
    if (session.defaultSession.setDisplayMediaRequestHandler) {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0], audio: 'loopback' });
          } else {
            callback({});
          }
        }).catch(() => callback({}));
      });
    }
  }

  // Request microphone permission on macOS
  if (process.platform === 'darwin') {
    try {
      const micStatus = await systemPreferences.askForMediaAccess('microphone');
      console.log('[Electron] Microphone access granted:', micStatus);
    } catch (e) {
      console.warn('[Electron] Could not check media access:', e);
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
