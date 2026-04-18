import * as API from './api.js';
import * as Config from './config.js';
import * as UI from './ui.js';
import { setupMarkdown, parseMarkdown } from './markdown.js';
import { AssemblyService } from './assembly-service.js';
import { CustomDropdown } from './dropdown-manager.js';

window.onerror = (message, source, lineno, colno, error) => {
    return true; 
};

window.onunhandledrejection = (event) => {
    event.preventDefault();
};

function $(id) {
    return document.getElementById(id);
}

const promptInput = $('prompt-input');
const searchBtn = $('search-btn');
const resultContent = $('result-content');
const statusDot = $('connectionStatus');
const statusText = $('statusText');
const chatStage = $('chat-stage');
const clearChatBtn = $('clear-chat-btn');

// Custom Dropdowns (initialized in init)
let modelSelect;
let settingsPersona;
let settingsAppMode;
let newModelProvider;
let newGeminiModelSelect;

// Overlays
const onboardingOverlay = $('onboarding-overlay');
const settingsOverlay = $('settings-overlay');

// Form Inputs
const userNameInput = $('user-name');
const systemPromptInput = $('system-prompt');
const settingsNameInput = $('settings-name');
const settingsPromptInput = $('settings-prompt');
const settingsAssemblyKey = $('settings-assembly-key');
const settingsResume = $('settings-resume');
const settingsJd = $('settings-jd');
const voiceTestStatus = $('voice-test-status');

// Window Controls
const windowControls = $('window-controls');
const winMinBtn = $('win-min-btn');
const winCloseBtn = $('win-close-btn');

// Model Management Elements
const customModelsList = $('custom-models-list');
const newModelLabel = $('new-model-label');
const newModelId = $('new-model-id');
const newModelKey = $('new-model-key');
const newModelUrl = $('new-model-url');
const addModelBtn = $('add-model-btn');
const apiKeyGroup = $('api-key-group');
const apiKeyLabel = $('api-key-label');
const baseUrlGroup = $('base-url-group');
const modelIdGroup = $('model-id-group');
const geminiModelGroup = $('gemini-model-group');
const verifyGeminiBtn = $('verify-gemini-btn');
const geminiFetchStatus = $('gemini-fetch-status');

// Buttons
const saveConfigBtn = $('save-config-btn');
const settingsBtn = $('settings-link');
const testVoiceBtn = $('test-voice-btn');
const saveSettingsBtn = $('save-settings');

// State
let userConfig = Config.getDefaultConfig();
let customModels = [];
let editingIndex = -1; // -1 means no model is currently being edited
let currentRawResponse = '';
let isRecording = false;

// Context Memory
let conversationHistory = [];
let emptyStateHtml = '';

async function init() {
    try {
        setupMarkdown();
        loadAppConfig();

        emptyStateHtml = resultContent ? resultContent.innerHTML : '';
        customModels = Config.getSavedModels();

        applyAppMode(userConfig.appMode || 'stealth');
        initCustomDropdowns();
        setupEventListeners();
        renderCustomModelsList();

        loadModels();
    } catch (err) {
        console.error('[INIT] Setup failed:', err);
    }
}

function applyAppMode(mode) {
    try {
        if (window.electronAPI && window.electronAPI.setAppMode) {
            window.electronAPI.setAppMode(mode);
        }
        if (windowControls) {
            windowControls.style.display = mode === 'normal' ? 'flex' : 'none';
        }

        scrubTooltips(mode);
        
        // Update dropdown if initialized
        if (settingsAppMode) settingsAppMode.setValue(mode);
    } catch (err) {
        console.error('[APP] Mode switch error:', err);
    }
}

function initCustomDropdowns() {
    modelSelect = new CustomDropdown('modelSelect', {
        placeholder: 'Loading models...',
        onChange: () => {}
    });

    // 2. Settings Persona
    settingsPersona = new CustomDropdown('settings-persona', {
        defaultValue: 'engineer',
        options: [
            { group: 'Software Engineering', value: 'engineer', label: 'Full Stack Developer' },
            { group: 'Software Engineering', value: 'frontend', label: 'Frontend Architecture' },
            { group: 'Software Engineering', value: 'backend', label: 'Backend & Infrastructure' },
            { group: 'Software Engineering', value: 'fullstack', label: 'Full Stack Engineer' },
            { group: 'Software Engineering', value: 'mobile', label: 'Mobile App Developer' },
            { group: 'Software Engineering', value: 'devops', label: 'DevOps / Cloud Engineer' },
            { group: 'Software Engineering', value: 'ml', label: 'ML / AI Engineer' },
            { group: 'Software Engineering', value: 'qa', label: 'QA / Test Engineer' },
            { group: 'Leadership & Strategy', value: 'architect', label: 'System Architect' },
            { group: 'Leadership & Strategy', value: 'manager', label: 'Engineering Manager' },
            { group: 'Leadership & Strategy', value: 'analyst', label: 'Data / Business Analyst' },
            { group: 'Leadership & Strategy', value: 'product', label: 'Product Manager' },
            { group: 'Other', value: 'default', label: 'None (Raw Prompt Only)' }
        ]
    });

    // 3. Settings App Mode
    settingsAppMode = new CustomDropdown('settings-app-mode', {
        defaultValue: 'stealth',
        options: [
            { value: 'stealth', label: 'Stealth Mode (Hidden / Always On Top)' },
            { value: 'normal', label: 'Normal Mode (Standard Window)' }
        ]
    });

    // 4. Model Provider
    newModelProvider = new CustomDropdown('new-model-provider', {
        defaultValue: 'ollama',
        options: [
            { value: 'ollama', label: 'Ollama' },
            { value: 'openrouter', label: 'OpenRouter' },
            { value: 'gemini', label: 'Google Gemini' }
        ],
        onChange: (val) => handleProviderChange(val)
    });

    // 5. Gemini Model Selector
    newGeminiModelSelect = new CustomDropdown('new-gemini-model-select', {
        placeholder: 'Awaiting API Verification...',
        options: []
    });
}

function handleProviderChange(provider) {
    try {
        if (apiKeyGroup) apiKeyGroup.style.display = (provider === 'openrouter' || provider === 'gemini') ? 'block' : 'none';
        if (baseUrlGroup) baseUrlGroup.style.display = provider === 'ollama' ? 'block' : 'none';
        if (verifyGeminiBtn) verifyGeminiBtn.style.display = provider === 'gemini' ? 'block' : 'none';
        
        // Toggle between manual ID input and Gemini Select
        if (modelIdGroup) modelIdGroup.style.display = provider === 'gemini' ? 'none' : 'block';
        if (geminiModelGroup) geminiModelGroup.style.display = provider === 'gemini' ? 'block' : 'none';

        if (apiKeyLabel) {
            apiKeyLabel.textContent = provider === 'gemini' ? 'Google AI Studio Key' : 'API Key';
        }

        if (provider === 'openrouter') {
            if (newModelId) newModelId.placeholder = 'e.g. qwen/qwen3.6-plus:free';
            if (newModelUrl) newModelUrl.value = '';
        } else if (provider === 'ollama') {
            if (newModelId) newModelId.placeholder = 'e.g. llama3';
            if (newModelUrl) newModelUrl.value = 'http://127.0.0.1:11434';
        }
    } catch (err) {
        console.error('[APP] Provider change error:', err);
    }
}

function scrubTooltips(mode) {
    try {
        const elements = document.querySelectorAll('[title], [data-stealth-title]');
        elements.forEach(el => {
            if (mode === 'stealth' || (userConfig && userConfig.appMode === 'stealth')) {
                if (el.hasAttribute('title')) {
                    el.setAttribute('data-stealth-title', el.getAttribute('title'));
                    el.removeAttribute('title');
                }
            } else {
                if (el.hasAttribute('data-stealth-title')) {
                    el.setAttribute('title', el.getAttribute('data-stealth-title'));
                    el.removeAttribute('data-stealth-title');
                }
            }
        });
    } catch (err) {
        console.error('[APP] Tooltip scrubbing error:', err);
    }
}

function loadAppConfig() {
    try {
        const saved = Config.getSavedConfig();
        if (saved) {
            userConfig = saved;
            if (onboardingOverlay) onboardingOverlay.classList.add('hidden');
            UI.updateGreeting($('greeting-container'), userConfig.name);
        } else {
            if (onboardingOverlay) onboardingOverlay.classList.remove('hidden');
        }
    } catch (err) {
        console.error('[APP] Config load error:', err);
        if (onboardingOverlay) onboardingOverlay.classList.remove('hidden');
    }
}

async function loadModels() {
    try {
        if (statusDot) statusDot.className = 'dot offline';
        if (statusText) statusText.textContent = 'Scanning...';

        const ollamaModels = await API.fetchModels();
        const modelOptions = [];

        if (ollamaModels && Array.isArray(ollamaModels)) {
            ollamaModels.forEach(m => {
                if (!m || !m.name) return;
                modelOptions.push({
                    group: 'Local Nodes',
                    value: `ollama|${m.name}|http://127.0.0.1:11434`,
                    label: `Local: ${m.name}`
                });
            });
        }

        if (customModels && customModels.length > 0) {
            customModels.forEach(m => {
                if (!m || !m.modelId) return;
                let group = 'Cloud Nodes';
                if (m.provider === 'ollama') group = 'Custom Local';
                if (m.provider === 'gemini') group = 'Gemini Nodes';

                modelOptions.push({
                    group: group,
                    value: `${m.provider}|${m.modelId}|${m.baseUrl}|${m.apiKey}`,
                    label: `${m.name || m.modelId}`
                });
            });
        }

        if (modelSelect) {
            modelSelect.setOptions(modelOptions);
            if (modelOptions.length > 0) {
                if (statusDot) statusDot.className = 'dot online';
                if (statusText) statusText.textContent = 'Ready';
            } else {
                if (statusText) statusText.textContent = 'No Models';
            }
        }
    } catch (err) {
        console.error('[APP] Model loading error:', err);
        if (statusText) statusText.textContent = 'Scan Failed';
    }
}

function renderCustomModelsList() {
    if (!customModelsList) return;
    try {
        customModelsList.innerHTML = '';

        if (customModels.length === 0) {
            customModelsList.innerHTML = `
                <div class="models-list-empty">
                    <div class="empty-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7L12 12L22 7L12 2Z"></path><path d="M2 17L12 22L22 17"></path><path d="M2 12L12 17L22 12"></path></svg>
                    </div>
                    <p>No custom models registered yet.</p>
                </div>
            `;
            return;
        }

        customModels.forEach((m, index) => {
            if (!m) return;
            const isEditing = editingIndex === index;
            const item = document.createElement('div');
            item.className = `model-item ${isEditing ? 'editing' : ''}`;

            const isOllama = m.provider === 'ollama';
            const isGemini = m.provider === 'gemini';
            let providerClass = 'badge-openrouter';
            let providerLabel = 'Cloud';
            
            if (isOllama) {
                providerClass = 'badge-ollama';
                providerLabel = 'Local';
            } else if (isGemini) {
                providerClass = 'badge-gemini';
                providerLabel = 'Gemini';
            }

            // Icon based on provider
            let iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7L12 12L22 7L12 2Z"></path><path d="M12 12.5V22"></path><path d="M12 22L2 17"></path><path d="M12 22L22 17"></path></svg>`;
            
            if (isOllama) {
                iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>`;
            } else if (isGemini) {
                iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #8E75FF;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
            }

            const safeName = (m.name || 'Unnamed Model').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeModelId = (m.modelId || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeBaseUrl = (m.baseUrl || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeApiKey = (m.apiKey || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            if (isEditing) {
                // Edit Mode Template
                item.innerHTML = `
                    <div class="model-info-wrapper" style="flex: 1;">
                        <div class="model-icon-container">
                            ${iconSvg}
                        </div>
                        <div class="model-info" style="flex: 1; gap: 8px;">
                            <input type="text" class="edit-model-name" value="${safeName}" placeholder="Friendly Name" style="width: 100%;">
                            <div class="model-meta" style="flex-wrap: wrap;">
                                <span class="provider-badge ${providerClass}">${providerLabel}</span>
                                <span class="model-id-tag">ID: ${safeModelId}</span>
                                ${isOllama
                        ? `<input type="text" class="edit-model-url" value="${safeBaseUrl}" placeholder="Base URL" style="width: 100%; margin-top: 4px; font-size: 11px;">`
                        : `
                                    <div class="password-input-wrapper" style="width: 100%; position: relative; margin-top: 4px;">
                                        <input type="password" class="edit-model-key" value="${safeApiKey}" placeholder="API Key" style="width: 100%; font-size: 11px; padding-right: 32px;">
                                        <button class="toggle-password-btn" title="Toggle Visibility" style="position: absolute; right: -40px; top: 52%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-secondary); opacity: 0.5; display: flex; align-items: center; justify-content: center; padding: 4px; transition: all 0.2s;">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                <circle cx="12" cy="12" r="3"></circle>
                                            </svg>
                                        </button>
                                    </div>`
                    }
                            </div>
                        </div>
                    </div>
                    <div class="model-actions">
                        <button class="icon-button save-model-edit-btn" data-index="${index}" title="Save">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-color);"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </button>
                        <button class="icon-button cancel-model-edit-btn" data-index="${index}" title="Cancel">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `;
            } else {
                // Normal View Mode Template
                item.innerHTML = `
                    <div class="model-info-wrapper">
                        <div class="model-icon-container">
                            ${iconSvg}
                        </div>
                        <div class="model-info">
                            <span class="model-name">${safeName}</span>
                            <div class="model-meta">
                                <span class="provider-badge ${providerClass}">${providerLabel}</span>
                                <span class="model-id-tag">${safeModelId}</span>
                            </div>
                        </div>
                    </div>
                    <div class="model-actions">
                        <button class="icon-button edit-model-btn" data-index="${index}" title="Edit Configuration">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="icon-button delete-model-btn" data-index="${index}" title="Remove Model">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ff4d4d;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                `;
            }

            customModelsList.appendChild(item);
        });

        // Event Listeners for action buttons
        document.querySelectorAll('.edit-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                editingIndex = parseInt(btn.getAttribute('data-index'), 10);
                renderCustomModelsList();
            });
        });

        // Toggle Password Visibility
        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const wrapper = btn.closest('.password-input-wrapper');
                const input = wrapper ? wrapper.querySelector('input') : null;
                const icon = btn.querySelector('svg');

                if (input && icon) {
                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
                    } else {
                        input.type = 'password';
                        icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
                    }
                }
            });
        });

        document.querySelectorAll('.cancel-model-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                editingIndex = -1;
                renderCustomModelsList();
            });
        });

        document.querySelectorAll('.save-model-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.getAttribute('data-index'), 10);
                const item = btn.closest('.model-item');
                if (!item) return;

                const newName = item.querySelector('.edit-model-name').value.trim();
                const newUrl = item.querySelector('.edit-model-url')?.value.trim();
                const newKey = item.querySelector('.edit-model-key')?.value.trim();

                if (newName && index >= 0 && index < customModels.length) {
                    customModels[index].name = newName;
                    if (newUrl !== undefined) customModels[index].baseUrl = newUrl;
                    if (newKey !== undefined) customModels[index].apiKey = newKey;

                    Config.saveModels(customModels);
                    editingIndex = -1;
                    renderCustomModelsList();
                    loadModels();
                }
            });
        });

        document.querySelectorAll('.delete-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(index) && index >= 0 && index < customModels.length) {
                    customModels.splice(index, 1);
                    Config.saveModels(customModels);
                    editingIndex = -1;
                    renderCustomModelsList();
                    loadModels();
                }
            });
        });
        // Ensure new dynamic elements follow current stealth rules
        scrubTooltips(userConfig.appMode || 'stealth');

    } catch (err) {
        console.error('[APP] Model list render error:', err);
    }
}

function setupEventListeners() {
    if (promptInput) promptInput.addEventListener('input', () => UI.autoGrowTextarea(promptInput));

    // Dropdown listeners are handled via callbacks in initCustomDropdowns()

    // Manual fetch/verify for Gemini
    if (verifyGeminiBtn) {
        verifyGeminiBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await fetchGeminiModelsForForm();
        });
    }

    async function fetchGeminiModelsForForm() {
        const key = newModelKey ? newModelKey.value.trim() : '';
        if (!key || !newGeminiModelSelect) {
            alert('Please enter your Gemini API key first.');
            return;
        }
        
        if (verifyGeminiBtn) verifyGeminiBtn.disabled = true;
        if (geminiFetchStatus) {
            geminiFetchStatus.textContent = 'Listing Models...';
            geminiFetchStatus.classList.add('visible', 'loading');
            geminiFetchStatus.style.color = 'var(--accent-color)';
        }
        
        try {
            // 1. Get full list
            const allModels = await API.fetchGeminiModels(key);
            if (!allModels || allModels.length === 0) {
                if (geminiFetchStatus) {
                    geminiFetchStatus.textContent = 'No models found';
                    geminiFetchStatus.classList.remove('loading');
                }
                return;
            }

            // 2. Filter relevant ones
            const candidateModels = allModels.filter(m => m.supportedGenerationMethods.includes('generateContent'));
            
            
            const workingModels = [];
            let checkedCount = 0;

            for (const m of candidateModels) {
                checkedCount++;
                if (geminiFetchStatus) {
                    geminiFetchStatus.textContent = `Verifying ${checkedCount}/${candidateModels.length}...`;
                }

                const isWorking = await API.testGeminiModel(key, m.name);
                if (isWorking) {
                    workingModels.push({
                        value: m.name.replace('models/', ''),
                        label: m.displayName
                    });
                }
            }

            if (workingModels.length === 0) {
                if (newGeminiModelSelect) newGeminiModelSelect.setOptions([]);
                if (geminiFetchStatus) {
                    geminiFetchStatus.textContent = 'No working models found';
                    geminiFetchStatus.style.color = '#ff4d4d';
                    geminiFetchStatus.classList.remove('loading');
                }
            } else {
                if (newGeminiModelSelect) newGeminiModelSelect.setOptions(workingModels);
                if (geminiFetchStatus) {
                    geminiFetchStatus.textContent = `${workingModels.length} Models Verified`;
                    geminiFetchStatus.style.color = '#10a37f';
                    geminiFetchStatus.classList.remove('loading');
                }
                // Smooth focus after a short delay
                setTimeout(() => {
                    if (newGeminiModelSelect) newGeminiModelSelect.focus();
                }, 400);
            }
        } catch (err) {
            console.error('[APP/GEMINI] Verification error:', err);
            if (geminiFetchStatus) {
                geminiFetchStatus.textContent = 'Error during verification';
                geminiFetchStatus.style.color = '#ff4d4d';
                geminiFetchStatus.classList.remove('loading');
            }
        } finally {
            if (verifyGeminiBtn) verifyGeminiBtn.disabled = false;
        }
    }

    // Reset Application / Logout Logic
    const resetAppBtn = $('reset-app-btn');
    if (resetAppBtn) {
        resetAppBtn.addEventListener('click', () => {
            const confirmed = confirm('CRITICAL WARNING: This will permanently delete ALL configurations, API keys, and models. You will be redirected to the onboarding screen. Proceed?');
            
            if (confirmed) {
                localStorage.clear();
                window.location.reload();
            }
        });
    }

    if (addModelBtn) {
        addModelBtn.addEventListener('click', () => {
            try {
                const provider = newModelProvider ? newModelProvider.getValue() : 'ollama';
                const name = newModelLabel ? newModelLabel.value.trim() : '';
                let modelId = '';
                
                if (provider === 'gemini') {
                    modelId = newGeminiModelSelect ? newGeminiModelSelect.getValue() : '';
                } else {
                    modelId = newModelId ? newModelId.value.trim() : '';
                }

                const apiKey = newModelKey ? newModelKey.value.trim() : '';
                const baseUrl = newModelUrl ? newModelUrl.value.trim() : '';

                if (name && modelId) {
                    customModels.push({ name, modelId, provider, apiKey, baseUrl });
                    Config.saveModels(customModels);
                    renderCustomModelsList();
                    loadModels();
                    if (newModelLabel) newModelLabel.value = '';
                    if (newModelId) newModelId.value = '';
                    if (newModelKey) newModelKey.value = '';
                    if (newGeminiModelSelect) {
                        newGeminiModelSelect.setOptions([]);
                    }
                } else {
                    if (!name) {
                        alert('Please enter a Label/Name for your model.');
                    } else if (!modelId && provider === 'gemini') {
                        alert('Please verify and select a Gemini model from the dropdown.');
                    } else if (!modelId) {
                        alert('Please enter a valid Model ID.');
                    }
                }
            } catch (err) {
                console.error('[APP] Add model error:', err);
            }
        });
    }

    if (searchBtn) searchBtn.addEventListener('click', performSearch);
    if (promptInput) {
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                performSearch();
            }
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            try {
                if (settingsNameInput) settingsNameInput.value = userConfig.name || '';
                if (settingsPromptInput) settingsPromptInput.value = userConfig.systemPrompt || '';
                if (settingsAppMode) settingsAppMode.setValue(userConfig.appMode || 'stealth');
                if (settingsAssemblyKey) settingsAssemblyKey.value = userConfig.assemblyKey || '';
                if (settingsResume) settingsResume.value = userConfig.resumeContent || '';
                if (settingsJd) settingsJd.value = userConfig.jobDescription || '';
                if (settingsPersona) settingsPersona.setValue(userConfig.persona || 'engineer');
                if (settingsOverlay) settingsOverlay.classList.remove('hidden');
            } catch (err) {
                console.error('[APP] Settings open error:', err);
            }
        });
    }

    const closeSettingsEl = $('close-settings');
    if (closeSettingsEl) closeSettingsEl.addEventListener('click', () => {
        if (settingsOverlay) settingsOverlay.classList.add('hidden');
    });

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            try {
                const name = settingsNameInput ? settingsNameInput.value.trim() : '';
                const prompt = settingsPromptInput ? settingsPromptInput.value.trim() : '';
                const appMode = settingsAppMode ? settingsAppMode.getValue() : 'stealth';
                const assemblyKey = settingsAssemblyKey ? settingsAssemblyKey.value.trim() : '';

                if (name) {
                    userConfig = Config.saveConfig(name, prompt, appMode, assemblyKey, {
                        resumeContent: settingsResume ? settingsResume.value.trim() : '',
                        jobDescription: settingsJd ? settingsJd.value.trim() : '',
                        persona: settingsPersona ? settingsPersona.getValue() : 'engineer'
                    });
                    UI.updateGreeting($('greeting-container'), userConfig.name);
                    applyAppMode(appMode);
                    if (settingsOverlay) settingsOverlay.classList.add('hidden');
                    if (statusText) statusText.textContent = 'Settings Saved';
                    setTimeout(() => { if (statusText) statusText.textContent = 'Ready'; }, 2000);
                }
            } catch (err) {
                console.error('[APP] Settings save error:', err);
            }
        });
    }

    if (testVoiceBtn) {
        testVoiceBtn.addEventListener('click', async () => {
            try {
                const key = settingsAssemblyKey ? settingsAssemblyKey.value.trim() : '';
                if (!key) {
                    if (voiceTestStatus) voiceTestStatus.textContent = '❌ Please enter an API key';
                    return;
                }

                if (voiceTestStatus) voiceTestStatus.textContent = 'Testing...';
                const result = await window.electronAPI.testAssemblyKey(key);
                if (result && result.success) {
                    if (voiceTestStatus) {
                        voiceTestStatus.textContent = '✅ Connection Successful!';
                        voiceTestStatus.style.color = '#00ffcc';
                    }
                } else {
                    if (voiceTestStatus) {
                        voiceTestStatus.textContent = `❌ Failed: ${(result && result.error) || 'Unknown error'}`;
                        voiceTestStatus.style.color = '#ff4d4d';
                    }
                }
            } catch (err) {
                console.error('[APP] Voice test error:', err);
                if (voiceTestStatus) {
                    voiceTestStatus.textContent = `❌ Error: ${err.message}`;
                    voiceTestStatus.style.color = '#ff4d4d';
                }
            }
        });
    }

    if (saveConfigBtn) {
        const handleOnboardingSave = () => {
            try {
                const name = userNameInput ? userNameInput.value.trim() : '';
                const prompt = systemPromptInput ? systemPromptInput.value.trim() : '';
                const card = document.querySelector('.onboarding-card');

                if (name) {
                    saveConfigBtn.textContent = 'Initializing...';
                    saveConfigBtn.disabled = true;

                    userConfig = Config.saveConfig(name, prompt, 'stealth', '');

                    if (onboardingOverlay) {
                        onboardingOverlay.classList.add('hidden');
                        setTimeout(() => {
                            onboardingOverlay.style.display = 'none';
                        }, 400);
                    }

                    UI.updateGreeting($('greeting-container'), userConfig.name);
                    if (conversationHistory.length === 0 && resultContent) {
                        const homeGreeting = resultContent.querySelector('#greeting-container');
                        if (homeGreeting) UI.updateGreeting(homeGreeting, userConfig.name);
                    }

                    loadModels();
                } else {
                    if (card) {
                        card.classList.remove('shake');
                        void card.offsetWidth; 
                        card.classList.add('shake');
                    }
                    if (userNameInput) {
                        userNameInput.classList.add('error');
                        userNameInput.focus();
                    }
                }
            } catch (err) {
                console.error('[ONBOARDING] Error:', err);
                if (saveConfigBtn) {
                    saveConfigBtn.textContent = 'Error - Try Again';
                    saveConfigBtn.disabled = false;
                }
            }
        };

        console.log('[ONBOARDING] Attaching listeners to saveConfigBtn');
        saveConfigBtn.addEventListener('click', handleOnboardingSave);

        // Keyboard Support for Enter
        if (userNameInput) {
            userNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleOnboardingSave();
                }
                userNameInput.classList.remove('error');
            });
        }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            try {
                const tabId = btn.getAttribute('data-tab');
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.tab-pane').forEach(p => {
                    p.classList.toggle('active', p.id === `tab-${tabId}`);
                });
                if (saveSettingsBtn) {
                    saveSettingsBtn.style.display = (tabId === 'shortcuts' || tabId === 'about') ? 'none' : 'block';
                }
            } catch (err) {
                console.error('[APP] Tab switch error:', err);
            }
        });
    });

    if (winMinBtn) winMinBtn.addEventListener('click', () => {
        try { window.electronAPI.minimizeApp(); } catch (_) { }
    });
    if (winCloseBtn) winCloseBtn.addEventListener('click', () => {
        try { window.electronAPI.closeApp(); } catch (_) { }
    });

    if (window.electronAPI) {
        window.electronAPI.onFocusInput(() => { 
            if (promptInput) {
                promptInput.focus();
                // If there's already text, scroll to the end
                const len = promptInput.value.length;
                promptInput.setSelectionRange(len, len);
            } 
        });
        window.electronAPI.onTriggerSearch(() => performSearch());
        window.electronAPI.onScroll((dir) => {
            if (chatStage) chatStage.scrollBy({ top: dir * 150, behavior: 'smooth' });
        });
        window.electronAPI.onCopyMain(() => {
            try {
                if (currentRawResponse) {
                    navigator.clipboard.writeText(currentRawResponse).catch(() => { });
                    if (statusText) statusText.textContent = 'Copied!';
                    setTimeout(() => { if (statusText) statusText.textContent = 'Ready'; }, 2000);
                }
            } catch (err) {
                console.error('[APP] Copy error:', err);
            }
        });

        window.electronAPI.onTriggerAiSearch(() => {
            try {
                const lastTranscript = AssemblyService.getLastFinalTranscript();
                if (lastTranscript) {
                    window.electronAPI.sendAiResponseToIsland('thinking...');
                    if (promptInput) promptInput.value = lastTranscript;
                    performSearch(true);
                }
            } catch (err) {
                console.error('[APP] F10 AI search error:', err);
            }
        });

        window.electronAPI.onToggleAutoReply(async () => {
            if (isRecording) {
                try {
                    AssemblyService.stop();
                    window.electronAPI.closeIslandWindow();
                } catch (_) { }
                isRecording = false;
                if (statusText) statusText.textContent = 'Ready';
            } else {
                try {
                    if (!userConfig.assemblyKey) {
                        if (statusText) statusText.textContent = 'Missing API Key';
                        return;
                    }

                    if (statusText) statusText.textContent = 'Connecting...';
                    const started = await AssemblyService.start(userConfig.assemblyKey);

                    if (started) {
                        window.electronAPI.openIslandWindow();
                        isRecording = true;
                        if (statusText) statusText.textContent = 'Live • Recording';
                    } else {
                        if (statusText) statusText.textContent = 'Failed to Start';
                    }
                } catch (err) {
                    console.error('[APP] Voice toggle error:', err);
                    if (statusText) statusText.textContent = 'Mic Error';
                }
            }
        });

        if (window.electronAPI.onOcrResult) {
            window.electronAPI.onOcrResult((text) => {
                try {
                    if (promptInput && text) {
                        promptInput.value += (promptInput.value ? '\n' : '') + text;
                        UI.autoGrowTextarea(promptInput);
                        promptInput.focus();
                    }
                } catch (err) {
                    console.error('[APP] OCR result error:', err);
                }
            });
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (settingsOverlay) settingsOverlay.classList.add('hidden');
            if (onboardingOverlay) onboardingOverlay.classList.add('hidden');
        }
    });

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            try {
                conversationHistory = [];
                if (resultContent) {
                    resultContent.innerHTML = emptyStateHtml;
                    UI.updateGreeting(resultContent.querySelector('#greeting-container'), userConfig.name);
                }
            } catch (err) {
                console.error('[APP] Clear chat error:', err);
            }
        });
    }
}

function appendChatMessage(msg) {
    if (!msg || msg.role === 'system' || !resultContent) return null;

    try {
        if (conversationHistory.length === 1 && conversationHistory[0] === msg) {
            resultContent.innerHTML = '';
        }

        const bubble = document.createElement('div');
        if (msg.role === 'user') {
            bubble.className = 'chat-message-user';
            bubble.textContent = msg.content || '';
        } else {
            bubble.className = 'chat-message-ai markdown-body';
            let htmlContent = parseMarkdown(msg.content || '');
            if (msg.reasoningHtml) htmlContent = msg.reasoningHtml + htmlContent;

            if (msg.isError) {
                UI.showError(bubble, { message: msg.content });
            } else {
                bubble.innerHTML = htmlContent;
            }
        }
        resultContent.appendChild(bubble);
        return bubble;
    } catch (err) {
        console.error('[APP] Chat message render error:', err);
        return null;
    }
}

async function performSearch(isF10 = false) {
    if (!searchBtn || searchBtn.disabled) return;
    if (!promptInput || !modelSelect) return;

    const text = promptInput.value.trim();
    const modelSelection = modelSelect.getValue();
    if (!text || !modelSelection) return;

    const parts = modelSelection.split('|');
    const provider = parts[0] || '';
    const modelId = parts[1] || '';
    const baseUrl = parts[2] || '';
    const apiKey = parts[3] || '';

    promptInput.value = '';
    promptInput.style.height = 'auto';
    currentRawResponse = '';
    searchBtn.disabled = true;

    let loadingBubble = null;

    try {
        if (conversationHistory.length === 0) {
            if (resultContent) resultContent.innerHTML = '';
            const fullSystemPrompt = Config.buildSystemPrompt(userConfig);
            if (fullSystemPrompt && provider === 'ollama') {
                conversationHistory.push({ role: 'system', content: fullSystemPrompt });
            }
        }

        const userMsg = { role: 'user', content: text };
        conversationHistory.push(userMsg);
        appendChatMessage(userMsg);

        loadingBubble = document.createElement('div');
        loadingBubble.className = 'chat-message-ai';
        UI.showLoading(loadingBubble);
        if (resultContent) resultContent.appendChild(loadingBubble);
        setTimeout(() => { if (chatStage) chatStage.scrollTop = chatStage.scrollHeight; }, 10);
        if (chatStage) chatStage.scrollTop = chatStage.scrollHeight;

        let reasoningHtml = '';

        if (provider === 'ollama') {
            const responseData = await API.generateOllamaResponse(baseUrl, {
                model: modelId,
                messages: conversationHistory,
                stream: false
            });
            currentRawResponse = responseData?.message?.content || responseData?.response || '';
        } else if (provider === 'openrouter') {
            const orMessages = conversationHistory.filter(m => m.role !== 'system');
            const fullSystemPrompt = Config.buildSystemPrompt(userConfig);
            const data = await API.generateOpenRouterResponse(apiKey, {
                model: modelId,
                messages: orMessages,
                system_prompt: fullSystemPrompt || undefined,
                reasoning: { enabled: true }
            });
            if (data && data.choices && data.choices[0]) {
                const msg = data.choices[0].message;
                currentRawResponse = msg ? (msg.content || '') : '';
                if (msg && msg.reasoning_details) reasoningHtml = UI.renderReasoningTrace(msg.reasoning_details);
            }
        } else if (provider === 'gemini') {
            const fullSystemPrompt = Config.buildSystemPrompt(userConfig);
            const data = await API.generateGeminiResponse(apiKey, modelId, conversationHistory, fullSystemPrompt);
            if (data && data.candidates && data.candidates[0] && data.candidates[0].content) {
                const msg = data.candidates[0].content;
                currentRawResponse = (msg.parts && msg.parts[0]) ? msg.parts[0].text : '';
            }
        }

        const aiMsg = {
            role: 'assistant',
            content: currentRawResponse,
            reasoningHtml
        };
        conversationHistory.push(aiMsg);

        if (loadingBubble && loadingBubble.parentNode) {
            loadingBubble.parentNode.removeChild(loadingBubble);
        }
        appendChatMessage(aiMsg);

        if (isF10 && currentRawResponse) {
            try { window.electronAPI.sendAiResponseToIsland(currentRawResponse); } catch (_) { }
        }

    } catch (err) {
        console.error('[APP] Search error:', err);
        const errorMsg = {
            role: 'assistant',
            content: err.message || 'An unexpected error occurred',
            isError: true
        };
        conversationHistory.push(errorMsg);

        if (loadingBubble && loadingBubble.parentNode) {
            loadingBubble.parentNode.removeChild(loadingBubble);
        }
        appendChatMessage(errorMsg);

        if (isF10) {
            try { window.electronAPI.sendAiResponseToIsland('Error: Could not reach AI'); } catch (_) { }
        }
    } finally {
        searchBtn.disabled = false;
        setTimeout(() => {
            if (chatStage) chatStage.scrollTo({ top: chatStage.scrollHeight, behavior: 'smooth' });
        }, 50);
    }
}

init();
