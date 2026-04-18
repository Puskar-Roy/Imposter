const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Basic App Controls
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    closeApp: () => ipcRenderer.send('close-app'),
    restartApp: () => ipcRenderer.send('restart-app'),
    setAppMode: (mode) => ipcRenderer.send('set-app-mode', mode),

    // OCR
    onOcrResult: (callback) => ipcRenderer.on('ocr-result', (event, text) => callback(text)),
    snipCrop: (data) => ipcRenderer.send('snip-crop', data),
    cancelSnip: () => ipcRenderer.send('cancel-snip'),

    // LLM
    ollamaCall: (url, options) => ipcRenderer.invoke('ollama-call', { url, options }),

    // AI & Island Logic
    sendAiResponseToIsland: (text) => ipcRenderer.send('send-ai-to-island', text),
    onAiResponse: (callback) => ipcRenderer.on('ai-response', (event, value) => callback(value)),

    // Voice & Transcription
    isNativeLinuxAudio: () => ipcRenderer.invoke('is-native-linux-audio'),
    getDesktopSourceId: () => ipcRenderer.invoke('get-desktop-source-id'),
    startTranscription: (apiKey) => ipcRenderer.invoke('start-transcription', apiKey),
    stopTranscription: () => ipcRenderer.send('stop-transcription'),
    sendAudioChunk: (chunk) => ipcRenderer.send('send-audio-chunk', chunk),
    onTranscriptionData: (callback) => ipcRenderer.on('transcription-data', (event, data) => callback(data)),
    onTranscriptionStatus: (callback) => ipcRenderer.on('transcription-status', (event, status, error) => callback(status, error)),
    testAssemblyKey: (apiKey) => ipcRenderer.invoke('test-assembly-key', apiKey),

    // Custom Triggers
    onFocusInput: (callback) => ipcRenderer.on('focus-input', callback),
    onTriggerSearch: (callback) => ipcRenderer.on('trigger-search', callback),
    onTriggerAiSearch: (callback) => ipcRenderer.on('trigger-ai-search', callback),
    onToggleAutoReply: (callback) => ipcRenderer.on('toggle-auto-reply', callback),
    onScroll: (callback) => ipcRenderer.on('scroll', (event, delta) => callback(delta)),
    onCopyMain: (callback) => ipcRenderer.on('copy-main', (event) => callback()),

    // Window Management
    openIslandWindow: () => ipcRenderer.send('open-island-window'),
    closeIslandWindow: () => ipcRenderer.send('close-island-window')
});
