const { ipcMain, desktopCapturer, nativeImage, app, net } = require('electron');
const Tesseract = require('tesseract.js');
const { getMainWindow, createIslandWindow, closeIslandWindow, closeSnipperWindow } = require('./window-manager');
const { startTranscription, stopTranscription, sendAudioChunk, testConnection } = require('./transcription');
const kdeManager = require('./kde-manager');

let handlersRegistered = false;

function safeSendToWindow(win, channel, ...args) {
    try {
        if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send(channel, ...args);
        }
    } catch (err) {
        console.error(`[IPC] Failed to send "${channel}":`, err.message);
    }
}

function registerIpcHandlers() {
    if (handlersRegistered) return;
    handlersRegistered = true;

    ipcMain.handle('get-desktop-source-id', async () => {
        try {
            const sources = await desktopCapturer.getSources({ 
                types: ['screen'],
                thumbnailSize: { width: 0, height: 0 }
            });
            return sources.length > 0 ? sources[0].id : null;
        } catch (err) {
            console.error('[IPC] Desktop source error:', err);
            return null;
        }
    });

    ipcMain.handle('test-assembly-key', async (event, apiKey) => {
        try {
            return await testConnection(apiKey);
        } catch (err) {
            console.error('[IPC] Assembly key test error:', err);
            return { success: false, error: err.message || 'Unknown error' };
        }
    });

    ipcMain.handle('is-native-linux-audio', () => {
        // Use native pipewire record on KDE/Linux instead of Chromium WebRTC
        return kdeManager.isKdePlasma();
    });

    ipcMain.handle('start-transcription', async (event, apiKeyFromRenderer) => {
        try {
            const apiKey = apiKeyFromRenderer || process.env.ASSEMBLY_AI_API_KEY || process.env.ASSEMBLY_API;
            if (!apiKey) return false;
            return startTranscription(apiKey);
        } catch (err) {
            console.error('[IPC] Start transcription error:', err);
            return false;
        }
    });

    ipcMain.on('stop-transcription', () => {
        try { stopTranscription(); } catch (err) {
            console.error('[IPC] Stop transcription error:', err);
        }
    });

    ipcMain.on('send-audio-chunk', (event, chunk) => {
        try { sendAudioChunk(chunk); } catch (err) {
            // Intentionally silent — audio chunks are high-frequency fire-and-forget
        }
    });

    ipcMain.on('snip-crop', async (event, data) => {
        try {
            closeSnipperWindow();

            if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') {
                console.error('[IPC] Invalid snip-crop data');
                return;
            }

            const { x, y, width, height, source } = data;

            if (!source) {
                console.error('[IPC] No screen source in snip-crop');
                return;
            }

            const img = nativeImage.createFromDataURL(source);
            const cropped = img.crop({ 
                x: Math.floor(x), y: Math.floor(y), 
                width: Math.floor(width), height: Math.floor(height) 
            });
            
            Tesseract.recognize(cropped.toPNG(), 'eng')
                .then(({ data: { text } }) => {
                    const mainWindow = getMainWindow();
                    if (text.trim()) {
                        safeSendToWindow(mainWindow, 'ocr-result', text.trim());
                    }
                })
                .catch((err) => console.error('[IPC] Tesseract OCR error:', err));
        } catch (err) {
            console.error('[IPC] snip-crop error:', err);
        }
    });

    ipcMain.on('cancel-snip', () => {
        try { closeSnipperWindow(); } catch (err) {
            console.error('[IPC] cancel-snip error:', err);
        }
    });

    ipcMain.on('set-app-mode', (event, mode) => {
        try {
            const mainWindow = getMainWindow();
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (mode === 'normal') {
                mainWindow.setSkipTaskbar(false);
                mainWindow.setAlwaysOnTop(false);
                mainWindow.setResizable(true);
                mainWindow.setContentProtection(false);
                kdeManager.setKdeStealth(false);
            } else {
                mainWindow.setSkipTaskbar(true);
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                mainWindow.setResizable(false);
                mainWindow.setContentProtection(true);
                kdeManager.setKdeStealth(true);
            }
        } catch (err) {
            console.error('[IPC] set-app-mode error:', err);
        }
    });

    ipcMain.handle('ollama-call', async (event, payload) => {
        try {
            if (!payload || !payload.url) return { error: true, message: 'No URL provided' };
            
            const { url, options } = payload;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);

            try {
                const fetchOptions = { ...options, signal: controller.signal };
                const response = await net.fetch(url, fetchOptions);
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const text = await response.text().catch(() => 'Unable to read response body');
                    return { error: true, status: response.status, message: text };
                }
                const data = await response.json();
                return data;
            } catch (fetchErr) {
                clearTimeout(timeoutId);
                if (fetchErr.name === 'AbortError') {
                    return { error: true, message: 'Request timed out (120s). Check your AI server.' };
                }
                throw fetchErr;
            }
        } catch (error) {
            console.error('[IPC] Ollama call error:', error.message);
            return { error: true, message: error.message || 'Unknown network error' };
        }
    });

    ipcMain.on('minimize-app', () => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
        } catch (err) {
            console.error('[IPC] minimize error:', err);
        }
    });

    ipcMain.on('close-app', () => {
        try { app.quit(); } catch (err) {
            console.error('[IPC] close-app error:', err);
            process.exit(0);
        }
    });

    ipcMain.on('restart-app', () => {
        try {
            app.relaunch();
            app.exit(0);
        } catch (err) {
            console.error('[IPC] restart error:', err);
        }
    });

    ipcMain.on('open-island-window', () => {
        try {
            const p = require('path');
            createIslandWindow(p.join(__dirname, 'preload.js'));
        } catch (err) {
            console.error('[IPC] open-island error:', err);
        }
    });
    
    ipcMain.on('close-island-window', () => {
        try { closeIslandWindow(); } catch (err) {
            console.error('[IPC] close-island error:', err);
        }
    });

    ipcMain.on('send-ai-to-island', (event, text) => {
        try {
            const { getIslandWindow } = require('./window-manager');
            const islandWindow = getIslandWindow();
            safeSendToWindow(islandWindow, 'ai-response', text);
        } catch (err) {
            console.error('[IPC] send-ai-to-island error:', err);
        }
    });
}

module.exports = { registerIpcHandlers };
