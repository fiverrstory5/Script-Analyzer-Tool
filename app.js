// ============================================================
//  Global State
// ============================================================
let scriptData        = [];      // full dataset, set once on load
let currentAudio      = null;    // the live Audio object
let currentLineId     = null;    // ID of the line currently playing
let currentAudioType  = null;    // 'english' | 'translate' | 'meaning'
let isAutoPlayOn      = false;   // Auto-Play feature toggle
let isDrillActive     = false;   // Drill Mode running flag
let isDrillPaused     = false;   // Drill paused flag
let drillCurrentIndex = -1;      // scriptData index currently being drilled
let drillJumpTo       = null;    // set to a scriptData index to jump there
let isDrillPopupOpen  = false;   // whether the drill popup is open
let pipWindow         = null;    // Document Picture-in-Picture window reference
let isAutoPlayPaused  = false;   // Auto-Play temporarily paused flag
let currentProject    = null;    // currently selected project object


// ============================================================
//  Bootstrap
// ============================================================
document.addEventListener("DOMContentLoaded", () => { init(); });

/** Returns the correct file path for the active project. */
function _projectPath(subpath) {
    if (!currentProject || !currentProject.folder) return subpath;
    return `${currentProject.folder}/${subpath}`;
}

/** Returns a namespaced localStorage key for line progress. */
function _storageKey(lineId) {
    const prefix = currentProject
        ? currentProject.folder.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20) + '_'
        : '';
    return `${prefix}done_${lineId}`;
}

// Colour palette — auto-assigned to projects by index
const _CARD_COLORS = [
    '#3498db','#8e44ad','#16a085','#e67e22',
    '#c0392b','#27ae60','#2980b9','#d35400'
];

/**
 * Entry point.
 *
 * Priority order:
 *  1. /api/projects  — served by server.py (fully automatic folder detection)
 *  2. projects.json  — manual fallback list
 *  3. root data.json — single-project fallback (backward-compatible)
 */
async function init() {
    // ── Try auto-detect API first (server.py) ──────────────────────────
    try {
        const res = await fetch(`/api/projects?v=${Date.now()}`);
        if (res.ok) {
            const projects = await _normalise(await res.json());
            if (projects.length > 1)       { renderProjectSelector(projects); return; }
            if (projects.length === 1)     { selectProject(projects[0]);      return; }
        }
    } catch { /* server not running — fall through */ }

    // ── Fallback: projects.json ────────────────────────────────────────
    try {
        const res = await fetch(`projects.json?v=${Date.now()}`);
        if (res.ok) {
            const projects = await _normalise(await res.json());
            if (projects.length > 1)       { renderProjectSelector(projects); return; }
            if (projects.length === 1)     { selectProject(projects[0]);      return; }
        }
    } catch { /* no projects.json — fall through */ }

    // ── Final fallback: single root project ───────────────────────────
    selectProject(null);
}

/** Normalise raw project array — fills missing fields automatically. */
function _normalise(raw) {
    return (Array.isArray(raw) ? raw : []).map((p, i) => ({
        folder:      p.folder      || '',
        name:        p.name        || p.folder || 'Project ' + (i + 1),
        id:          p.id          || (p.folder || 'p' + i).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30),
        icon:        p.icon        || '📚',
        color:       p.color       || _CARD_COLORS[i % _CARD_COLORS.length],
        description: p.description || null,
    })).filter(p => p.folder); // skip entries without a folder
}



/** Build and show the project selection screen. */
function renderProjectSelector(projects) {
    const overlay = document.getElementById('project-selector-overlay');
    const grid    = document.getElementById('ps-grid');
    grid.innerHTML = '';

    projects.forEach(proj => {
        const card = document.createElement('div');
        card.className = 'ps-card';
        card.style.setProperty('--card-color', proj.color);
        card.innerHTML = `
            <div class="ps-card-icon">${proj.icon}</div>
            <div class="ps-card-name">${proj.name}</div>
            ${proj.description ? `<div class="ps-card-desc">${proj.description}</div>` : ''}
        `;
        card.addEventListener('click', () => selectProject(proj));
        grid.appendChild(card);
    });

    overlay.style.display = 'flex';
}

/** Load a project: hide selector, update UI, fetch data. */
function selectProject(proj) {
    currentProject = proj;
    document.getElementById('project-selector-overlay').style.display = 'none';

    // Show Switch Project button
    const swBtn = document.getElementById('switch-project-btn');
    if (swBtn) swBtn.style.display = proj ? 'block' : 'none';

    // Page title = project folder name
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = proj ? `🎙️ ${proj.name}` : '🎙️ Script Analyzer Tool';

    // Reset playback for new project
    stopAudio();
    scriptData = [];
    document.getElementById('script-container').innerHTML = '';
    fetchScriptData();
}

/** Re-open the project selector (Switch Project button). */
async function showProjectSelector() {
    stopAudio();

    // Try auto-detect API first, then projects.json
    let projects = [];
    try {
        const res = await fetch(`/api/projects?v=${Date.now()}`);
        if (res.ok) projects = await _normalise(await res.json());
    } catch {}

    if (!projects.length) {
        try {
            const res = await fetch(`projects.json?v=${Date.now()}`);
            if (res.ok) projects = await _normalise(await res.json());
        } catch {}
    }

    if (projects.length) renderProjectSelector(projects);
    else alert('कोई project नहीं मिला। server.py चला रहे हैं?');
}


async function fetchScriptData() {
    try {
        const timestamp = Date.now();
        const dataPath  = _projectPath('data.json');
        const response  = await fetch(`${dataPath}?v=${timestamp}`);
        scriptData      = await response.json();
        renderScript(scriptData);
    } catch (error) {
        console.error("Data load error:", error);
        document.getElementById('script-container').innerHTML =
            "<p>डेटा लोड करने में समस्या आई। क्या data.json फाइल सही जगह पर है?</p>";
    }
}


// ============================================================
//  Render
// ============================================================
function renderScript(data) {
    const container = document.getElementById('script-container');
    container.innerHTML = '';

    data.forEach(item => {
        const lineDiv     = document.createElement('div');
        lineDiv.className = 'script-line';
        lineDiv.id        = `line-${item.id}`;

        // Restore saved progress from a previous session
        if (localStorage.getItem(_storageKey(item.id)) === 'true') {
            lineDiv.classList.add('completed');
        }

        // Pass lineId + audioType to every play button so Auto-Play can track context
        lineDiv.innerHTML = `
            <div class="english-box" onclick="toggleDetails(${item.id})">
                📝 ${item.id}. ${item.english_line}
            </div>

            <div class="details-box" id="details-${item.id}">
                <p><strong>अनुवाद:</strong> ${item.hindi_translate}</p>
                <p><strong>मतलब:</strong> ${item.hindi_meaning}</p>

                <div class="audio-controls">
                    <button class="btn-eng"  onclick="playAudio('${item.id}_english.mp3',   ${item.id}, 'english')">▶ English</button>
                    <button class="btn-hin"  onclick="playAudio('${item.id}_translate.mp3', ${item.id}, 'translate')">▶ Hindi</button>
                    <button class="btn-mean" onclick="playAudio('${item.id}_meaning.mp3',   ${item.id}, 'meaning')">▶ Meaning</button>
                    <button class="btn-stop" onclick="stopAudio()">⏹️ Stop</button>
                    <button class="btn-done" onclick="toggleDone(${item.id})">✅ Done</button>
                </div>
            </div>
        `;
        container.appendChild(lineDiv);
    });
}


// ============================================================
//  Core Audio — Manual Play
//  Every manual button press routes through here.
// ============================================================
function playAudio(filename, lineId = null, audioType = null) {
    // A manual play always kills an active drill first
    if (isDrillActive) stopDrill();

    _startAudio(filename, lineId, audioType, /* attachAutoPlay = */ true);
}

/**
 * Internal audio launcher.
 * @param {boolean} attachAutoPlay  If true, wire the 'ended' event to handleAutoPlay.
 *                                  Drill mode sets this to false so it manages its
 *                                  own playback sequence via Promises.
 */
function _startAudio(filename, lineId, audioType, attachAutoPlay) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }

    currentLineId    = lineId;
    currentAudioType = audioType;

    const timestamp = Date.now();
    const audioPath = _projectPath(`audios/${filename}`);
    currentAudio    = new Audio(`${audioPath}?v=${timestamp}`);

    if (attachAutoPlay) {
        currentAudio.addEventListener('ended', handleAutoPlay, { once: true });
    }

    currentAudio.play().catch(err => console.warn("Audio play failed:", err));

    // Update PiP auto-play status whenever any audio starts
    _updateAutoPlayPiPStatus();
}

function stopAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
}


// ============================================================
//  Feature 1 — Auto-Play
// ============================================================
function toggleAutoPlay() {
    isAutoPlayOn = !isAutoPlayOn;
    if (!isAutoPlayOn) isAutoPlayPaused = false; // reset pause when turning off
    const btn = document.getElementById('autoplay-btn');
    btn.textContent = `🔁 Auto-Play: ${isAutoPlayOn ? 'ON' : 'OFF'}`;
    btn.classList.toggle('active', isAutoPlayOn);
    _updatePiPControls();
}

/**
 * Called when the current manual-play audio track ends.
 * If Auto-Play is ON, plays the same audio type for the next line.
 */
function handleAutoPlay() {
    if (!isAutoPlayOn || isAutoPlayPaused || isDrillActive || !currentLineId || !currentAudioType) return;

    const currentIndex = scriptData.findIndex(item => item.id === currentLineId);
    if (currentIndex === -1 || currentIndex + 1 >= scriptData.length) return;

    const nextItem = scriptData[currentIndex + 1];
    _startAudio(
        `${nextItem.id}_${currentAudioType}.mp3`,
        nextItem.id,
        currentAudioType,
        /* attachAutoPlay = */ true
    );
}

/** Jump Auto-Play to the previous line (same audio type). */
function autoPlayPrev() {
    if (!isAutoPlayOn) return;
    const idx = scriptData.findIndex(item => item.id === currentLineId);
    if (idx <= 0) return;
    isAutoPlayPaused = false;
    const prev = scriptData[idx - 1];
    _startAudio(`${prev.id}_${currentAudioType || 'english'}.mp3`, prev.id, currentAudioType || 'english', true);
    _updatePiPControls();
}

/** Jump Auto-Play to the next line (same audio type). */
function autoPlayNext() {
    if (!isAutoPlayOn) return;
    const idx = scriptData.findIndex(item => item.id === currentLineId);
    if (idx === -1 || idx >= scriptData.length - 1) return;
    isAutoPlayPaused = false;
    const next = scriptData[idx + 1];
    _startAudio(`${next.id}_${currentAudioType || 'english'}.mp3`, next.id, currentAudioType || 'english', true);
    _updatePiPControls();
}

/** Pause / Resume Auto-Play. */
function toggleAutoPlayPause() {
    if (!isAutoPlayOn) return;
    isAutoPlayPaused = !isAutoPlayPaused;
    if (isAutoPlayPaused) {
        stopAudio();
    } else {
        // Resume: replay the current line's audio (chain will continue from there)
        if (currentLineId && currentAudioType) {
            _startAudio(`${currentLineId}_${currentAudioType}.mp3`, currentLineId, currentAudioType, true);
        }
    }
    _updatePiPControls();
}

/** Turn Auto-Play OFF and stop audio completely. */
function stopAutoPlay() {
    isAutoPlayOn     = false;
    isAutoPlayPaused = false;
    stopAudio();
    const btn = document.getElementById('autoplay-btn');
    if (btn) {
        btn.textContent = '🔁 Auto-Play: OFF';
        btn.classList.remove('active');
    }
    _updatePiPControls();
}


// ============================================================
//  Feature 2 — Drill Mode
// ============================================================

/** Show / hide the Drill popup overlay. */
function toggleDrillPanel() {
    const overlay = document.getElementById('drill-overlay');
    isDrillPopupOpen = !isDrillPopupOpen;
    overlay.style.display = isDrillPopupOpen ? 'flex' : 'none';
    _updateDrillMiniBar();
}

// Close popup when clicking on the dark backdrop (outside the panel card)
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('drill-overlay').addEventListener('click', function(e) {
        if (e.target === this) toggleDrillPanel();
    });
});

/** Entry point: validate inputs, then run the async drill loop. */
async function startDrill() {
    if (isDrillActive) return;

    const startId = parseInt(document.getElementById('drill-start-id').value) || 1;
    const reps    = Math.max(1, parseInt(document.getElementById('drill-reps').value) || 3);

    const startIndex = scriptData.findIndex(item => item.id >= startId);
    if (startIndex === -1) {
        setDrillStatus('⚠️ Start Line ID not found in data.');
        return;
    }

    isDrillActive     = true;
    isDrillPaused     = false;
    drillJumpTo       = null;
    drillCurrentIndex = startIndex;
    _setDrillUIState(true);
    _updateDrillControls();

    let stoppedExternally = false;
    let i = startIndex;

    while (i < scriptData.length) {
        if (!isDrillActive) { stoppedExternally = true; break; }

        // --- Handle jump request (Prev / Next) ---
        if (drillJumpTo !== null) {
            i = Math.max(0, Math.min(drillJumpTo, scriptData.length - 1));
            drillJumpTo = null;
        }

        drillCurrentIndex = i;
        const item = scriptData[i];
        _highlightDrillLine(item.id);

        let jumped = false;
        for (let rep = 0; rep < reps; rep++) {
            if (!isDrillActive) { stoppedExternally = true; jumped = true; break; }
            if (drillJumpTo !== null) { jumped = true; break; }

            const statusMsg = `🎯 Line ${item.id} — Rep ${rep + 1} of ${reps}`;
            setDrillStatus(statusMsg);
            _syncMiniStatus(statusMsg);

            // 1. Play English
            await _playForDrill(`${item.id}_english.mp3`);
            if (!isDrillActive) { stoppedExternally = true; jumped = true; break; }
            if (drillJumpTo !== null) { jumped = true; break; }

            // 2. Wait if paused
            await _waitForResume();
            if (!isDrillActive) { stoppedExternally = true; jumped = true; break; }
            if (drillJumpTo !== null) { jumped = true; break; }

            // 3. Play Hindi translation
            await _playForDrill(`${item.id}_translate.mp3`);
            if (!isDrillActive) { stoppedExternally = true; jumped = true; break; }
            if (drillJumpTo !== null) { jumped = true; break; }

            // 4. Wait if paused
            await _waitForResume();
            if (!isDrillActive) { stoppedExternally = true; jumped = true; break; }
            if (drillJumpTo !== null) { jumped = true; break; }
        }

        if (!isDrillActive) { stoppedExternally = true; break; }
        if (!jumped) i++; // advance only when no jump occurred
    }

    // --- Cleanup ---
    _clearDrillHighlight();
    isDrillActive     = false;
    isDrillPaused     = false;
    drillCurrentIndex = -1;
    drillJumpTo       = null;
    _setDrillUIState(false);
    _updateDrillControls();

    if (!stoppedExternally) {
        setDrillStatus('✅ Drill complete!');
        _syncMiniStatus('✅ Done!');
    }
}

/** Pause / resume the drill. */
function togglePauseDrill() {
    if (!isDrillActive) return;
    isDrillPaused = !isDrillPaused;
    if (isDrillPaused) {
        stopAudio(); // pausing audio lets _playForDrill resolve; _waitForResume will hold the loop
    }
    _updateDrillControls();
}

/**
 * Jump to prev (-1) or next (+1) line.
 * Sets drillJumpTo which is checked after each await inside the loop.
 */
function jumpDrill(direction) {
    if (!isDrillActive) return;
    const target = Math.max(0, Math.min(drillCurrentIndex + direction, scriptData.length - 1));
    drillJumpTo   = target;
    isDrillPaused = false; // unblock _waitForResume if currently paused
    stopAudio();           // resolve the current _playForDrill promise immediately
    _updateDrillControls();
}

/** Abort the drill completely. */
function stopDrill() {
    isDrillActive = false;
    isDrillPaused = false;
    drillJumpTo   = null;
    stopAudio();
    _clearDrillHighlight();
    _setDrillUIState(false);
    _updateDrillControls();
    setDrillStatus('⏹ Drill stopped.');
    _syncMiniStatus('⏹ Stopped');
}

/**
 * Polling wait: holds the drill loop while isPaused.
 * Exits immediately when resumed, stopped, or a jump is requested.
 */
async function _waitForResume() {
    while (isDrillPaused && isDrillActive && drillJumpTo === null) {
        await new Promise(r => setTimeout(r, 80));
    }
}

/**
 * Promise-based audio player for the drill loop.
 * Resolves when the track ends naturally OR when .pause() is called.
 */
function _playForDrill(filename) {
    return new Promise((resolve) => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
        }

        const timestamp = Date.now();
        const audioPath = _projectPath(`audios/${filename}`);
        currentAudio    = new Audio(`${audioPath}?v=${timestamp}`);

        currentAudio.addEventListener('ended', resolve, { once: true });
        currentAudio.addEventListener('pause', resolve, { once: true });
        currentAudio.play().catch(resolve);
    });
}

/** Sync all drill-related UI elements (popup + mini bar). */
function _updateDrillControls() {
    const running = isDrillActive;

    // Show / hide playback controls inside popup
    const playbackDiv = document.getElementById('drill-playback-controls');
    if (playbackDiv) playbackDiv.style.display = running ? 'block' : 'none';

    // Pause button text (popup)
    const pauseBtn = document.getElementById('drill-pause-btn');
    if (pauseBtn) {
        pauseBtn.textContent = isDrillPaused ? '▶ Resume' : '⏸ Pause';
        pauseBtn.classList.toggle('resumed', isDrillPaused);
    }

    // Pause button text (mini bar)
    const miniPauseBtn = document.getElementById('floating-pause-btn');
    if (miniPauseBtn) {
        miniPauseBtn.textContent = isDrillPaused ? '▶' : '⏸';
        miniPauseBtn.classList.toggle('mini-pause-active', isDrillPaused);
    }

    _updateDrillMiniBar();
    _updatePiPControls();
}

/** Show the mini bar only when drill is active AND popup is closed. */
function _updateDrillMiniBar() {
    const miniBar = document.getElementById('floating-drill-mini');
    if (miniBar) {
        miniBar.style.display = (isDrillActive && !isDrillPopupOpen) ? 'flex' : 'none';
    }
}

/** Update status text in popup, mini bar, and PiP window. */
function _syncMiniStatus(msg) {
    const el = document.getElementById('floating-drill-status');
    if (el) el.textContent = msg;
    _updatePiPStatus(msg);
}

/** Adds the visual highlight ring and scrolls the card into view. */
function _highlightDrillLine(id) {
    _clearDrillHighlight();
    const lineDiv    = document.getElementById(`line-${id}`);
    const detailsBox = document.getElementById(`details-${id}`);
    if (!lineDiv) return;

    lineDiv.classList.add('drill-active');
    detailsBox.style.display = 'block';
    lineDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _clearDrillHighlight() {
    document.querySelectorAll('.drill-active')
            .forEach(el => el.classList.remove('drill-active'));
}

function _setDrillUIState(active) {
    document.getElementById('btn-start-drill').disabled = active;
    document.getElementById('btn-stop-drill').disabled  = !active;
}

function setDrillStatus(msg) {
    document.getElementById('drill-status').textContent = msg;
    _updatePiPStatus(msg);
}


// ============================================================
//  Feature 3 — Document Picture-in-Picture (Pop Out)
// ============================================================

/**
 * Opens a Document PiP window that floats above all browser tabs.
 * Supported in Chrome 116+.
 */
async function openPiP() {
    if (!('documentPictureInPicture' in window)) {
        alert('⚠️ यह feature Chrome 116+ में काम करता है।\nकृपया Chrome browser update करें।');
        return;
    }

    // If already open, just refresh its content
    if (pipWindow && !pipWindow.closed) {
        _renderPiPContent();
        return;
    }

    try {
        pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 300,
            height: 290,
        });

        _renderPiPContent();

        // When user closes the PiP window
        pipWindow.addEventListener('pagehide', () => {
            pipWindow = null;
            _updatePiPButton();
        });

        _updatePiPButton();

    } catch (err) {
        // NotAllowedError = user dismissed, ignore silently
        if (err.name !== 'NotAllowedError') {
            console.warn('PiP error:', err);
        }
    }
}

/** Builds / rebuilds the PiP window's HTML content. */
function _renderPiPContent() {
    if (!pipWindow || pipWindow.closed) return;
    const doc = pipWindow.document;

    doc.head.innerHTML = '';
    doc.body.innerHTML = '';

    const style = doc.createElement('style');
    style.textContent = `
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, sans-serif;
            background: linear-gradient(145deg, #0f0221 0%, #2d1b4e 100%);
            color: #fff;
            padding: 14px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            gap: 9px;
            user-select: none;
            overflow: hidden;
        }
        .pip-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 10px;
            font-weight: 700;
            color: #c39bd3;
            letter-spacing: 1.2px;
            text-transform: uppercase;
        }
        .pip-dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: #555; flex-shrink: 0; transition: background 0.3s;
        }
        .pip-dot.drill-on  { background:#2ecc71; box-shadow:0 0 6px #2ecc71; animation:blink 1.4s ease-in-out infinite; }
        .pip-dot.drill-pause { background:#e67e22; box-shadow:0 0 6px #e67e22; }
        .pip-dot.auto-on   { background:#3498db; box-shadow:0 0 6px #3498db; animation:blink 2s ease-in-out infinite; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

        /* --- Auto-Play row --- */
        .pip-autoplay-row {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 8px 12px;
        }
        .pip-autoplay-label {
            font-size: 10px; font-weight:700; color:#a0a0b0;
            letter-spacing:.8px; text-transform:uppercase; flex:1;
        }
        #pip-autoplay-btn {
            flex: none;
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: #fff; font-size: 12px; font-weight:700;
            cursor:pointer; transition: all 0.15s;
        }
        #pip-autoplay-btn.on {
            background: rgba(52,152,219,0.7);
            border-color: rgba(52,152,219,0.5);
            box-shadow: 0 0 8px rgba(52,152,219,0.4);
        }
        #pip-autoplay-btn:hover { opacity:0.85; }

        /* --- Divider --- */
        .pip-divider {
            height: 1px; background: rgba(255,255,255,0.08); flex-shrink:0;
        }

        /* --- Drill section --- */
        .pip-section-label {
            font-size: 10px; font-weight:700; color:#a0a0b0;
            letter-spacing:.8px; text-transform:uppercase; margin-bottom:6px;
        }
        .pip-status {
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px; padding: 7px 10px;
            font-size: 12px; font-weight:600; text-align:center;
            margin-bottom: 7px;
        }
        .pip-btns { display:flex; gap:6px; }
        button {
            flex:1; padding:9px 4px;
            border:1px solid rgba(255,255,255,0.18); border-radius:8px;
            cursor:pointer; font-size:15px; font-weight:700; color:#fff;
            background:rgba(255,255,255,0.10); transition:background .15s,transform .12s;
        }
        button:hover { background:rgba(255,255,255,0.22); transform:translateY(-1px); }
        button:active { transform:scale(0.95); }
        #pip-pause { background:rgba(230,126,34,.60); border-color:rgba(230,126,34,.5); }
        #pip-pause.paused { background:rgba(46,204,113,.60); border-color:rgba(46,204,113,.5); }
        #pip-stop  { background:rgba(192,57,43,.60);  border-color:rgba(192,57,43,.5);  }

        /* --- Section box (Auto-Play container) --- */
        .pip-section-box {
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 9px 12px;
        }
        .pip-section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        #pip-autoplay-btn {
            flex: none;
            padding: 5px 14px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: #fff; font-size: 12px; font-weight:700;
            cursor:pointer; transition: all 0.15s;
        }
        #pip-autoplay-btn.on {
            background: rgba(52,152,219,0.75);
            border-color: rgba(52,152,219,0.5);
            box-shadow: 0 0 8px rgba(52,152,219,0.35);
        }
        #pip-autoplay-btn:hover { opacity:0.85; }
        #pip-ap-pause { background:rgba(230,126,34,.60); border-color:rgba(230,126,34,.5); }
        #pip-ap-pause.ap-paused { background:rgba(46,204,113,.60); border-color:rgba(46,204,113,.5); }
        #pip-ap-stop  { background:rgba(192,57,43,.60);  border-color:rgba(192,57,43,.5);  }

        /* --- Idle hint --- */
        .pip-idle {
            font-size:11px; color:rgba(255,255,255,0.32); text-align:center; padding:2px;
        }
    `;
    doc.head.appendChild(style);

    const drillStatusText = document.getElementById('drill-status').textContent || '';
    const bothInactive    = !isDrillActive && !isAutoPlayOn;

    doc.body.innerHTML = `
        <div class="pip-header">
            <div class="pip-dot ${_pipDotClass()}" id="pip-dot"></div>
            Script Analyzer
        </div>

        <!-- ====== Auto-Play Section (always visible) ====== -->
        <div class="pip-section-box">
            <div class="pip-section-header">
                <span class="pip-section-label">🔁 Auto-Play</span>
                <button id="pip-autoplay-btn" class="${isAutoPlayOn ? 'on' : ''}">
                    ${isAutoPlayOn ? 'ON' : 'OFF'}
                </button>
            </div>
            <!-- Now-playing status: shown when auto-play is active -->
            <div id="pip-ap-status" style="
                display:${(isAutoPlayOn && currentLineId) ? 'block' : 'none'};
                font-size:12px; font-weight:600; color:#7fb3d3;
                margin-top:7px; text-align:center; letter-spacing:0.3px;
            ">${(isAutoPlayOn && currentLineId) ? `🔁 Line ${currentLineId}  ·  ${{english:'English',translate:'Hindi',meaning:'Meaning'}[currentAudioType]||''}` : ''}</div>
            <!-- Playback controls: show only when auto-play is ON -->
            <div id="pip-ap-controls" class="pip-btns" style="display:${isAutoPlayOn ? 'flex' : 'none'}; margin-top:8px;">
                <button id="pip-ap-prev" title="Prev Line">⏮</button>
                <button id="pip-ap-pause" class="${isAutoPlayPaused ? 'ap-paused' : ''}" title="Pause/Resume">
                    ${isAutoPlayPaused ? '▶' : '⏸'}
                </button>
                <button id="pip-ap-next" title="Next Line">⏭</button>
                <button id="pip-ap-stop" title="Stop Auto-Play">⏹</button>
            </div>
        </div>


        <div class="pip-divider"></div>

        <!-- ====== Drill Section (only when drill is running) ====== -->
        <div id="pip-drill-section" style="display:${isDrillActive ? 'block' : 'none'}">
            <div class="pip-section-label">🎯 Drill Mode</div>
            <div class="pip-status" id="pip-status">${drillStatusText || '🎯 Drilling...'}</div>
            <div class="pip-btns">
                <button id="pip-prev" title="Prev Line">⏮</button>
                <button id="pip-pause" class="${isDrillPaused ? 'paused' : ''}" title="Pause/Resume">
                    ${isDrillPaused ? '▶' : '⏸'}
                </button>
                <button id="pip-next" title="Next Line">⏭</button>
                <button id="pip-stop" title="Stop">⏹</button>
            </div>
        </div>

        <!-- Idle hint when both are off -->
        <div class="pip-idle" id="pip-idle" style="display:${bothInactive ? 'block' : 'none'}">
            Auto-Play या Drill शुरू करें
        </div>
    `;

    // --- Auto-Play event listeners ---
    doc.getElementById('pip-autoplay-btn').addEventListener('click', () => toggleAutoPlay());
    doc.getElementById('pip-ap-prev').addEventListener('click',      () => autoPlayPrev());
    doc.getElementById('pip-ap-pause').addEventListener('click',     () => toggleAutoPlayPause());
    doc.getElementById('pip-ap-next').addEventListener('click',      () => autoPlayNext());
    doc.getElementById('pip-ap-stop').addEventListener('click',      () => stopAutoPlay());
    // --- Drill event listeners ---
    doc.getElementById('pip-prev').addEventListener('click',  () => jumpDrill(-1));
    doc.getElementById('pip-pause').addEventListener('click', () => togglePauseDrill());
    doc.getElementById('pip-next').addEventListener('click',  () => jumpDrill(1));
    doc.getElementById('pip-stop').addEventListener('click',  () => stopDrill());
}

/** Update the status text inside the PiP window. */
function _updatePiPStatus(msg) {
    if (!pipWindow || pipWindow.closed) return;
    const statusEl = pipWindow.document.getElementById('pip-status');
    if (statusEl) statusEl.textContent = msg || '';
    _updatePiPDot();
}

/** Sync all interactive elements inside the PiP window. */
function _updatePiPControls() {
    if (!pipWindow || pipWindow.closed) return;
    const doc = pipWindow.document;

    // --- Auto-Play toggle button ---
    const autoBtn = doc.getElementById('pip-autoplay-btn');
    if (autoBtn) {
        autoBtn.textContent = isAutoPlayOn ? 'ON' : 'OFF';
        autoBtn.classList.toggle('on', isAutoPlayOn);
    }

    // --- Auto-Play playback controls (show only when ON) ---
    const apControls = doc.getElementById('pip-ap-controls');
    if (apControls) apControls.style.display = isAutoPlayOn ? 'flex' : 'none';

    // --- Auto-Play pause button ---
    const apPauseBtn = doc.getElementById('pip-ap-pause');
    if (apPauseBtn) {
        apPauseBtn.textContent = isAutoPlayPaused ? '▶' : '⏸';
        apPauseBtn.classList.toggle('ap-paused', isAutoPlayPaused);
    }

    // --- Drill section visibility ---
    const drillSection = doc.getElementById('pip-drill-section');
    const idleDiv      = doc.getElementById('pip-idle');
    if (drillSection) drillSection.style.display = isDrillActive ? 'block' : 'none';
    if (idleDiv)      idleDiv.style.display       = (!isDrillActive && !isAutoPlayOn) ? 'block' : 'none';

    // --- Drill pause button ---
    const pauseBtn = doc.getElementById('pip-pause');
    if (pauseBtn) {
        pauseBtn.textContent = isDrillPaused ? '▶' : '⏸';
        pauseBtn.classList.toggle('paused', isDrillPaused);
    }

    _updatePiPDot();
    _updateAutoPlayPiPStatus();
}

/** Returns the correct CSS class string for the PiP dot. */
function _pipDotClass() {
    if (isDrillActive) return isDrillPaused ? 'drill-pause' : 'drill-on';
    if (isAutoPlayOn)  return 'auto-on';
    return '';
}

/** Update the "now playing" status line in the PiP Auto-Play section. */
function _updateAutoPlayPiPStatus() {
    if (!pipWindow || pipWindow.closed) return;
    const el = pipWindow.document.getElementById('pip-ap-status');
    if (!el) return;
    const typeMap = { english: 'English', translate: 'Hindi', meaning: 'Meaning' };
    if (isAutoPlayOn && currentLineId) {
        el.textContent = `🔁 Line ${currentLineId}  ·  ${typeMap[currentAudioType] || ''}`;
        el.style.display = 'block';
    } else {
        el.textContent = '';
        el.style.display = 'none';
    }
}

/** Sync the status indicator dot colour. */
function _updatePiPDot() {
    if (!pipWindow || pipWindow.closed) return;
    const dot = pipWindow.document.getElementById('pip-dot');
    if (dot) dot.className = 'pip-dot ' + _pipDotClass();
}

/** Update the Pop Out button label / style in the main page. */
function _updatePiPButton() {
    // Floating controls button
    const btn = document.getElementById('pip-open-btn');
    if (btn) {
        const isOpen = pipWindow && !pipWindow.closed;
        btn.textContent = isOpen ? '📺 Pop Out: ON' : '📺 Pop Out';
        btn.classList.toggle('pip-on', isOpen);
    }
    // Popup header button
    const popupBtn = document.getElementById('pip-popup-btn');
    if (popupBtn) {
        const isOpen = pipWindow && !pipWindow.closed;
        popupBtn.style.background = isOpen ? '#1abc9c' : '#16a085';
    }
}


// ============================================================
//  Progress Tracking (unchanged logic)
// ============================================================
function toggleDetails(id) {
    const detailsBox = document.getElementById(`details-${id}`);
    detailsBox.style.display = (detailsBox.style.display === 'block') ? 'none' : 'block';
}

function toggleDone(id) {
    const lineDiv = document.getElementById(`line-${id}`);
    lineDiv.classList.toggle('completed');

    if (lineDiv.classList.contains('completed')) {
        localStorage.setItem(_storageKey(id), 'true');
    } else {
        localStorage.removeItem(_storageKey(id));
    }

    document.getElementById(`details-${id}`).style.display = 'none';
}

function clearProgress() {
    if (confirm("क्या आप सच में इस प्रोजेक्ट की सारी प्रोग्रेस रीसेट करना चाहते हैं?")) {
        if (currentProject && currentProject.id !== 'default') {
            // Clear only this project's keys
            const prefix = `${currentProject.id}_done_`;
            Object.keys(localStorage)
                .filter(k => k.startsWith(prefix))
                .forEach(k => localStorage.removeItem(k));
        } else {
            // Default project — clear done_ keys only
            Object.keys(localStorage)
                .filter(k => k.startsWith('done_'))
                .forEach(k => localStorage.removeItem(k));
        }
        location.reload();
    }
}