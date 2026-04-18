const { app, session, BrowserWindow } = require('electron');
const path = require('path');
require('dotenv').config();

const { createMainWindow, getMainWindow } = require('./window-manager');
const { registerShortcuts, unregisterShortcuts } = require('./shortcuts');
const { registerIpcHandlers } = require('./ipc-handlers');
const kdeManager = require('./kde-manager');
// ── Process-Level Crash Guards ──────────────────────────────────────────────

process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught Exception:', error);
    // Don't exit — keep the app alive for non-critical exceptions
});

process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Promise Rejection:', reason);
});

// ── Single Instance Lock ────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            }
        } catch (err) {
            console.error('Second-instance handler error:', err);
        }
    });

    app.commandLine.appendSwitch('disable-gpu-cache');

    app.whenReady().then(async () => {
        try {
            registerIpcHandlers();
            registerShortcuts();

            session.defaultSession.setProxy({
                proxyRules: 'direct://',
                proxyBypassRules: '127.0.0.1,localhost'
            });

            const { desktopCapturer } = require('electron');
            session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
                try {
                    const sources = await desktopCapturer.getSources({ types: ['screen'] });
                    if (sources.length > 0) {
                        callback({ video: sources[0], audio: 'loopback' });
                    } else {
                        callback({});
                    }
                } catch (err) {
                    console.error('Display media handler error:', err);
                    callback({});
                }
            });

            const mainWindow = createMainWindow(path.join(__dirname, 'preload.js'));

            // ── Renderer Crash Recovery ─────────────────────────────────
            mainWindow.webContents.on('render-process-gone', (event, details) => {
                console.error('[CRASH] Renderer process gone:', details.reason, details.exitCode);
                try {
                    if (!mainWindow.isDestroyed()) mainWindow.close();
                } catch (_) { /* window already destroyed */ }
                createMainWindow(path.join(__dirname, 'preload.js'));
            });

            mainWindow.on('unresponsive', () => {
                console.warn('[WARN] Main window became unresponsive');
            });

            mainWindow.on('responsive', () => {
                console.info('[INFO] Main window is responsive again');
            });

            app.on('activate', function () {
                if (BrowserWindow.getAllWindows().length === 0) createMainWindow(path.join(__dirname, 'preload.js'));
            });
        } catch (err) {
            console.error('[FATAL] App initialization failed:', err);
        }
    }).catch((err) => {
        console.error('[FATAL] app.whenReady() rejected:', err);
    });
}

app.on('will-quit', () => {
    try {
        unregisterShortcuts();
        kdeManager.cleanupKdeRules();
    } catch (err) {
        console.error('Cleanup error:', err);
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
