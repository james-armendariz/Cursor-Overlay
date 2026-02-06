# Cursor Overlay

Cursor Overlay is a minimal Electron app that draws a fully customizable cursor ring and click effects on top of all your monitors. It is designed for screen recording, teaching, streaming, and presentations where you want viewers to clearly see your mouse position and clicks.

## Features

- Global overlay across **all displays**.
- Smooth ring that follows the cursor with optional trail.
- Distinct **left/right click** visuals with different colors and animations.
- Multiple effect styles: ring, ripple, and burst.
- **Presets** to save and load your favorite configurations.
- Option to **launch on Windows startup**.
- Runs from the system tray and can be toggled with `Alt+Shift+O`.

## Project structure

- `main.js` – Electron main process (creates overlay windows, control panel, tray, IPC).
- `control.html` – Control panel UI for toggling the overlay and adjusting settings.
- `overlay.html` – Fullscreen transparent canvas used to render the cursor ring and click effects.
- `package.json` – Dependencies and build scripts.
- `.gitignore` – Excludes build outputs, installers, and other generated artifacts from the repo.
- `cleanup.ps1` – Optional script that was used to clean build artifacts for store submissions (not required for running from source).
- `icon.ico`, `tray-icon.png` – Application and tray icons.

All Electron runtime binaries, installer `.exe`s, `dist/`, `resources/`, `locales/`, and `node_modules/` have been removed so this folder only contains the source needed to build and run the app.

## Getting started (development)

1. Install Node.js (LTS recommended).
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the app in development:

   ```bash
   npm start
   ```

4. Use the control window to start/stop the overlay and tweak visuals.  
   - Global shortcut: `Alt+Shift+O` to toggle the overlay.  
   - Right-click the tray icon to quit the app.

## Building (optional)

If you ever want to rebuild installers locally (not required for open-source use):

```bash
npm run build # Standard Windows installer via electron-builder
npm run build:msix # MSIX package
```

The generated artifacts will be ignored by Git thanks to `.gitignore`.

## License

Released under the **MIT License** (see `package.json` for author information).

