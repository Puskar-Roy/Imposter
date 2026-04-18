// ── KDE Plasma Stealth Manager ──────────────────────────────────────────────
// Uses KWin Scripting API to set ExcludeFromCapture on KDE Plasma 6.6+.
// The kwinrulesrc approach does NOT work because excludeFromCapture is not
// exposed as a rule property in KDE 6.6.x. Instead, we load a KWin script
// that sets the property directly on matching windows via the compositor.
// This module is a silent no-op on non-KDE systems.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const WM_CLASS = 'imposter'; // Must match the wmClass of our Electron windows
const SCRIPT_NAME = 'imposter_stealth';

// ── KWin Script Templates ───────────────────────────────────────────────────

/**
 * Generates a KWin script that sets excludeFromCapture on matching windows.
 * The script also hooks windowAdded so new windows (Island, Snipper) are caught.
 */
function generateStealthScript(enable) {
    const value = enable ? 'true' : 'false';
    return `
// Imposter Stealth Script — Auto-generated
// Sets excludeFromCapture on all windows with resourceClass "${WM_CLASS}"
(function() {
    function applyToWindow(w) {
        if (w.resourceClass === "${WM_CLASS}") {
            w.excludeFromCapture = ${value};
            w.skipTaskbar = ${value};
            w.skipPager = ${value};
        }
    }

    // Apply to all existing windows
    var windows = workspace.windowList();
    for (var i = 0; i < windows.length; i++) {
        applyToWindow(windows[i]);
    }

    ${enable ? `
    // Hook new windows so Island/Snipper windows are also caught
    workspace.windowAdded.connect(function(w) {
        applyToWindow(w);
    });
    ` : ''}
})();
`;
}

/**
 * Returns the path to store temporary KWin scripts.
 */
function getScriptDir() {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const dir = path.join(configHome, 'imposter');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Returns the path for the stealth KWin script file.
 */
function getScriptPath() {
    return path.join(getScriptDir(), 'stealth.js');
}

// ── KDE Detection ───────────────────────────────────────────────────────────

/**
 * Detects if the current desktop environment is KDE Plasma.
 * Returns an object with { isKde, version, supported }.
 */
function detectKdePlasma() {
    if (process.platform !== 'linux') {
        return { isKde: false, version: null, supported: false };
    }

    const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
    const sessionDesktop = (process.env.XDG_SESSION_DESKTOP || '').toLowerCase();
    const kdeVersion = process.env.KDE_SESSION_VERSION || '';

    const isKde = desktop.includes('kde') || sessionDesktop.includes('kde') ||
                  desktop.includes('plasma') || sessionDesktop.includes('plasma');

    if (!isKde) {
        return { isKde: false, version: null, supported: false };
    }

    // Try to get precise Plasma version via plasmashell
    let plasmaVersion = null;
    try {
        const output = execSync('plasmashell --version 2>/dev/null', {
            encoding: 'utf-8',
            timeout: 3000
        }).trim();
        const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (match) {
            plasmaVersion = match[1];
        }
    } catch (_) {
        if (kdeVersion) {
            plasmaVersion = kdeVersion;
        }
    }

    // ExcludeFromCapture requires KDE Plasma 6.6+
    let supported = false;
    if (plasmaVersion) {
        const parts = plasmaVersion.split('.').map(Number);
        const major = parts[0] || 0;
        const minor = parts[1] || 0;
        supported = (major > 6) || (major === 6 && minor >= 6);
    }

    return { isKde: true, version: plasmaVersion, supported };
}

// ── KWin Script Loading ─────────────────────────────────────────────────────

/**
 * Finds which qdbus command is available (qdbus6 for KDE 6, qdbus for KDE 5).
 * Returns the command name or null.
 */
function findQdbusCommand() {
    for (const cmd of ['qdbus6', 'qdbus']) {
        try {
            execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8', timeout: 2000 });
            return cmd;
        } catch (_) { /* not found */ }
    }
    return null;
}

/**
 * Unloads the imposter stealth script if it's currently loaded.
 */
function unloadStealthScript(qdbus) {
    if (!qdbus) return;

    try {
        const loaded = execSync(
            `${qdbus} org.kde.KWin /Scripting org.kde.kwin.Scripting.isScriptLoaded "${SCRIPT_NAME}" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        if (loaded === 'true') {
            execSync(
                `${qdbus} org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_NAME}" 2>/dev/null`,
                { encoding: 'utf-8', timeout: 5000 }
            );
            console.log('[KDE] Unloaded previous stealth script');
        }
    } catch (err) {
        // Script may not have been loaded — that's fine
        console.log('[KDE] No previous stealth script to unload');
    }
}

/**
 * Loads and runs a KWin script.
 * @param {string} scriptPath - Path to the .js script file
 * @param {string} qdbus - The qdbus command to use
 * @returns {boolean} true if successful
 */
function loadAndRunScript(scriptPath, qdbus) {
    try {
        // Load the script
        const scriptIdOutput = execSync(
            `${qdbus} org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${scriptPath}" "${SCRIPT_NAME}" 2>&1`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        const scriptId = parseInt(scriptIdOutput, 10);
        if (isNaN(scriptId)) {
            console.error('[KDE] Failed to load script, got:', scriptIdOutput);
            return false;
        }

        console.log(`[KDE] Script loaded with ID: ${scriptId}`);

        // Run the script
        execSync(
            `${qdbus} org.kde.KWin /Scripting/Script${scriptId} org.kde.kwin.Script.run 2>&1`,
            { encoding: 'utf-8', timeout: 5000 }
        );

        console.log('[KDE] Script executed successfully');
        return true;
    } catch (err) {
        console.error('[KDE] Script load/run failed:', err.message);
        return false;
    }
}

// ── Cache ───────────────────────────────────────────────────────────────────
let _kdeDetection = null;
let _qdbusCmd = undefined; // undefined = not checked yet, null = not found

function getKdeDetection() {
    if (_kdeDetection === null) {
        _kdeDetection = detectKdePlasma();

        if (_kdeDetection.isKde && !_kdeDetection.supported) {
            console.warn(
                `[KDE] Detected KDE Plasma ${_kdeDetection.version || 'unknown version'}. ` +
                `ExcludeFromCapture requires Plasma 6.6+. ` +
                `Stealth mode will use Electron defaults only — screen capture hiding will NOT work on this KDE version.`
            );
        } else if (_kdeDetection.isKde && _kdeDetection.supported) {
            console.log(`[KDE] Detected KDE Plasma ${_kdeDetection.version} — ExcludeFromCapture supported`);
        }
    }
    return _kdeDetection;
}

function getQdbus() {
    if (_qdbusCmd === undefined) {
        _qdbusCmd = findQdbusCommand();
        if (_qdbusCmd) {
            console.log(`[KDE] Using D-Bus tool: ${_qdbusCmd}`);
        } else {
            console.warn('[KDE] Neither qdbus6 nor qdbus found — KWin scripting unavailable');
        }
    }
    return _qdbusCmd;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns true if the current desktop is KDE Plasma (any version).
 */
function isKdePlasma() {
    return getKdeDetection().isKde;
}

/**
 * Enables or disables KDE stealth via KWin Scripting API.
 * Silent no-op on non-KDE or unsupported KDE versions.
 *
 * @param {boolean} enable - true to hide from capture, false to show
 */
function setKdeStealth(enable) {
    const detection = getKdeDetection();

    if (!detection.isKde) return;

    if (!detection.supported) {
        // Warning already logged during detection
        return;
    }

    const qdbus = getQdbus();
    if (!qdbus) return;

    try {
        // Always unload any previous instance of our script
        unloadStealthScript(qdbus);

        // Write the script to disk
        const scriptPath = getScriptPath();
        const scriptContent = generateStealthScript(enable);
        fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

        // Load and run
        const success = loadAndRunScript(scriptPath, qdbus);

        if (success) {
            console.log(`[KDE] Stealth mode ${enable ? 'ENABLED' : 'DISABLED'} — ExcludeFromCapture = ${enable}`);
        } else {
            console.error('[KDE] Failed to apply stealth mode');
        }
    } catch (err) {
        console.error('[KDE] Failed to set stealth mode:', err.message);
    }
}

/**
 * Cleanup on app exit. Disables excludeFromCapture on our windows
 * and unloads the KWin script.
 * Called from app 'will-quit' handler.
 */
function cleanupKdeRules() {
    const detection = getKdeDetection();

    if (!detection.isKde || !detection.supported) return;

    const qdbus = getQdbus();
    if (!qdbus) return;

    try {
        // Unload the persistent script so the windowAdded hook stops
        unloadStealthScript(qdbus);

        // Run a one-shot script to disable excludeFromCapture on existing windows
        const scriptPath = getScriptPath();
        const disableScript = generateStealthScript(false);
        fs.writeFileSync(scriptPath, disableScript, 'utf-8');
        loadAndRunScript(scriptPath, qdbus);

        // Clean up the script file
        try {
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
        } catch (_) { /* best effort */ }

        console.log('[KDE] Stealth cleanup complete');
    } catch (err) {
        console.error('[KDE] Cleanup error:', err.message);
    }
}

module.exports = {
    isKdePlasma,
    setKdeStealth,
    cleanupKdeRules
};
