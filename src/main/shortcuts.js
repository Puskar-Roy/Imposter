const { globalShortcut, app, screen, desktopCapturer } = require('electron');
const { getMainWindow, createSnipperWindow } = require('./window-manager');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const kdeManager = require('./kde-manager');

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

function registerShortcuts() {
    safeRegister('CommandOrControl+Shift+Q', () => app.quit());

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

            let screenSource = null;

            if (kdeManager.isKdePlasma()) {
                // On KDE/Wayland, bypass desktopCapturer and the portal popup by using spectacle
                const tmpPath = '/tmp/imposter_snip.png';
                try {
                    execSync(`spectacle -b -n -o ${tmpPath}`, { stdio: 'ignore' });
                    const imgData = fs.readFileSync(tmpPath);
                    screenSource = `data:image/png;base64,${imgData.toString('base64')}`;
                    // Clean up the temporary file silently
                    fs.unlink(tmpPath, () => {});
                } catch (err) {
                    console.error('[SHORTCUT] Spectacle capture failed, falling back to desktopCapturer:', err.message);
                }
            }

            // Fallback to standard desktopCapturer for Windows/Mac (or if spectacle failed)
            if (!screenSource) {
                const sources = await desktopCapturer.getSources({ 
                    types: ['screen'], 
                    thumbnailSize: { width: Math.max(width, 1920), height: Math.max(height, 1080) } 
                });
                
                if (sources && sources.length > 0) {
                    screenSource = sources[0].thumbnail.toDataURL();
                }
            }

            if (screenSource) {
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
