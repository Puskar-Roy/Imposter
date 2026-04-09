const { BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;
let islandWindow = null;
let snipperWindow = null;

function isWindowAlive(win) {
    return win && !win.isDestroyed();
}

function safeCloseWindow(win) {
    try {
        if (isWindowAlive(win)) win.close();
    } catch (err) {
        console.error('Safe close error:', err);
    }
    return null;
}

function attachCrashGuards(win, label) {
    if (!win) return;

    win.webContents.on('render-process-gone', (event, details) => {
        console.error(`[CRASH] ${label} renderer gone:`, details.reason, details.exitCode);
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`[LOAD-FAIL] ${label}:`, errorCode, errorDescription);
    });

    win.on('unresponsive', () => {
        console.warn(`[WARN] ${label} became unresponsive`);
    });

    win.on('responsive', () => {
        console.info(`[INFO] ${label} is responsive again`);
    });
}

function createMainWindow(preloadPath) {
    try {
        mainWindow = new BrowserWindow({
            width: 900,
            height: 500,
            transparent: true,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            resizable: true,
            maximizable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath
            }
        });

        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setContentProtection(true);
        mainWindow.setOpacity(0.9);
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

        attachCrashGuards(mainWindow, 'MainWindow');

        mainWindow.on('closed', () => {
            mainWindow = null;
        });

        return mainWindow;
    } catch (err) {
        console.error('[FATAL] Failed to create main window:', err);
        mainWindow = null;
        return null;
    }
}

function createIslandWindow(preloadPath) {
    if (isWindowAlive(islandWindow)) return islandWindow;

    // Clean up stale reference if window was destroyed externally
    islandWindow = null;

    try {
        islandWindow = new BrowserWindow({
            width: 600,
            height: 80,
            x: 0,
            y: 0,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            movable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath
            }
        });

        islandWindow.setAlwaysOnTop(true, 'screen-saver');
        islandWindow.setContentProtection(true);
        islandWindow.loadFile(path.join(__dirname, '../renderer/island.html'));

        attachCrashGuards(islandWindow, 'IslandWindow');

        islandWindow.on('closed', () => {
            islandWindow = null;
        });

        return islandWindow;
    } catch (err) {
        console.error('[ERROR] Failed to create island window:', err);
        islandWindow = null;
        return null;
    }
}

function closeIslandWindow() {
    islandWindow = safeCloseWindow(islandWindow);
}

function createSnipperWindow(preloadPath, screenSource) {
    try {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;

        snipperWindow = new BrowserWindow({
            width, height, x: primaryDisplay.bounds.x, y: primaryDisplay.bounds.y,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            enableLargerThanScreen: true,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true
            }
        });

        snipperWindow.setContentProtection(true);
        snipperWindow.setAlwaysOnTop(true, 'screen-saver');
        snipperWindow.loadFile(path.join(__dirname, '../renderer/snipper.html'));

        attachCrashGuards(snipperWindow, 'SnipperWindow');

        snipperWindow.webContents.on('did-finish-load', () => {
            if (isWindowAlive(snipperWindow)) {
                snipperWindow.webContents.send('load-image', screenSource);
            }
        });

        snipperWindow.on('closed', () => {
            snipperWindow = null;
        });

        return snipperWindow;
    } catch (err) {
        console.error('[ERROR] Failed to create snipper window:', err);
        snipperWindow = null;
        return null;
    }
}

function closeSnipperWindow() {
    snipperWindow = safeCloseWindow(snipperWindow);
}

module.exports = {
    createMainWindow,
    getMainWindow: () => mainWindow,
    createIslandWindow,
    getIslandWindow: () => islandWindow,
    closeIslandWindow,
    createSnipperWindow,
    getSnipperWindow: () => snipperWindow,
    closeSnipperWindow
};
