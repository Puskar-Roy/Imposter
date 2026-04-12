const { globalShortcut, app, screen, desktopCapturer } = require('electron');
const { getMainWindow, createSnipperWindow, getIslandWindow, getSnipperWindow } = require('./window-manager');
const path = require('path');

function safeRegister(accelerator, callback) {
    try {
        globalShortcut.register(accelerator, callback);
    } catch (err) {
        console.error(`[SHORTCUT] Error: ${accelerator}`, err.message);
    }
}

function safeSend(channel, ...args) {
    try {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, ...args);
        }
    } catch (err) {
        console.error(`[IPC] Send Error: ${channel}`, err.message);
    }
}

let isAppHidden = false;

function toggleVisibility() {
    isAppHidden = !isAppHidden;
    const mainWin = getMainWindow();
    const islandWin = getIslandWindow();
    const snipperWin = getSnipperWindow();

    const windows = [mainWin, islandWin, snipperWin];

    windows.forEach(win => {
        if (win && !win.isDestroyed()) {
            if (isAppHidden) {
                win.hide();
            } else {
                win.show();
                if (win === mainWin) win.focus();
            }
        }
    });
}

function registerShortcuts() {
    safeRegister('CommandOrControl+Shift+Q', () => toggleVisibility());

    const moveAmount = 15;
    const move = (dx, dy) => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        const b = win.getBounds();
        win.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
    };

    safeRegister('CommandOrControl+Up', () => move(0, -moveAmount));
    safeRegister('CommandOrControl+Down', () => move(0, moveAmount));
    safeRegister('CommandOrControl+Left', () => move(-moveAmount, 0));
    safeRegister('CommandOrControl+Right', () => move(moveAmount, 0));

    const resizeAmount = 50;
    safeRegister('CommandOrControl+=', () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        const b = win.getBounds();
        win.setBounds({ x: b.x, y: b.y, width: b.width + resizeAmount, height: b.height + resizeAmount });
    });

    safeRegister('CommandOrControl+-', () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        const b = win.getBounds();
        win.setBounds({ x: b.x, y: b.y, width: Math.max(200, b.width - resizeAmount), height: Math.max(150, b.height - resizeAmount) });
    });

    safeRegister('CommandOrControl+Shift+Up', () => safeSend('scroll', -1));
    safeRegister('CommandOrControl+Shift+Down', () => safeSend('scroll', 1));
    safeRegister('CommandOrControl+Shift+I', () => safeSend('focus-input'));
    safeRegister('CommandOrControl+Shift+B', () => safeSend('toggle-auto-reply'));
    safeRegister('CommandOrControl+Shift+Enter', () => safeSend('trigger-search'));
    safeRegister('F10', () => safeSend('trigger-ai-search'));

    safeRegister('CommandOrControl+Shift+S', async () => {
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.bounds;
            await new Promise(r => setTimeout(r, 100));

            const sources = await desktopCapturer.getSources({ 
                types: ['screen'], 
                thumbnailSize: { width: Math.max(width, 1920), height: Math.max(height, 1080) } 
            });
            
            if (sources && sources.length > 0) {
                const screenSource = sources[0].thumbnail.toDataURL();
                createSnipperWindow(path.join(__dirname, 'preload_snipper.js'), screenSource);
            }
        } catch (err) {
            console.error('[SHORTCUT] Snipping error:', err);
        }
    });

    safeRegister('CommandOrControl+Shift+D', () => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.toggleDevTools();
    });
}

function unregisterShortcuts() {
    try {
        globalShortcut.unregisterAll();
    } catch (err) { }
}

module.exports = { registerShortcuts, unregisterShortcuts };
