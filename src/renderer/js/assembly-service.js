let audioContext = null;
let sourceNode = null;
let workletNode = null;
let stream = null;
let lastFinalTranscript = '';
let isStarting = false;

export const AssemblyService = {
    async start(apiKey) {
        if (isStarting) return false;
        isStarting = true;

        try {
            // Clean up any previous session first
            this.stop();

            const isNativeLinux = await window.electronAPI.isNativeLinuxAudio();

            if (isNativeLinux) {
                console.log('[ASSEMBLY] Using native Linux audio capture (bypassing WebRTC)');
                const started = await window.electronAPI.startTranscription(apiKey);
                if (!started) throw new Error('Failed to start native transcription on backend');
            } else {
                stream = await navigator.mediaDevices.getDisplayMedia({
                    audio: true,
                    video: { width: 1, height: 1, frameRate: 1 }
                });

                stream.getVideoTracks().forEach(track => track.stop());

                const audioTracks = stream.getAudioTracks();
                if (audioTracks.length === 0) {
                    throw new Error('No audio track found. Ensure Share Audio was selected.');
                }

                audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                await audioContext.audioWorklet.addModule('js/pcm-worklet.js');

                const mediaStream = new MediaStream(audioTracks);
                sourceNode = audioContext.createMediaStreamSource(mediaStream);

                const started = await window.electronAPI.startTranscription(apiKey);
                if (!started) throw new Error('Failed to start transcription on backend');

                workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
                
                workletNode.port.onmessage = (event) => {
                    try {
                        const buffer = event.data;
                        if (!buffer) return;
                        const uint8Array = new Uint8Array(buffer);
                        let binary = '';
                        const len = uint8Array.byteLength;
                        for (let i = 0; i < len; i++) {
                            binary += String.fromCharCode(uint8Array[i]);
                        }
                        window.electronAPI.sendAudioChunk(btoa(binary));
                    } catch (err) {
                        // Silent — audio processing is high-frequency
                    }
                };

                sourceNode.connect(workletNode);
                workletNode.connect(audioContext.destination);
            }

            window.electronAPI.onTranscriptionData((data) => {
                try {
                    if (data && data.type === 'Turn' && data.end_of_turn) {
                        lastFinalTranscript = data.transcript || '';
                    } else if (data && data.message_type === 'FinalTranscript') {
                        lastFinalTranscript = data.text || '';
                    }
                } catch (err) {
                    console.error('[ASSEMBLY] Transcription data handler error:', err);
                }
            });

            isStarting = false;
            return true;
        } catch (err) {
            isStarting = false;
            console.error('[ASSEMBLY] Start error:', err);
            this.stop();
            throw err;
        }
    },

    stop() {
        isStarting = false;

        try {
            if (workletNode) {
                workletNode.port.onmessage = null;
                workletNode.disconnect();
            }
        } catch (_) {}
        workletNode = null;

        try {
            if (sourceNode) sourceNode.disconnect();
        } catch (_) {}
        sourceNode = null;

        try {
            if (audioContext && audioContext.state !== 'closed') audioContext.close();
        } catch (_) {}
        audioContext = null;

        try {
            if (stream) stream.getTracks().forEach(track => track.stop());
        } catch (_) {}
        stream = null;

        try {
            window.electronAPI.stopTranscription();
        } catch (_) {}
    },

    getLastFinalTranscript() {
        return lastFinalTranscript;
    }
};
