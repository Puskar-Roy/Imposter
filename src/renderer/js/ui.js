export function updateGreeting(container, name) {
    try {
        if (!container) return;
        const hour = new Date().getHours();
        let welcome = "Good morning";
        if (hour >= 12 && hour < 17) welcome = "Good afternoon";
        if (hour >= 17) welcome = "Good evening";
        container.textContent = `${welcome}, ${name || 'User'}`;
    } catch (err) {
        console.error('[UI] Greeting update error:', err);
    }
}

export function autoGrowTextarea(textarea) {
    try {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
        if (textarea.value === '') textarea.style.height = 'auto';
    } catch (err) {
        console.error('[UI] Textarea resize error:', err);
    }
}

export function showLoading(container) {
    if (!container) return;
    container.innerHTML = `
        <div class="loading">
            <span style="font-weight:600; margin-right:8px; color:var(--text-primary);">Thinking</span>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
        </div>
    `;
}

export function showError(container, error) {
    if (!container) return;
    const message = error && error.message ? error.message : 'An unknown error occurred';
    const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    container.innerHTML = `
        <div style="color:#ff4a4a; padding:10px; border:1px solid #ff4a4a; border-radius:8px;">
            <p><strong>System Error:</strong> ${safeMessage}</p>
            <p style="font-size:12px; margin-top:8px; color:var(--text-secondary);">
                Check your internet connection or local server (Ollama) status.
            </p>
        </div>
    `;
}

export function renderReasoningTrace(details) {
    try {
        if (!details || !Array.isArray(details)) return '';
        
        const reasoningText = details
            .filter(d => d && d.type === 'reasoning.text')
            .map(d => d.text || '')
            .join('\n');
        
        if (!reasoningText) return '';

        const safeText = reasoningText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
            <div class="reasoning-trace">
                <details>
                    <summary>Logic Trace</summary>
                    <div class="reasoning-content">${safeText}</div>
                </details>
            </div>
        `;
    } catch (err) {
        console.error('[UI] Reasoning trace error:', err);
        return '';
    }
}

export function showNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    let icon = '';
    if (type === 'error') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff4d4d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    } else if (type === 'success') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    notification.innerHTML = `
        <div class="notification-icon">${icon}</div>
        <div class="notification-text">${message}</div>
    `;

    container.appendChild(notification);

    // Auto-remove
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                container.removeChild(notification);
            }
        }, 300);
    }, duration);
}
