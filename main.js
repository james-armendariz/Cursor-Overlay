// main.js - Electron Main Process
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindows = []; // Changed: Array to hold multiple overlay windows
let controlWindow = null;
let tray = null;

// Last known overlay runtime state, so newly (re)created overlay windows can be
// restored instead of reverting to defaults/off after a display change.
let overlayState = { isActive: false, clickEffectEnabled: true };

// Global input tracking. A single system-wide mouse hook lives in the main
// process and is broadcast to every overlay window, rather than each window
// installing its own hook.
let uIOhook = null;
let latestCursor = null;          // most recent cursor position, in DIP coordinates
let cursorPollInterval = null;    // fallback poller when the native hook is unavailable
let cursorBroadcastInterval = null;

// Settings storage
const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');

// Default settings
function getDefaultSettings() {
  return {
    clickEffectEnabled: true,
    ringSettings: {
      color: '#3b82f6',
      size: 16,
      thickness: 2,
      opacity: 1,
      filled: false,
      trailEnabled: false,
      trailLength: 5
    },
    clickSettings: {
      leftClick: {
        color: '#a855f7', // Purple for left click
        size: 16,
        thickness: 2,
        opacity: 1,
        speed: 600
      },
      rightClick: {
        color: '#10b981', // Green for right click
        size: 16,
        thickness: 2,
        opacity: 1,
        speed: 600
      },
      effectStyle: 'ring' // Options: 'ring', 'ripple', 'burst'
    },
    presets: {}
  };
}

// Load settings from file, deep-merged onto defaults so every expected key is
// always present - even if the file is partial, from an older version, or was
// hand-edited. This prevents crashes in the settings merge on save.
function loadSettings() {
  const defaults = getDefaultSettings();

  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const loaded = JSON.parse(data) || {};
      const loadedRing = loaded.ringSettings || {};
      const loadedClick = loaded.clickSettings || {};

      return {
        ...defaults,
        ...loaded,
        ringSettings: { ...defaults.ringSettings, ...loadedRing },
        clickSettings: {
          ...defaults.clickSettings,
          ...loadedClick,
          leftClick: { ...defaults.clickSettings.leftClick, ...(loadedClick.leftClick || {}) },
          rightClick: { ...defaults.clickSettings.rightClick, ...(loadedClick.rightClick || {}) }
        },
        presets: loaded.presets || {}
      };
    }
  } catch (err) {
    // Error loading settings - use defaults
  }

  return defaults;
}

// Save settings to file
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    // Error saving settings - silently fail
  }
}

// Send a message to every overlay window that is still alive
function broadcastToOverlays(channel, payload) {
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

// Start the single global mouse hook. Coordinates reported by the native hook
// are in physical pixels; we convert them to DIP (device-independent pixels) so
// they line up with Electron's display bounds on machines that use per-monitor
// DPI scaling. Without this, the ring drifts from the cursor and can land on the
// wrong monitor whenever any display is scaled to something other than 100%.
function startInputTracking() {
  try {
    const uiohook = require('uiohook-napi');
    uIOhook = uiohook.uIOhook;

    uIOhook.on('mousemove', (e) => {
      latestCursor = screen.screenToDipPoint({ x: e.x, y: e.y });
    });

    uIOhook.on('mousedown', (e) => {
      const p = screen.screenToDipPoint({ x: e.x, y: e.y });
      latestCursor = p;
      broadcastToOverlays('global-mousedown', { x: p.x, y: p.y, button: e.button });
    });

    uIOhook.on('mouseup', (e) => {
      const p = screen.screenToDipPoint({ x: e.x, y: e.y });
      latestCursor = p;
      broadcastToOverlays('global-mouseup', { x: p.x, y: p.y, button: e.button });
    });

    uIOhook.start();
  } catch (err) {
    // Native hook unavailable - fall back to polling the cursor position.
    // getCursorScreenPoint already returns DIP coordinates. Click effects are
    // not available in this mode (no button events without the hook).
    uIOhook = null;
    cursorPollInterval = setInterval(() => {
      latestCursor = screen.getCursorScreenPoint();
    }, 8);
  }

  // Broadcast the latest cursor position at ~125Hz. Decoupling the broadcast
  // rate from the raw event rate keeps IPC traffic bounded on high-polling mice.
  cursorBroadcastInterval = setInterval(() => {
    if (latestCursor) {
      broadcastToOverlays('global-mousemove', { x: latestCursor.x, y: latestCursor.y });
    }
  }, 8);
}

// Stop the hook and timers (on quit)
function stopInputTracking() {
  if (cursorBroadcastInterval) {
    clearInterval(cursorBroadcastInterval);
    cursorBroadcastInterval = null;
  }
  if (cursorPollInterval) {
    clearInterval(cursorPollInterval);
    cursorPollInterval = null;
  }
  if (uIOhook) {
    try {
      uIOhook.stop();
    } catch (err) {
      // ignore
    }
    uIOhook = null;
  }
}

// Create transparent overlay windows for all displays
function createOverlayWindows() {
  const displays = screen.getAllDisplays();
  
  // Close existing overlay windows if any
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
  overlayWindows = [];
  
  // Create an overlay window for each display
  displays.forEach((display, index) => {
    const { x, y, width, height } = display.bounds;
    
    const overlayWindow = new BrowserWindow({
      width: width,
      height: height,
      x: x,
      y: y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        additionalArguments: [`--display-bounds=${JSON.stringify(display.bounds)}`],
        offscreen: false,
        hardwareAcceleration: true
      }
    });

    // Make window ignore mouse events but forward them to apps below
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.loadFile('overlay.html');
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Re-apply current settings and active state whenever an overlay window is
    // (re)created - e.g. after a display is added/removed or its resolution or
    // scaling changes - so it never silently reverts to the default ring or off.
    overlayWindow.webContents.on('did-finish-load', () => {
      if (overlayWindow.isDestroyed()) return;
      const settings = loadSettings();
      overlayWindow.webContents.send('update-ring-settings', settings.ringSettings);
      overlayWindow.webContents.send('update-click-settings', settings.clickSettings);
      overlayWindow.webContents.send('set-click-effect', settings.clickEffectEnabled);
      overlayWindow.webContents.send('set-overlay', overlayState.isActive);
    });

    overlayWindows.push(overlayWindow);
  });
}

// Create the control panel window
function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    resizable: true,
    alwaysOnTop: false, // Changed: Allow other windows to cover control panel
    title: 'Cursor Overlay Control',
    show: false,
    titleBarStyle: 'default'
  });

  controlWindow.loadFile('control.html');
  
  // Remove default menu
  controlWindow.setMenu(null);
  
  // Prevent closing, just hide instead
  controlWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      controlWindow.hide();
    }
  });
  
  // Show once ready
  controlWindow.once('ready-to-show', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.show();
    }
  });
}

// Create system tray icon
function createTray() {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Control Panel',
      click: () => {
        if (controlWindow && !controlWindow.isDestroyed()) {
          controlWindow.show();
        }
      }
    },
    {
      label: 'Toggle Overlay',
      click: () => {
        overlayWindows.forEach(win => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('toggle-overlay');
          }
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Cursor Overlay');
  tray.setContextMenu(contextMenu);
  
  // Double-click tray to show control panel
  tray.on('double-click', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.show();
    }
  });
}

// App initialization
app.whenReady().then(() => {
  // Seed runtime state from persisted settings before windows come up
  overlayState.clickEffectEnabled = loadSettings().clickEffectEnabled;

  startInputTracking();   // single global mouse hook for all overlays
  createOverlayWindows(); // Changed: Create overlay for all monitors
  createControlWindow();
  createTray();
  
  // Listen for display changes (monitors added/removed) - MUST be after app.whenReady()
  screen.on('display-added', () => {
    createOverlayWindows();
  });

  screen.on('display-removed', () => {
    createOverlayWindows();
  });

  screen.on('display-metrics-changed', () => {
    createOverlayWindows();
  });
  
  // Register global shortcut for toggling overlay
  globalShortcut.register('Alt+Shift+O', () => {
    overlayWindows.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('toggle-overlay');
      }
    });
  });
});

// Prevent app from quitting when all windows are closed
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Cleanup on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopInputTracking();
});

// ========== IPC Message Handlers ==========

// Toggle overlay on/off
ipcMain.on('toggle-overlay', (event, isActive) => {
  // If isActive is provided, set state; otherwise toggle
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      if (typeof isActive === 'boolean') {
        win.webContents.send('set-overlay', isActive);
      } else {
        win.webContents.send('toggle-overlay');
      }
    }
  });
});

// Toggle click effect on/off
ipcMain.on('toggle-click-effect', (event, enabled) => {
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('set-click-effect', enabled);
    }
  });
});

// Update ring visual settings
ipcMain.on('update-ring-settings', (event, settings) => {
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-ring-settings', settings);
    }
  });
});

// Update click effect visual settings
ipcMain.on('update-click-settings', (event, settings) => {
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-click-settings', settings);
    }
  });
});

// Get current cursor position (synchronous)
ipcMain.on('get-cursor-position', (event) => {
  const point = screen.getCursorScreenPoint();
  event.returnValue = point;
});

// Send overlay status to control window (and remember it so overlay windows
// recreated after a display change can be restored to the same state)
ipcMain.on('overlay-status', (event, status) => {
  overlayState = status;
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('overlay-status', status);
  }
});

// Request settings from file
ipcMain.on('request-settings', (event) => {
  const settings = loadSettings();
  event.reply('load-settings', settings);
});

// Save settings to file
ipcMain.on('save-settings', (event, settings) => {
  const currentSettings = loadSettings();
  
  // Deep merge new settings with existing, preserving presets
  const merged = {
    ...currentSettings,
    ...settings,
    ringSettings: {
      ...currentSettings.ringSettings,
      ...settings.ringSettings
    },
    clickSettings: {
      ...currentSettings.clickSettings,
      ...settings.clickSettings,
      leftClick: {
        ...currentSettings.clickSettings.leftClick,
        ...settings.clickSettings.leftClick
      },
      rightClick: {
        ...currentSettings.clickSettings.rightClick,
        ...settings.clickSettings.rightClick
      }
    },
    presets: currentSettings.presets || {}
  };
  
  saveSettings(merged);
});

// Set launch on startup
ipcMain.on('set-launch-on-startup', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false
  });
});

// Get launch on startup status (synchronous)
ipcMain.on('get-launch-on-startup', (event) => {
  const settings = app.getLoginItemSettings();
  event.returnValue = settings.openAtLogin;
});

// Get all saved presets (synchronous)
ipcMain.on('get-presets', (event) => {
  const settings = loadSettings();
  event.returnValue = settings.presets || {};
});

// Save a new preset
ipcMain.on('save-preset', (event, presetName, presetData) => {
  const settings = loadSettings();
  if (!settings.presets) {
    settings.presets = {};
  }
  
  settings.presets[presetName] = presetData;
  saveSettings(settings);
  
  // Send confirmation back to renderer
  event.reply('preset-saved', Object.keys(settings.presets));
});

// Delete a preset
ipcMain.on('delete-preset', (event, presetName) => {
  const settings = loadSettings();
  if (settings.presets && settings.presets[presetName]) {
    delete settings.presets[presetName];
    saveSettings(settings);
    // Send confirmation back
    event.reply('preset-deleted', Object.keys(settings.presets));
  }
});

// Quit application
ipcMain.on('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});