export async function fetchModels() {
    const endpoints = ['http://127.0.0.1:11434/api/tags', 'http://localhost:11434/api/tags'];
    for (const url of endpoints) {
        try {
            const data = await window.electronAPI.ollamaCall(url, { method: 'GET' });
            if (data && !data.error && data.models && Array.isArray(data.models) && data.models.length > 0) {
                return data.models;
            }
        } catch (e) {
            // Silently try next endpoint
        }
    }
    return null;
}

function extractErrorMessage(result, providerName) {
    if (!result) return 'Unknown error occurred';
    // If it's a provider JSON error object (e.g. Gemini)
    if (typeof result.error === 'object' && result.error.message) return result.error.message;
    // If it's an IPC handler or standard fetch error string
    if (typeof result.message === 'string' && result.message.trim() !== '') {
        try {
            // Sometimes the message is raw HTML from a 503 page, so let's try parsing it as JSON first
            const parsed = JSON.parse(result.message);
            if (parsed.error && parsed.error.message) return parsed.error.message;
        } catch (e) {
            // It's not JSON, so it's probably raw HTML or plain text. If it's long HTML, truncate it.
            if (result.message.includes('<html') || result.message.length > 150) {
                return `${providerName} is currently unavailable (Status: ${result.status}). Please try again in a moment.`;
            }
            return result.message;
        }
    }
    return `${providerName} returned an error (status: ${result.status || 'unknown'})`;
}

export async function generateOllamaResponse(baseUrl, payload) {
    if (!baseUrl) throw new Error('No base URL configured for Ollama');

    const targetUrl = `${baseUrl}/api/chat`;
    const result = await window.electronAPI.ollamaCall(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (result && result.error) {
        throw new Error(extractErrorMessage(result, 'Ollama'));
    }

    return result || {};
}


export async function generateOpenRouterResponse(apiKey, payload) {
    if (!apiKey) throw new Error('No API key configured for OpenRouter');

    const targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const result = await window.electronAPI.ollamaCall(targetUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Imposter'
        },
        body: JSON.stringify(payload)
    });

    if (result && result.error) {
        throw new Error(extractErrorMessage(result, 'OpenRouter'));
    }

    return result || {};
}

/**
 * Direct Gemini API Integration
 */

export async function fetchGeminiModels(apiKey) {
    if (!apiKey) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const data = await window.electronAPI.ollamaCall(url, { method: 'GET' });
        if (data && data.models) {
            // Filter to only include generateContent capable models
            return data.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));
        }
    } catch (e) {
        console.error('[API] Gemini Fetch Error:', e);
    }
    return null;
}

export async function generateGeminiResponse(apiKey, modelId, conversationHistory, systemInstruction = '') {
    if (!apiKey) throw new Error('No API key configured for Gemini');

    // Gemini models in URL must be prefixed with 'models/' if they aren't already
    const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;

    // Map internal history to Gemini format
    // Internal: { role: 'user' | 'assistant', content: string }
    // Gemini: { role: 'user' | 'model', parts: [{ text: string }] }
    const contents = conversationHistory
        .filter(m => m.role !== 'system')
        .map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));

    const payload = { contents };

    if (systemInstruction) {
        payload.system_instruction = {
            parts: [{ text: systemInstruction }]
        };
    }

    const result = await window.electronAPI.ollamaCall(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (result && result.error) {
        throw new Error(extractErrorMessage(result, 'Gemini'));
    }

    return result || {};
}

export async function testGeminiModel(apiKey, modelId) {
    if (!apiKey || !modelId) return false;
    const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;
    
    try {
        const result = await window.electronAPI.ollamaCall(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] })
        });
        
        return !!(result && result.candidates && result.candidates.length > 0);
    } catch (e) {
        return false;
    }
}
