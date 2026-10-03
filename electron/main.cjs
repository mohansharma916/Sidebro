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

  // Load either Vite dev server (IPv4 127.0.0.1 to avoid macOS IPv6 ::1 ECONNREFUSED) or production build
  const devUrl = 'http://127.0.0.1:5173?mode=desktop';
  const prodPath = path.join(__dirname, '../client/dist/index.html');

  // Forward renderer console logs to terminal for easy debugging
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelStr = ['DEBUG', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[Electron Renderer][${levelStr}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Electron] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    // Fall back to production build if available
    try {
      if (require('fs').existsSync(prodPath)) {
        console.log('[Electron] Falling back to local production build at:', prodPath);
        mainWindow.loadFile(prodPath, { query: { mode: 'desktop' } });
      }
    } catch (e) {
      console.error('[Electron] Fallback error:', e);
    }
  });

  // Attempt loading dev URL
  mainWindow.loadURL(devUrl).catch(() => {
    // If dev server isn't running, try loading local build or retry
    try {
      if (require('fs').existsSync(prodPath)) {
        console.log('[Electron] Vite dev server not ready, loading built bundle:', prodPath);
        mainWindow.loadFile(prodPath, { query: { mode: 'desktop' } });
      } else {
        setTimeout(() => mainWindow.loadURL(devUrl).catch(() => {}), 2000);
      }
    } catch {
      setTimeout(() => mainWindow.loadURL(devUrl).catch(() => {}), 2000);
    }
  });

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
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'mediaKeySystem', 'screen', 'notifications', 'accessibility-events'];
      callback(allowed.includes(permission));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return true;
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
