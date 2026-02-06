// main.js - Electron Main Process
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindows = []; // Changed: Array to hold multiple overlay windows
let controlWindow = null;
let tray = null;

// Settings storage
const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');

// Load settings from file or return defaults
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      
      // Ensure presets property exists
      if (!settings.presets) {
        settings.presets = {};
      }
      
      return settings;
    }
  } catch (err) {
    // Error loading settings - use defaults
  }
  
  // Default settings
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

// Save settings to file
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    // Error saving settings - silently fail
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

// Send overlay status to control window
ipcMain.on('overlay-status', (event, status) => {
  if (controlWindow) {
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