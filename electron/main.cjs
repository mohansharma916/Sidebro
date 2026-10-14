const { app, BrowserWindow, ipcMain, systemPreferences, session, desktopCapturer } = require('electron');
const path = require('path');

let mainWindow = null;
let isFloatingMode = false;
let savedBounds = null;
let isContentProtected = true;

// Only one instance may run: a second copy sharing the same profile directory loads a page that
// never talks to the backend (clicks like "Start SideBro Session" silently do nothing).
// A repeated launch focuses the existing window instead.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  console.log('[Electron] SideBro is already running; focusing the existing window.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // On macOS closing the window keeps the app alive, so a relaunch must reopen it
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 360,
    minHeight: 380,
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

  // Protect window from being captured by Google Meet, Zoom, MS Teams, QuickTime, OBS
  try {
    mainWindow.setContentProtection(true);
    isContentProtected = true;
    console.log('[Electron] Stealth protection active: window is invisible to Google Meet, Zoom, and Teams.');
  } catch (err) {
    console.warn('[Electron] setContentProtection failed:', err);
  }

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

  // Waiting screen HTML shown if the dev/backend servers are not yet running
  const waitingHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>SideBro AI — Connecting...</title>
      <style>
        body {
          margin: 0;
          background: #080b11;
          color: #f3f4f6;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          user-select: none;
          -webkit-app-region: drag;
        }
        .container {
          text-align: center;
          max-width: 440px;
          padding: 32px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          backdrop-filter: blur(12px);
          -webkit-app-region: no-drag;
        }
        .spinner {
          width: 36px;
          height: 36px;
          border: 3px solid rgba(99, 102, 241, 0.2);
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 18px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        h1 { font-size: 18px; margin: 0 0 10px; font-weight: 600; color: #fff; }
        p { font-size: 13px; line-height: 1.5; color: #9ca3af; margin: 0 0 14px; }
        code {
          background: #111827;
          color: #10b981;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 13px;
          font-family: monospace;
          border: 1px solid #1f2937;
          display: inline-block;
          font-weight: 600;
        }
        .status {
          font-size: 11px;
          color: #6b7280;
          margin-top: 16px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="spinner"></div>
        <h1>Connecting to SideBro AI...</h1>
        <p>The desktop app requires the SideBro backend and client dev server to be running.</p>
        <p>In your terminal, start them with:</p>
        <code>npm run dev</code>
        <div class="status">Checking http://127.0.0.1:5173 and http://127.0.0.1:${process.env.PORT || 3001}...</div>
      </div>
    </body>
    </html>
  `)}`;

  // Try the dev server first, then the backend-served build; keep retrying while either starts up.
  const candidates = [devUrl, serverUrl];
  let attempt = 0;
  let shownWaitingScreen = false;
  const loadNext = () => {
    if (!mainWindow) return;
    const url = candidates[attempt % candidates.length];
    attempt++;
    mainWindow.loadURL(url).then(() => {
      console.log(`[Electron] Successfully loaded ${url}`);
    }).catch(err => {
      console.warn(`[Electron] Could not load ${url}: ${err.message}`);
      if (!shownWaitingScreen && mainWindow) {
        shownWaitingScreen = true;
        mainWindow.loadURL(waitingHtml).catch(() => {});
      }
      setTimeout(loadNext, 1500);
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

// Parakeet AI-style Floating Window & Anti-Screen-Share Protection IPC Handlers
ipcMain.handle('toggle-floating-mode', async (event, requestedState) => {
  if (!mainWindow) return { isFloating: false, isProtected: isContentProtected };
  const target = requestedState !== undefined ? Boolean(requestedState) : !isFloatingMode;
  isFloatingMode = target;

  if (isFloatingMode) {
    savedBounds = mainWindow.getBounds();
    const { screen } = require('electron');
    const display = screen.getDisplayMatching(savedBounds) || screen.getPrimaryDisplay();
    const { x, y, width: screenWidth, height: screenHeight } = display.workArea;
    const floatWidth = 440;
    const floatHeight = Math.min(680, screenHeight - 60);
    const posX = x + screenWidth - floatWidth - 24;
    const posY = y + 40;

    mainWindow.setMinimumSize(360, 380);
    mainWindow.setBounds({ x: posX, y: posY, width: floatWidth, height: floatHeight });
    mainWindow.setAlwaysOnTop(true, 'floating', 1);
    if (mainWindow.setVisibleOnAllWorkspaces) {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    mainWindow.setContentProtection(true);
    isContentProtected = true;
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(480, 520);
    if (savedBounds) {
      mainWindow.setBounds(savedBounds);
    } else {
      mainWindow.setBounds({ width: 960, height: 720 });
      mainWindow.center();
    }
  }
  mainWindow.webContents.send('floating-mode-changed', isFloatingMode);
  return { isFloating: isFloatingMode, isProtected: isContentProtected };
});

ipcMain.handle('set-content-protection', async (event, enable) => {
  if (!mainWindow) return false;
  try {
    const val = Boolean(enable);
    mainWindow.setContentProtection(val);
    isContentProtected = val;
    mainWindow.webContents.send('stealth-status-changed', { isProtected: isContentProtected });
    return isContentProtected;
  } catch (err) {
    console.warn('[Electron] Failed to toggle setContentProtection:', err);
    return false;
  }
});

ipcMain.handle('get-stealth-status', async () => {
  return {
    isElectron: true,
    isFloating: isFloatingMode,
    isProtected: isContentProtected,
    isAlwaysOnTop: mainWindow ? mainWindow.isAlwaysOnTop() : false,
  };
});

ipcMain.handle('set-window-opacity', async (event, opacity) => {
  if (!mainWindow) return 1.0;
  const op = Math.max(0.3, Math.min(1.0, Number(opacity) || 1.0));
  mainWindow.setOpacity(op);
  return op;
});


app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
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

  createWindow();

  // Request microphone permission on macOS without blocking the window: awaiting it before
  // createWindow left the app windowless while the system prompt was pending or hidden.
  if (process.platform === 'darwin') {
    console.log('[Electron] Microphone permission status:', systemPreferences.getMediaAccessStatus('microphone'));
    systemPreferences.askForMediaAccess('microphone')
      .then(micStatus => console.log('[Electron] Microphone access granted:', micStatus))
      .catch(e => console.warn('[Electron] Could not check media access:', e));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
