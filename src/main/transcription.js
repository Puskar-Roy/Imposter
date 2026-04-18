const { WebSocket } = require('ws');
const { getMainWindow, getIslandWindow } = require('./window-manager');
const { spawn, execSync } = require('child_process');
const kdeManager = require('./kde-manager');

let assemblySocket = null;
let isConnecting = false;
let nativeAudioProcess = null;
const SAMPLE_RATE = 16000;

function safeSendStatus(status, error) {
    try {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('transcription-status', status, error);
        }
    } catch (_) { /* window may be destroyed */ }
}

function startTranscription(apiKey) {
    if (isConnecting) return false;

    if (assemblySocket) {
        try { assemblySocket.close(); } catch (_) {}
        assemblySocket = null;
    }

    isConnecting = true;

    try {
        const url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${SAMPLE_RATE}&encoding=pcm_s16le&speech_model=u3-rt-pro`;
        assemblySocket = new WebSocket(url, { headers: { Authorization: apiKey } });

        const connectionTimeout = setTimeout(() => {
            isConnecting = false;
            if (assemblySocket && assemblySocket.readyState !== WebSocket.OPEN) {
                console.error('[TRANSCRIPTION] Connection timeout');
                try { assemblySocket.close(); } catch (_) {}
                assemblySocket = null;
                safeSendStatus('error', 'Connection timed out');
            }
        }, 15000);

        assemblySocket.on('open', () => {
            clearTimeout(connectionTimeout);
            isConnecting = false;
            safeSendStatus('connected');

            // If we are on KDE/Linux, start the native PipeWire capture now
            if (kdeManager.isKdePlasma()) {
                console.log('[TRANSCRIPTION] Starting native Linux audio capture (parec)');
                try {
                    // Verify parec is installed
                    try {
                        execSync('which parec', { encoding: 'utf-8' });
                    } catch (_) {
                        const msg = 'Voice capture requires "parec" (pulseaudio-utils). Install it:\n' +
                            '  Arch/EndeavourOS: sudo pacman -S libpulse\n' +
                            '  Ubuntu/Debian:    sudo apt install pulseaudio-utils\n' +
                            '  Fedora:           sudo dnf install pulseaudio-utils';
                        console.error(`[TRANSCRIPTION] ${msg}`);
                        safeSendStatus('error', 'Missing dependency: parec. Check terminal for install instructions.');
                        return;
                    }
                    // Dynamically get the exact monitor name of the default sink
                    let targetSink = '@DEFAULT_SINK@.monitor';
                    try {
                        const defaultSink = execSync('pactl get-default-sink', { encoding: 'utf-8' }).trim();
                        if (defaultSink) {
                            targetSink = `${defaultSink}.monitor`;
                            console.log(`[TRANSCRIPTION] Resolved target sink: ${targetSink}`);
                        }
                    } catch (e) {
                        console.warn('[TRANSCRIPTION] Could not dynamically resolve default sink.', e.message);
                    }

                    // Use parec for guaranteed raw PCM output (no WAV headers)
                    nativeAudioProcess = spawn('parec', [
                        '--rate=16000',
                        '--channels=1',
                        '--format=s16le',
                        '-d', targetSink
                    ]);

                    let audioBuffer = Buffer.alloc(0);
                    // 100ms chunks: 16000Hz * 1ch * 2bytes * 0.1s = 3200 bytes
                    const CHUNK_SIZE = 3200;
                    // Software gain — monitor sinks capture at very low amplitude
                    const AUDIO_GAIN = 10;

                    function amplifyPCM(buffer) {
                        const amplified = Buffer.alloc(buffer.length);
                        for (let i = 0; i < buffer.length - 1; i += 2) {
                            let sample = buffer.readInt16LE(i);
                            sample = Math.max(-32768, Math.min(32767, sample * AUDIO_GAIN));
                            amplified.writeInt16LE(sample, i);
                        }
                        return amplified;
                    }

                    nativeAudioProcess.stdout.on('data', (data) => {
                        audioBuffer = Buffer.concat([audioBuffer, data]);

                        // Drain buffer in proper-sized chunks (while, not if!)
                        while (audioBuffer.length >= CHUNK_SIZE) {
                            const chunk = audioBuffer.subarray(0, CHUNK_SIZE);
                            audioBuffer = audioBuffer.subarray(CHUNK_SIZE);

                            if (assemblySocket && assemblySocket.readyState === WebSocket.OPEN) {
                                const boosted = amplifyPCM(chunk);
                                assemblySocket.send(boosted);
                            }
                        }
                    });

                    nativeAudioProcess.on('error', (err) => {
                        console.error('[TRANSCRIPTION] parec error:', err.message);
                    });

                    nativeAudioProcess.on('close', (code) => {
                        console.log(`[TRANSCRIPTION] parec exited with code ${code}`);
                        nativeAudioProcess = null;
                    });
                } catch (err) {
                    console.error('[TRANSCRIPTION] Failed to spawn parec:', err);
                }
            }
        });

        assemblySocket.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                
                if (data.error) {
                    console.error('[TRANSCRIPTION] Server error:', data.error);
                }

                if (data.type === 'Turn') {
                    console.log(`[TRANSCRIPTION] Received Turn: "${data.transcript}" (end_of_turn: ${data.end_of_turn})`);
                }

                const mainWindow = getMainWindow();
                const islandWindow = getIslandWindow();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('transcription-data', data);
                }
                if (islandWindow && !islandWindow.isDestroyed()) {
                    islandWindow.webContents.send('transcription-data', data);
                }
            } catch (err) {
                console.error('[TRANSCRIPTION] Parse error:', err.message);
            }
        });

        assemblySocket.on('error', (err) => {
            clearTimeout(connectionTimeout);
            isConnecting = false;
            console.error('[TRANSCRIPTION] WebSocket error:', err.message);
            safeSendStatus('error', err.message);
        });

        assemblySocket.on('close', (code, reason) => {
            clearTimeout(connectionTimeout);
            isConnecting = false;
            assemblySocket = null;
            safeSendStatus('disconnected');
        });

        return true;
    } catch (err) {
        isConnecting = false;
        console.error('[TRANSCRIPTION] Start error:', err);
        return false;
    }
}

function stopTranscription() {
    isConnecting = false;

    // Kill native audio process if it exists
    if (nativeAudioProcess) {
        try {
            nativeAudioProcess.kill('SIGTERM');
        } catch (_) {}
        nativeAudioProcess = null;
    }

    if (assemblySocket) {
        try {
            if (assemblySocket.readyState === WebSocket.OPEN) {
                assemblySocket.send(JSON.stringify({ type: 'Terminate' }));
            }
        } catch (err) {
            console.error('[TRANSCRIPTION] Terminate send error:', err.message);
        }

        const socketRef = assemblySocket;
        setTimeout(() => {
            try {
                if (socketRef && socketRef.readyState !== WebSocket.CLOSED) {
                    socketRef.close();
                }
            } catch (_) {}
        }, 500);

        assemblySocket = null;
    }
}

function sendAudioChunk(base64Audio) {
    try {
        if (assemblySocket && assemblySocket.readyState === WebSocket.OPEN) {
            const buffer = Buffer.from(base64Audio, 'base64');
            assemblySocket.send(buffer);
        }
    } catch (err) {
        // Silent — high-frequency operation, don't spam logs
    }
}

async function testConnection(apiKey) {
    if (!apiKey) return { success: false, error: 'No API Key provided' };
    
    return new Promise((resolve) => {
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                try { tempSocket.close(); } catch (_) {}
                resolve({ success: false, error: 'Connection timed out (10s)' });
            }
        }, 10000);

        let tempSocket;
        try {
            tempSocket = new WebSocket('wss://streaming.assemblyai.com/v3/ws?sample_rate=16000', {
                headers: { Authorization: apiKey }
            });
        } catch (err) {
            clearTimeout(timeout);
            return resolve({ success: false, error: err.message });
        }

        tempSocket.on('open', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try { tempSocket.close(); } catch (_) {}
                resolve({ success: true });
            }
        });

        tempSocket.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ success: false, error: err.message });
            }
        });
    });
}

module.exports = {
    startTranscription,
    stopTranscription,
    sendAudioChunk,
    testConnection
};
