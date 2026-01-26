// ========== CONFIGURATION ==========
const API_BASE = 'http://188.40.97.126:8080';

const TONES = {
  native: { name: 'Muttersprachlich', color: '#f97316', desc: 'native orange muttersprachlich' },
  private: { name: 'Privat', color: '#ef4444', desc: 'privat rot liebevoll' },
  formal: { name: 'Formell', color: '#3b82f6', desc: 'formell blau geschäftlich' },
  coach: { name: 'Coach', color: '#eab308', desc: 'coach lerncoach gelb' },
  casual: { name: 'Coach', color: '#eab308', desc: 'coach lerncoach gelb' },  // Alias
  friendly: { name: 'Coach', color: '#eab308', desc: 'coach lerncoach gelb' },  // Alias
  learning: { name: 'Learning', color: '#8b5cf6', desc: 'learning violett' },
  smartklick: { name: 'Smartklick', color: '#06b6d4', desc: 'smartklick agent assistent' }
};

const LANGUAGES = ['', 'de', 'en', 'fr', 'es', 'it', 'da', 'tr'];
const LANGUAGE_LABELS = { '': '—', de: 'DE', en: 'EN', fr: 'FR', es: 'ES', it: 'IT', da: 'DA', tr: 'TR' };

// ========== STATE ==========
let state = {
  viewMode: 'compact',
  currentTone: 'native',
  currentLanguage: '',
  isRecording: false,
  isProcessing: false,
  mediaRecorder: null,
  audioChunks: [],
  settings: {},
  wakeWordEnabled: false,
  wakeWordState: 'off'  // off, on, listening, processing
};

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings from Electron
  if (window.electronAPI) {
    state.settings = await window.electronAPI.getSettings();
    state.viewMode = state.settings.view_mode || 'compact';
    state.currentTone = state.settings.last_tone || 'native';
    state.currentLanguage = state.settings.last_language || '';
  }

  // Show correct mode
  showViewMode(state.viewMode);

  // Setup all event listeners
  setupMicButtons();
  setupToneButtons();
  setupLanguageButtons();
  setupSettingsButtons();
  setupPanelButtons();
  setupGoogleIntegration();
  setupDockingListeners();

  // Listen for Electron events
  if (window.electronAPI) {
    window.electronAPI.onViewModeChanged((mode) => {
      state.viewMode = mode;
      showViewMode(mode);
    });

    window.electronAPI.onHotkeyPressed(() => {
      toggleRecording();
    });

    // Google Auth status change
    if (window.electronAPI.google) {
      window.electronAPI.google.onAuthChanged((data) => {
        updateGoogleUI(data.connected, data.user);
      });
    }

    // Wake Word DISABLED - removed from app
    // setupWakeWordListeners();
    // Wake word toggle removed from UI

    // Click-through for transparent areas
    setupClickThrough();
  }

  console.log('Smartklick Desktop initialized');
});

// ========== CLICK-THROUGH FOR TRANSPARENT AREAS ==========
function setupClickThrough() {
  if (!window.electronAPI || !window.electronAPI.setIgnoreMouseEvents) return;

  // Elements that should receive mouse events (not click-through)
  const interactiveSelectors = [
    '.mini-pill', '.compact-window', '.normal-window',
    '.side-panel', '.panel-header', '.panel-content',
    'button', 'input', 'select', '.text-box',
    '.tone-btn', '.lang-btn', '.mic-btn', '.action-btn',
    '.settings-item', '.note-card', '.calendar-event',
    '.month-day.has-events', '.week-day-row'
  ];

  document.addEventListener('mousemove', (e) => {
    // Check if mouse is over any interactive element
    const isOverInteractive = interactiveSelectors.some(selector => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el && (el.matches(selector) || el.closest(selector));
    });

    if (isOverInteractive) {
      // Mouse is over interactive element - receive events
      window.electronAPI.setIgnoreMouseEvents(false);
    } else {
      // Mouse is over transparent area - pass through clicks
      window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // When mouse leaves the window, reset to allow events
  document.addEventListener('mouseleave', () => {
    window.electronAPI.setIgnoreMouseEvents(false);
  });
}

// ========== VIEW MODE ==========
const VIEW_MODES = ['mini', 'compact', 'normal'];

function cycleViewMode() {
  const currentIndex = VIEW_MODES.indexOf(state.viewMode);
  const nextIndex = (currentIndex + 1) % VIEW_MODES.length;
  const nextMode = VIEW_MODES[nextIndex];

  if (window.electronAPI) {
    window.electronAPI.changeViewMode(nextMode);
  }
}

function showViewMode(mode) {
  // Hide all modes
  document.getElementById('mini-mode').classList.add('hidden');
  document.getElementById('compact-mode').classList.add('hidden');
  document.getElementById('normal-mode').classList.add('hidden');

  // Handle special panel mode - show normal mode when panel is open
  const displayMode = (mode === 'normal_with_panel') ? 'normal' : mode;

  // Show selected mode
  document.getElementById(`${displayMode}-mode`).classList.remove('hidden');

  // Update active state in view selectors
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === displayMode);
  });

  // Update tone and language UI
  updateToneUI();
  updateLanguageUI();
}

// ========== MIC BUTTONS ==========
function setupMicButtons() {
  const micButtons = [
    document.getElementById('mini-mic-btn'),
    document.getElementById('compact-mic-btn'),
    document.getElementById('normal-mic-btn')
  ];

  micButtons.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', toggleRecording);
    }
  });
}

// ========== DOCKING LISTENERS ==========
function setupDockingListeners() {
  // Mic click from dock bar
  document.addEventListener('dock-mic-clicked', () => {
    toggleRecording();
    // Note: setMicState in toggleRecording already updates dock state
  });

  // Mode change from dock bar
  document.addEventListener('dock-mode-changed', (e) => {
    const mode = e.detail.mode;
    if (mode) {
      setTone(mode);
    }
  });

  // Language change from dock bar
  document.addEventListener('dock-lang-changed', (e) => {
    const lang = e.detail.lang;
    setLanguage(lang);
  });

  // Screen Reading from dock bar (A button)
  document.addEventListener('dock-screen-read-clicked', () => {
    if (typeof startScreenReading === 'function') {
      startScreenReading();
    }
  });

  // Notes from dock bar - oeffnet Notizen im Fullscreen
  document.addEventListener('dock-notes-clicked', () => {
    if (window.electronAPI?.notes?.openWebview) {
      window.electronAPI.notes.openWebview();
      console.log('[App] Notes Fullscreen geoeffnet');
    }
  });

  // Email from dock bar - oeffnet E-Mail Fenster
  document.addEventListener('dock-email-clicked', () => {
    if (window.electronAPI?.email?.openWindow) {
      window.electronAPI.email.openWindow();
      console.log('[App] Email Fenster geoeffnet');
    }
  });

  // Calendar from dock bar - oeffnet Kalender Fenster
  document.addEventListener('dock-calendar-clicked', () => {
    if (window.electronAPI?.calendar?.openWindow) {
      window.electronAPI.calendar.openWindow();
      console.log('[App] Kalender Fenster geoeffnet');
    }
  });
}

async function toggleRecording() {
  if (state.isProcessing) return;

  if (state.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    state.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      await processRecording();
    };

    state.mediaRecorder.start();
    state.isRecording = true;

    // Update UI
    setMicState('recording');

    // Cursor Feedback: DEAKTIVIERT - verursacht Probleme
    // TODO: Später richtig implementieren
    // try {
    //   if (window.electronAPI?.cursorFeedback) {
    //     await window.electronAPI.cursorFeedback.showRecording();
    //   }
    // } catch (err) {
    //   console.error('CursorFeedback showRecording error:', err);
    // }

    console.log('Recording started');
  } catch (error) {
    console.error('Error starting recording:', error);
    alert('Mikrofon-Zugriff verweigert. Bitte Berechtigung erteilen.');
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    setMicState('processing');
    console.log('Recording stopped');
  }
}

async function processRecording() {
  state.isProcessing = true;

  try {
    const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
    const base64Audio = await blobToBase64(audioBlob);

    console.log('=== PROCESSING RECORDING ===');
    console.log('Audio blob size:', audioBlob.size);

    // Prepare request body
    const isSmartklickMode = state.currentTone === 'smartklick';
    const body = {
      audio: base64Audio,
      audioFormat: 'webm',
      language: 'auto',
      cleanupLevel: 'full',
      style: { description: TONES[state.currentTone].desc },
      learningMode: state.currentTone === 'learning',
      // Smartklick AI Assistant
      // jarvisEnabled = IMMER true (für Keyword-Erkennung "Smartklick ... Smartklick Ende")
      // jarvisDirectMode = nur wenn Smartklick-Tonalität ausgewählt (alles ist ein Befehl)
      jarvisEnabled: true,
      jarvisDirectMode: isSmartklickMode,
      jarvisStartKeyword: 'Smartklick',
      jarvisEndKeyword: 'Smartklick Ende'
    };

    if (state.currentLanguage) {
      body.translateTo = state.currentLanguage;
    }

    console.log('Sending request - Tone:', state.currentTone, 'Smartklick:', isSmartklickMode);

    // Send to server
    const response = await fetch(`${API_BASE}/transcribe/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(body)
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      console.error('Server error:', response.status, response.statusText);
      // Cursor Feedback abbrechen bei Fehler
      if (window.electronAPI?.cursorFeedback) {
        await window.electronAPI.cursorFeedback.cancel();
      }
      setMicState('idle');
      state.isProcessing = false;
      return;
    }

    // Parse SSE response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = { original: '', corrected: '', errors: [] };
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      fullResponse += text;
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            const data = JSON.parse(jsonStr);
            console.log('SSE phase:', data.phase, 'data:', data);

            if (data.phase === 'transcribed') {
              result.original = data.rawText || data.text || '';
              console.log('Got original text:', result.original);
            } else if (data.phase === 'done' || data.phase === 'cleaned') {
              result.corrected = data.cleanedText || data.text || data.result || '';
              console.log('Got corrected text:', result.corrected);

              // Extract error info if learning mode
              if (data.learningAnalysis && data.learningAnalysis.errors) {
                result.errors = data.learningAnalysis.errors;
                // Also use original/corrected from learningAnalysis if available
                if (data.learningAnalysis.originalText) {
                  result.original = data.learningAnalysis.originalText;
                }
                if (data.learningAnalysis.correctedText) {
                  result.corrected = data.learningAnalysis.correctedText;
                }
                console.log('Learning analysis errors:', result.errors.length);
              } else if (data.learningCorrections) {
                result.errors = data.learningCorrections;
              }
            }
          } catch (e) {
            console.log('Parse error:', e.message, 'Line:', line);
          }
        }
      }
    }

    console.log('=== FINAL RESULT ===');
    console.log('Original:', result.original);
    console.log('Corrected:', result.corrected);
    console.log('Full response:', fullResponse);

    // Handle result
    handleTranscriptionResult(result);

  } catch (error) {
    console.error('Error processing recording:', error);
    // Cursor Feedback abbrechen bei Fehler
    if (window.electronAPI?.cursorFeedback) {
      await window.electronAPI.cursorFeedback.cancel();
    }
    setMicState('idle');
  }

  state.isProcessing = false;
}

function handleTranscriptionResult(result) {
  const text = result.corrected || result.original;

  console.log('=== HANDLE TRANSCRIPTION RESULT ===');
  console.log('Original:', result.original);
  console.log('Corrected:', result.corrected);
  console.log('Using text:', text);
  console.log('Current tone:', state.currentTone);

  if (!text) {
    console.log('ERROR: No text received!');
    // Cursor Feedback abbrechen wenn kein Text
    if (window.electronAPI?.cursorFeedback) {
      window.electronAPI.cursorFeedback.cancel();
    }
    setMicState('idle');
    return;
  }

  // GOOGLE ACTION: Handle special commands from server
  if (text.includes('__GOOGLE_ACTION__:')) {
    const match = text.match(/__GOOGLE_ACTION__:(\w+)/);
    if (match) {
      const action = match[1];
      console.log('Google Action detected:', action);
      // Cursor Feedback abbrechen bei Aktionen (kein Text wird eingefügt)
      if (window.electronAPI?.cursorFeedback) {
        window.electronAPI.cursorFeedback.cancel();
      }
      handleGoogleAction(action);
      setMicState('success');
      setTimeout(() => setMicState('idle'), 1500);
      return;
    }
  }

  // NOTES ACTION: Handle notes commands from server
  if (text.includes('__NOTES_ACTION__:')) {
    const match = text.match(/__NOTES_ACTION__:(\w+)(?::(.+))?/);
    if (match) {
      const action = match[1];
      const query = match[2] || null;
      console.log('Notes Action detected:', action, query);
      if (window.electronAPI?.cursorFeedback) {
        window.electronAPI.cursorFeedback.cancel();
      }
      handleNotesAction(action, query);
      setMicState('success');
      setTimeout(() => setMicState('idle'), 1500);
      return;
    }
  }

  // NOTES SAVE: Save note via voice command
  if (text.includes('__NOTES_SAVE__:')) {
    const match = text.match(/__NOTES_SAVE__:(.+)/);
    if (match) {
      const content = match[1].trim();
      console.log('Notes Save detected:', content);
      if (window.electronAPI?.cursorFeedback) {
        window.electronAPI.cursorFeedback.cancel();
      }
      handleNotesSave(content);
      setMicState('success');
      setTimeout(() => setMicState('idle'), 1500);
      return;
    }
  }

  // SCREENSHOT NOTE: Capture screen and save as note
  if (text.includes('__SCREENSHOT_NOTE__')) {
    console.log('Screenshot to Note triggered');
    if (window.electronAPI?.cursorFeedback) {
      window.electronAPI.cursorFeedback.cancel();
    }
    handleScreenshotNote();
    setMicState('success');
    setTimeout(() => setMicState('idle'), 1500);
    return;
  }

  // ANALYZE PAGE NOTE: Show animation AND save to notes
  if (text.includes('__ANALYZE_PAGE_NOTE__')) {
    console.log('Page Analysis to Note triggered');
    if (window.electronAPI?.cursorFeedback) {
      window.electronAPI.cursorFeedback.cancel();
    }
    handleAnalyzePageNoteWithAnimation();  // Animation + save to notes
    setMicState('success');
    setTimeout(() => setMicState('idle'), 1500);
    return;
  }

  // CALENDAR CREATE: Create event via voice command
  if (text.includes('__CALENDAR_CREATE__:')) {
    const match = text.match(/__CALENDAR_CREATE__:(.+)/);
    if (match) {
      const eventText = match[1].trim();
      console.log('Calendar Create detected:', eventText);
      if (window.electronAPI?.cursorFeedback) {
        window.electronAPI.cursorFeedback.cancel();
      }
      handleCalendarCreate(eventText);
      setMicState('success');
      setTimeout(() => setMicState('idle'), 1500);
      return;
    }
  }

  // Always insert/copy text first (regardless of mode)
  const shouldAutoInsert = state.settings?.auto_insert !== false;
  if (shouldAutoInsert) {
    console.log('Calling insertText with:', text);
    insertText(text);
  } else {
    console.log('Copying to clipboard instead');
    copyToClipboard(text);
  }

  // Learning mode: ALSO show correction panel as add-on
  if (state.currentTone === 'learning') {
    console.log('Learning mode - showing correction panel as add-on');
    // Switch to normal mode if not already there (panel only works in normal)
    if (state.viewMode !== 'normal') {
      if (window.electronAPI) {
        window.electronAPI.changeViewMode('normal');
      }
      // Wait for mode change then show panel
      setTimeout(() => showCorrectionPanel(result), 300);
    } else {
      showCorrectionPanel(result);
    }
  }

  setMicState('success');
  setTimeout(() => setMicState('idle'), 1500);
}

function setMicState(stateType) {
  const micButtons = document.querySelectorAll('.mic-button');

  micButtons.forEach(btn => {
    btn.classList.remove('idle', 'recording', 'processing', 'success');
    btn.classList.add(stateType);
  });

  // Update dock mic button with state string
  if (window.dockingManager) {
    // Map stateType to dock states: 'idle', 'recording', 'processing'
    const dockState = (stateType === 'recording') ? 'recording' :
                      (stateType === 'processing') ? 'processing' : 'idle';
    window.dockingManager.setRecordingState(dockState);
  }

  // Update labels based on state
  const micLabel = document.getElementById('mic-label') || document.querySelector('.mic-label');
  const tapLabel = document.querySelector('.tap-label');

  const labels = {
    idle: { mic: 'Klicken zum Aufnehmen', tap: 'Tippen zum Sprechen' },
    recording: { mic: 'Klicken zum Stoppen', tap: 'Tippen zum Stoppen' },
    processing: { mic: 'Text wird verarbeitet...', tap: 'Verarbeite...' },
    success: { mic: 'Fertig!', tap: 'Fertig!' }
  };

  if (micLabel && labels[stateType]) {
    micLabel.textContent = labels[stateType].mic;
  }
  if (tapLabel && labels[stateType]) {
    tapLabel.textContent = labels[stateType].tap;
  }
}

// ========== TONE BUTTONS ==========
function setupToneButtons() {
  // Mini mode tone button (cycles through)
  const miniToneBtn = document.getElementById('mini-tone-btn');
  if (miniToneBtn) {
    miniToneBtn.addEventListener('click', cycleTone);
  }

  // Compact mode tone button
  const compactToneBtn = document.getElementById('compact-tone-btn');
  if (compactToneBtn) {
    compactToneBtn.addEventListener('click', cycleTone);
  }

  // Normal mode tone dots
  document.querySelectorAll('.tone-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      setTone(dot.dataset.tone);
    });
  });
}

function cycleTone() {
  const tones = Object.keys(TONES);
  const currentIndex = tones.indexOf(state.currentTone);
  const nextIndex = (currentIndex + 1) % tones.length;
  setTone(tones[nextIndex]);
}

function setTone(tone) {
  state.currentTone = tone;
  updateToneUI();

  // Save to settings
  if (window.electronAPI) {
    window.electronAPI.setSetting('last_tone', tone);
  }

  // Show/hide correction panel in learning mode
  if (tone === 'learning' && state.viewMode === 'normal') {
    // Panel will show after recording
  } else {
    hideCorrectionPanel();
  }
}

function updateToneUI() {
  // Fallback: "friendly" -> "casual", unbekannte Töne -> "native"
  if (!TONES[state.currentTone]) {
    console.warn('[Tone] Unknown tone:', state.currentTone, '-> fallback to native');
    state.currentTone = (state.currentTone === 'friendly') ? 'casual' : 'native';
  }
  const tone = TONES[state.currentTone] || TONES.native;
  if (!tone) {
    console.error('[Tone] CRITICAL: No tone found, TONES=', TONES);
    return;
  }
  const isSmartklick = state.currentTone === 'smartklick';

  // Update mini tone button
  const miniToneBtn = document.getElementById('mini-tone-btn');
  if (miniToneBtn) {
    miniToneBtn.style.background = isSmartklick
      ? 'linear-gradient(135deg, #06b6d4, #0891b2)'
      : tone.color;
    // Show "S" for Smartklick, emoji for others
    const smiley = miniToneBtn.querySelector('.smiley');
    if (smiley) {
      smiley.textContent = isSmartklick ? 'S' : '😊';
      smiley.style.fontSize = isSmartklick ? '16px' : '14px';
      smiley.style.fontWeight = isSmartklick ? '700' : 'normal';
    }
  }

  // Update compact tone button
  const compactToneBtn = document.getElementById('compact-tone-btn');
  if (compactToneBtn) {
    compactToneBtn.style.background = isSmartklick
      ? 'linear-gradient(135deg, #06b6d4, #0891b2)'
      : tone.color;
    // Show "S" for Smartklick, emoji for others
    const smiley = compactToneBtn.querySelector('.smiley');
    if (smiley) {
      smiley.textContent = isSmartklick ? 'S' : '😊';
      smiley.style.fontSize = isSmartklick ? '18px' : '18px';
      smiley.style.fontWeight = isSmartklick ? '700' : 'normal';
    }
  }

  // Update normal mode dots
  document.querySelectorAll('.tone-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.tone === state.currentTone);
  });

  // Update tone label
  const toneLabel = document.getElementById('tone-label');
  if (toneLabel) {
    toneLabel.textContent = tone.name;
  }
}

// ========== LANGUAGE BUTTONS ==========
function setupLanguageButtons() {
  // Mini mode language button
  const miniLangBtn = document.getElementById('mini-lang-btn');
  if (miniLangBtn) {
    miniLangBtn.addEventListener('click', cycleLanguage);
  }

  // Compact mode language button
  const compactLangBtn = document.getElementById('compact-lang-btn');
  if (compactLangBtn) {
    compactLangBtn.addEventListener('click', cycleLanguage);
  }

  // Normal mode language chips
  document.querySelectorAll('.lang-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      setLanguage(chip.dataset.lang);
    });
  });
}

function cycleLanguage() {
  const currentIndex = LANGUAGES.indexOf(state.currentLanguage);
  const nextIndex = (currentIndex + 1) % LANGUAGES.length;
  setLanguage(LANGUAGES[nextIndex]);
}

function setLanguage(lang) {
  state.currentLanguage = lang;
  updateLanguageUI();

  // Save to settings
  if (window.electronAPI) {
    window.electronAPI.setSetting('last_language', lang);
  }
}

function updateLanguageUI() {
  const label = LANGUAGE_LABELS[state.currentLanguage] || '文';

  // Update mini language button
  const miniLangBtn = document.getElementById('mini-lang-btn');
  if (miniLangBtn) {
    const langText = miniLangBtn.querySelector('.lang-text');
    langText.textContent = label;
    miniLangBtn.classList.toggle('active', state.currentLanguage !== '');
  }

  // Update compact language button
  const compactLangBtn = document.getElementById('compact-lang-btn');
  if (compactLangBtn) {
    const langLabel = compactLangBtn.querySelector('.lang-label');
    if (langLabel) {
      langLabel.textContent = label;
    }
    compactLangBtn.classList.toggle('active', state.currentLanguage !== '');
  }

  // Update normal mode chips
  document.querySelectorAll('.lang-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.lang === state.currentLanguage);
  });
}

// ========== SETTINGS ==========
function setupSettingsButtons() {
  // Mini mode button (cycles through modes)
  const miniModeBtn = document.getElementById('mini-mode-btn');
  if (miniModeBtn) {
    miniModeBtn.addEventListener('click', cycleViewMode);
  }

  // Compact settings button - just switch to normal mode
  const compactSettingsBtn = document.getElementById('compact-settings-btn');
  if (compactSettingsBtn) {
    compactSettingsBtn.addEventListener('click', () => {
      if (window.electronAPI) {
        window.electronAPI.changeViewMode('normal');
      }
    });
  }

  // Normal settings button
  const normalSettingsBtn = document.getElementById('normal-settings-btn');
  if (normalSettingsBtn) {
    normalSettingsBtn.addEventListener('click', () => {
      showPanel('normal-settings-panel');
    });
  }

  // Normal settings close
  const normalSettingsClose = document.getElementById('normal-settings-close');
  if (normalSettingsClose) {
    normalSettingsClose.addEventListener('click', () => {
      hidePanel('normal-settings-panel');
    });
  }

  // View mode buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (window.electronAPI) {
        window.electronAPI.changeViewMode(mode);
      }
    });
  });

  // Wake Word toggle
  const wakeWordToggle = document.getElementById('normal-setting-wake-word');
  if (wakeWordToggle) {
    wakeWordToggle.addEventListener('change', async () => {
      state.wakeWordEnabled = wakeWordToggle.checked;

      if (window.electronAPI) {
        await window.electronAPI.setSetting('wake_word_enabled', state.wakeWordEnabled);

        if (state.wakeWordEnabled) {
          window.electronAPI.wakeWord.start();
        } else {
          window.electronAPI.wakeWord.stop();
        }
      }

      updateWakeWordStatus(state.wakeWordEnabled ? 'on' : 'off');
    });
  }
}

// ========== PANELS ==========
function setupPanelButtons() {
  // Correction close
  const correctionClose = document.getElementById('correction-close');
  if (correctionClose) {
    correctionClose.addEventListener('click', () => {
      hideCorrectionPanel();
    });
  }

  // Insert button
  const insertBtn = document.getElementById('insert-btn');
  if (insertBtn) {
    insertBtn.addEventListener('click', () => {
      const correctedText = document.getElementById('corrected-text').textContent;
      if (correctedText) {
        insertText(correctedText);
        hideCorrectionPanel();
      }
    });
  }

  // Screen Reading Button
  const screenReadBtn = document.getElementById('screen-read-btn');
  if (screenReadBtn) {
    screenReadBtn.addEventListener('click', () => {
      if (screenReadingActive) {
        // Stop analysis
        if (window.electronAPI && window.electronAPI.screenReading) {
          window.electronAPI.screenReading.cancel();
        }
      } else {
        // Start analysis
        startScreenReading();
      }
    });
  }

  // Screen Reading Panel close
  const screenReadingClose = document.getElementById('screen-reading-close');
  if (screenReadingClose) {
    screenReadingClose.addEventListener('click', () => {
      hidePanel('screen-reading-panel');
    });
  }

  // Setup Screen Reading event listeners
  setupScreenReadingListeners();
}

function showPanel(panelId) {
  // Hide other panels
  document.querySelectorAll('.side-panel').forEach(p => p.classList.add('hidden'));

  // Show requested panel
  document.getElementById(panelId).classList.remove('hidden');

  // Add panel-open class to normal-main for border-radius adjustment
  const normalMain = document.querySelector('.normal-main');
  if (normalMain) {
    normalMain.classList.add('panel-open');
  }

  // Resize window
  if (window.electronAPI) {
    window.electronAPI.showPanel(panelId);
  }
}

function hidePanel(panelId) {
  document.getElementById(panelId).classList.add('hidden');

  // Remove panel-open class from normal-main
  const normalMain = document.querySelector('.normal-main');
  if (normalMain) {
    normalMain.classList.remove('panel-open');
  }

  if (window.electronAPI) {
    window.electronAPI.hidePanel();
  }
}

function showCorrectionPanel(result) {
  const panel = document.getElementById('correction-panel');
  const originalText = document.getElementById('original-text');
  const correctedText = document.getElementById('corrected-text');
  const errorList = document.getElementById('error-list');

  // Parse corrections from server
  const corrections = result.errors || [];
  console.log('Corrections from server:', corrections);

  // Count errors by type
  const errorCounts = {
    spelling: 0,
    grammar: 0,
    wordOrder: 0,
    article: 0,
    semantic: 0,
    punctuation: 0,
    other: 0
  };

  let originalHtml = result.original || '';
  let correctedHtml = result.corrected || '';
  let errorListHtml = '';

  // If server provides detailed corrections, use them
  if (Array.isArray(corrections) && corrections.length > 0) {
    corrections.forEach((err) => {
      const type = err.type || err.errorType || 'other';
      const wrong = err.original || err.wrong || '';
      const correct = err.corrected || err.correct || err.correction || '';
      const explanation = err.explanation || err.reason || getErrorTypeLabel(type);

      if (errorCounts.hasOwnProperty(type)) {
        errorCounts[type]++;
      } else {
        errorCounts.other++;
      }

      // Mark ERRORS in original text with type-specific color
      if (wrong) {
        originalHtml = originalHtml.replace(
          wrong,
          `<span class="error-mark ${type}" title="${explanation}: ${wrong} → ${correct}">${wrong}</span>`
        );
      }

      // Mark CORRECTIONS in corrected text (green)
      if (correct && correct !== wrong) {
        correctedHtml = correctedHtml.replace(
          correct,
          `<span class="correct-mark" title="${explanation}">${correct}</span>`
        );
      }

      errorListHtml += `
        <div class="error-detail">
          <span class="error-type-badge ${type}">${getErrorTypeLabel(type)}</span>
          <span class="error-original">${wrong}</span>
          <span class="error-arrow">→</span>
          <span class="error-corrected">${correct}</span>
        </div>
      `;
    });
  } else if (result.original && result.corrected && result.original !== result.corrected) {
    // No detailed corrections from server - detect differences automatically
    const differences = findTextDifferences(result.original, result.corrected);

    differences.forEach((diff) => {
      errorCounts.other++;

      // Mark error in original
      if (diff.original) {
        originalHtml = originalHtml.replace(
          diff.original,
          `<span class="error-mark">${diff.original}</span>`
        );
      }

      // Mark correction in corrected text
      if (diff.corrected) {
        correctedHtml = correctedHtml.replace(
          diff.corrected,
          `<span class="correct-mark">${diff.corrected}</span>`
        );
      }

      errorListHtml += `
        <div class="error-detail">
          <span class="error-type-badge other">Korrektur</span>
          <span class="error-original">${diff.original || '(leer)'}</span>
          <span class="error-arrow">→</span>
          <span class="error-corrected">${diff.corrected || '(entfernt)'}</span>
        </div>
      `;
    });
  }

  // Set HTML content
  originalText.innerHTML = originalHtml;
  correctedText.innerHTML = correctedHtml;

  // Set error list or show "no errors"
  if (errorList) {
    if (errorListHtml) {
      errorList.innerHTML = errorListHtml;
    } else {
      errorList.innerHTML = '<div class="no-errors">✓ Keine Fehler gefunden</div>';
    }
  }

  // Update error counts in summary
  const totalErrors = Object.values(errorCounts).reduce((a, b) => a + b, 0);

  // Update individual counts
  const countIds = {
    'count-grammar': errorCounts.grammar,
    'count-spelling': errorCounts.spelling,
    'count-semantic': errorCounts.semantic,
    'count-punctuation': errorCounts.punctuation,
    'count-wordOrder': errorCounts.wordOrder,
    'count-article': errorCounts.article
  };

  for (const [id, count] of Object.entries(countIds)) {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  }

  document.getElementById('error-total').textContent = `${totalErrors} Fehler`;

  panel.classList.remove('hidden');

  if (window.electronAPI) {
    window.electronAPI.showPanel('correction');
  }
}

// Simple word-by-word diff to find differences between original and corrected text
function findTextDifferences(original, corrected) {
  const differences = [];
  const origWords = original.split(/\s+/);
  const corrWords = corrected.split(/\s+/);

  // Simple comparison - find words that differ
  const maxLen = Math.max(origWords.length, corrWords.length);

  for (let i = 0; i < maxLen; i++) {
    const origWord = origWords[i] || '';
    const corrWord = corrWords[i] || '';

    if (origWord.toLowerCase() !== corrWord.toLowerCase()) {
      differences.push({
        original: origWord,
        corrected: corrWord
      });
    }
  }

  return differences;
}

function getErrorTypeLabel(type) {
  const labels = {
    spelling: 'Rechtschreibung',
    grammar: 'Grammatik',
    wordOrder: 'Wortstellung',
    article: 'Artikel',
    semantic: 'Semantik',
    punctuation: 'Zeichensetzung',
    case: 'Groß-/Kleinschreibung',
    conjugation: 'Konjugation',
    declension: 'Deklination',
    other: 'Sonstiges'
  };
  return labels[type] || type || 'Korrektur';
}

function hideCorrectionPanel() {
  const panel = document.getElementById('correction-panel');
  panel.classList.add('hidden');

  if (window.electronAPI) {
    window.electronAPI.hidePanel();
  }
}

// ========== UTILITIES ==========
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function insertText(text) {
  console.log('=== INSERT TEXT ===');
  console.log('Text to insert:', text);
  console.log('electronAPI available:', !!window.electronAPI);

  if (window.electronAPI) {
    try {
      // Prüfe ob Cursor Feedback aktiv ist (Text wurde an Cursor-Position eingefügt)
      const feedbackStatus = await window.electronAPI.cursorFeedback?.getStatus();

      if (feedbackStatus) {
        // Cursor Feedback aktiv: "Verarbeitung" durch finalen Text ersetzen
        console.log('Using cursorFeedback.insertFinal...');
        const success = await window.electronAPI.cursorFeedback.insertFinal(text);
        console.log('CursorFeedback insertFinal result:', success);
        if (!success) {
          // Fallback zu normalem Paste
          console.log('CursorFeedback failed, using pasteText as fallback');
          await window.electronAPI.pasteText(text);
        }
      } else {
        // Normales Paste (kein Cursor Feedback aktiv)
        console.log('Calling electronAPI.pasteText...');
        const success = await window.electronAPI.pasteText(text);
        console.log('Paste result:', success);
        if (!success) {
          console.log('Paste failed, copying to clipboard as fallback');
          await navigator.clipboard.writeText(text);
        }
      }
    } catch (error) {
      console.error('Paste error:', error);
      await navigator.clipboard.writeText(text);
    }
  } else {
    console.log('No electronAPI, using clipboard');
    await navigator.clipboard.writeText(text);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log('Text copied to clipboard');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// ========== WAKE WORD ==========
function setupWakeWordListeners() {
  if (!window.electronAPI?.wakeWord) return;

  const wakeWord = window.electronAPI.wakeWord;

  // Service status
  wakeWord.onStatus((data) => {
    console.log('Wake Word status:', data);
    state.wakeWordEnabled = data.running;
    updateWakeWordStatus(data.running ? 'on' : 'off');

    const toggle = document.getElementById('normal-setting-wake-word');
    if (toggle) toggle.checked = data.running;
  });

  // State changes (idle, listening, processing)
  wakeWord.onState((data) => {
    console.log('Wake Word state:', data.state);
    state.wakeWordState = data.state;

    switch (data.state) {
      case 'idle':
        updateWakeWordStatus('on');
        break;
      case 'listening':
        updateWakeWordStatus('listening');
        break;
      case 'processing':
        updateWakeWordStatus('processing');
        break;
      default:
        updateWakeWordStatus('on');
    }
  });

  // Wake word detected - play sound and show feedback
  wakeWord.onDetected(() => {
    console.log('Hey Smartklick detected!');
    playWakeWordSound();
    showWakeWordFeedback('Ich höre...');
  });

  // Transcription received
  wakeWord.onTranscription((data) => {
    console.log('Wake Word transcription:', data.text);
    showWakeWordFeedback(`"${data.text}"`);
  });

  // Command parsed and executed
  wakeWord.onCommand((data) => {
    console.log('Wake Word command:', data.action, data.parameters);
    showWakeWordFeedback(`${data.action}`);

    // Handle web commands in renderer
    if (data.category === 'web') {
      handleWebCommand(data);
    }
  });

  // Smartklick AI response
  wakeWord.onSmartklickResponse((data) => {
    console.log('Smartklick response:', data.response);
    showWakeWordFeedback(data.response);
    // Optionally speak the response
    speakText(data.response);
  });

  // Exit Reminder command
  wakeWord.onExitReminder((data) => {
    console.log('Exit Reminder:', data);
    showWakeWordFeedback(`Erinnerung: ${data.message} bei ${data.location}`);
    // TODO: Send to Exit Reminder API
  });

  // Unknown command
  wakeWord.onUnknownCommand((data) => {
    console.log('Unknown command:', data.text);
    showWakeWordFeedback(`Unbekannt: "${data.text}"`);
  });

  // Error
  wakeWord.onError((data) => {
    console.error('Wake Word error:', data.message);
    showWakeWordFeedback(`Fehler: ${data.message}`);
  });
}

function updateWakeWordStatus(status) {
  state.wakeWordState = status;

  const statusEl = document.getElementById('wake-word-status');
  if (statusEl) {
    statusEl.className = `wake-status ${status}`;
  }

  // Update indicators in other modes if needed
  document.querySelectorAll('.wake-indicator').forEach(el => {
    el.classList.toggle('active', status !== 'off');
  });
}

function playWakeWordSound() {
  // Play a short acknowledgment sound
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (e) {
    console.log('Could not play wake word sound:', e);
  }
}

function showWakeWordFeedback(message) {
  // Show temporary feedback message
  const label = document.getElementById('mic-label');
  if (label) {
    const originalText = label.textContent;
    label.textContent = message;
    label.style.color = '#06b6d4';

    setTimeout(() => {
      label.textContent = originalText;
      label.style.color = '';
    }, 3000);
  }
}

function handleWebCommand(data) {
  const { action, parameters } = data;

  switch (action) {
    case 'web_search':
      if (parameters.query) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(parameters.query)}`, '_blank');
      }
      break;

    case 'youtube_search':
      if (parameters.query) {
        window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(parameters.query)}`, '_blank');
      }
      break;

    case 'wikipedia_search':
      if (parameters.query) {
        window.open(`https://de.wikipedia.org/wiki/Spezial:Suche?search=${encodeURIComponent(parameters.query)}`, '_blank');
      }
      break;

    case 'weather':
      const location = parameters.location || '';
      window.open(`https://www.google.com/search?q=wetter+${encodeURIComponent(location)}`, '_blank');
      break;

    case 'open_url':
      if (parameters.url) {
        const url = parameters.url.startsWith('http') ? parameters.url : `https://${parameters.url}`;
        window.open(url, '_blank');
      }
      break;
  }
}

function speakText(text) {
  // Use Web Speech API to speak text
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    speechSynthesis.speak(utterance);
  }
}

// ========== SCREEN READING ==========
let screenReadingActive = false;

function setupScreenReadingListeners() {
  if (!window.electronAPI || !window.electronAPI.screenReading) {
    console.log('Screen Reading API not available');
    return;
  }

  // Listen for screen reading events
  window.electronAPI.screenReading.onStarted((data) => {
    console.log('Screen reading started, mode:', data.mode);
    setScreenReadingState('started', null, data.mode);
  });

  window.electronAPI.screenReading.onAnalyzing((data) => {
    console.log('Screen reading analyzing, mode:', data.mode);
    setScreenReadingState('analyzing', null, data.mode);
  });

  window.electronAPI.screenReading.onComplete((data) => {
    console.log('Screen reading complete:', data);
    setScreenReadingState('complete');
    showScreenReadingResult(data);
  });

  // NEW: Listen for correction results (Learning mode)
  window.electronAPI.screenReading.onCorrections((data) => {
    console.log('Screen reading corrections:', data);
    setScreenReadingState('complete');
    showScreenCorrectionResult(data);
  });

  window.electronAPI.screenReading.onError((data) => {
    console.error('Screen reading error:', data);
    setScreenReadingState('error', data.error);
  });

  window.electronAPI.screenReading.onCancelled(() => {
    console.log('Screen reading cancelled');
    setScreenReadingState('cancelled');
  });
}

async function startScreenReading() {
  if (screenReadingActive) {
    console.log('Screen reading already active');
    return;
  }

  if (!window.electronAPI || !window.electronAPI.screenReading) {
    console.error('Screen Reading API not available');
    updateScreenReadStatus('API nicht verfügbar', 'error');
    return;
  }

  // Determine mode based on current tone
  // Learning mode (violet) = correction analysis
  // All other modes = summary analysis
  const isLearningMode = state.currentTone === 'learning';
  const mode = isLearningMode ? 'learning' : 'summary';

  console.log(`Starting screen reading in ${mode} mode (currentTone: ${state.currentTone})`);

  screenReadingActive = true;
  setScreenReadingState('started', null, mode);

  try {
    const result = await window.electronAPI.screenReading.start({
      withScroll: true,
      mode: mode
    });

    // Results are handled by the event listeners (onComplete or onCorrections)
    if (!result.success) {
      setScreenReadingState('error', result.error);
    }
  } catch (error) {
    console.error('Screen reading error:', error);
    setScreenReadingState('error', error.message);
  }
}

function setScreenReadingState(newState, errorMessage = null, mode = 'summary') {
  const button = document.getElementById('screen-read-btn');
  const stopIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  const aIcon = `<span style="font-weight: bold; font-size: 16px;">A</span>`;

  switch (newState) {
    case 'started':
      button.disabled = false;
      button.classList.add('analyzing');
      button.innerHTML = stopIcon;
      button.title = 'Analyse stoppen';
      break;

    case 'analyzing':
      // Stop-Icon bleibt
      button.innerHTML = stopIcon;
      break;

    case 'complete':
      screenReadingActive = false;
      button.disabled = false;
      button.classList.remove('analyzing');
      button.innerHTML = aIcon;
      button.title = 'Seite analysieren';
      break;

    case 'error':
      screenReadingActive = false;
      button.disabled = false;
      button.classList.remove('analyzing');
      button.innerHTML = aIcon;
      button.title = 'Seite analysieren';
      break;

    case 'cancelled':
      screenReadingActive = false;
      button.disabled = false;
      button.classList.remove('analyzing');
      button.innerHTML = aIcon;
      button.title = 'Seite analysieren';
      break;
  }
}

function updateScreenReadStatus(text, type) {
  const statusEl = document.getElementById('screen-read-status');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = 'screen-read-status';
    if (type) {
      statusEl.classList.add(type);
    }

    // Clear status after 5 seconds for success/error
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'screen-read-status';
      }, 5000);
    }
  }
}

function showScreenReadingResult(data) {
  if (!data.summary) {
    console.log('Keine Analyse-Daten verfuegbar');
    return;
  }

  // Open analysis viewer window with the data
  if (window.electronAPI?.analysis?.open) {
    window.electronAPI.analysis.open({
      title: 'Seitenanalyse',
      summary: data.summary,
      url: data.url || null,
      keyPoints: data.keyPoints || [],
      recommendations: data.recommendations || []
    });
    console.log('[ScreenReading] Analyse-Fenster geoeffnet');
  } else {
    // Fallback: Show in panel (old behavior)
    const resultEl = document.getElementById('screen-reading-result');
    resultEl.innerHTML = `
      <div class="summary">
        <div class="summary-header">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
          Bildschirm-Zusammenfassung
        </div>
        <div class="summary-text">${escapeHtml(data.summary)}</div>
      </div>
    `;
    showPanel('screen-reading-panel');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Store correction data and navigation state
let lastCorrectionData = null;
let currentErrorIndex = 0;

function showScreenCorrectionResult(data) {
  lastCorrectionData = data;

  const totalErrors = data.total_errors || 0;
  const extractedText = data.extracted_text || '';
  const errors = data.errors || [];

  console.log('Correction data received:', {
    totalErrors,
    extractedTextLength: extractedText.length,
    errorsCount: errors.length,
    errors: errors
  });

  // Show the panel
  showPanel('screen-correction-panel');

  // Update status
  const statusIcon = document.getElementById('corr-status-icon');
  const statusText = document.getElementById('corr-status-text');
  const errorCount = document.getElementById('total-errors-count');

  errorCount.textContent = totalErrors;

  if (totalErrors === 0) {
    statusIcon.textContent = '✅';
    statusText.textContent = 'Keine Fehler gefunden!';
  } else {
    statusIcon.textContent = '📝';
    statusText.textContent = `${totalErrors} Fehler korrigiert`;
  }

  // Build original text with errors marked in red
  let originalHtml = escapeHtml(extractedText);

  // Sort errors by length (longest first) to avoid partial replacements
  const sortedErrors = [...errors].sort((a, b) =>
    (b.original?.length || 0) - (a.original?.length || 0)
  );

  // Build corrected text by applying all corrections
  let correctedText = extractedText;

  for (const err of sortedErrors) {
    if (err.original && err.correction) {
      const original = err.original.trim();
      const correction = err.correction.trim();

      // Escape both for HTML display
      const escapedOriginal = escapeHtml(original);
      const escapedCorrection = escapeHtml(correction);

      // Try exact match first
      if (originalHtml.includes(escapedOriginal)) {
        originalHtml = originalHtml.replace(
          escapedOriginal,
          `<span class="corr-error-word" data-correction="→ ${escapedCorrection}">${escapedOriginal}</span>`
        );
        correctedText = correctedText.replace(original, correction);
        console.log(`Replaced: "${original}" → "${correction}"`);
      } else {
        // Try case-insensitive match
        const regex = new RegExp(escapeRegex(escapedOriginal), 'i');
        const match = originalHtml.match(regex);
        if (match) {
          originalHtml = originalHtml.replace(
            match[0],
            `<span class="corr-error-word" data-correction="→ ${escapedCorrection}">${match[0]}</span>`
          );
          const textRegex = new RegExp(escapeRegex(original), 'i');
          correctedText = correctedText.replace(textRegex, correction);
          console.log(`Replaced (case-insensitive): "${match[0]}" → "${correction}"`);
        } else {
          console.warn(`Could not find: "${original}" in text`);
        }
      }
    }
  }

  // Display original text with errors marked
  document.getElementById('original-with-errors').innerHTML = originalHtml;

  // Display corrected text
  document.getElementById('corrected-full-text').textContent = correctedText;

  // Build error list (in collapsible details)
  const errorListContainer = document.getElementById('error-list-container');
  if (totalErrors > 0) {
    errorListContainer.innerHTML = errors.map(err => `
      <div class="corr-error-item-simple">
        <span class="corr-error-original">${escapeHtml(err.original || '')}</span>
        <span class="corr-error-arrow">→</span>
        <span class="corr-error-fixed">${escapeHtml(err.correction || '')}</span>
        <span class="corr-error-cat">${err.category_name || err.category || ''}</span>
      </div>
    `).join('');
  } else {
    errorListContainer.innerHTML = '<div style="text-align: center; color: #22c55e; padding: 20px;">Alles korrekt!</div>';
  }

  // Copy button - copies corrected text
  document.getElementById('copy-corrected-btn').onclick = () => {
    navigator.clipboard.writeText(correctedText);
    updateScreenReadStatus('Text kopiert!', 'success');
  };

  // Insert button - pastes corrected text into previous window
  document.getElementById('insert-corrected-btn').onclick = async () => {
    const success = await window.electronAPI.pasteText(correctedText);
    if (success) {
      updateScreenReadStatus('Text eingefügt!', 'success');
      hidePanel('screen-correction-panel');
    }
  };

  // Close button
  document.getElementById('screen-correction-close').onclick = () => {
    hidePanel('screen-correction-panel');
  };
}

// Legacy functions kept for compatibility
function showNoErrorsState() {
  // Not used in new design
}

function navigateError(direction) {
  // Not used in new design
}

function displayCurrentError() {
  // Not used in new design - errors shown in collapsible list
}

function getCorrectedText() {
  if (!lastCorrectionData?.extracted_text) return '';

  let text = lastCorrectionData.extracted_text;
  if (lastCorrectionData.errors) {
    // Sort by length (longest first)
    [...lastCorrectionData.errors]
      .sort((a, b) => (b.original?.length || 0) - (a.original?.length || 0))
      .forEach(err => {
        if (err.original && err.correction) {
          text = text.replace(err.original, err.correction);
        }
      });
  }
  return text;
}

function getCategoryInfo(category) {
  const categories = {
    spelling: { name: 'Rechtschreibung', icon: '📝', color: '#ef4444' },
    grammar: { name: 'Grammatik', icon: '🔄', color: '#f97316' },
    capitalization: { name: 'Großschreibung', icon: '🔠', color: '#eab308' },
    lowercase: { name: 'Kleinschreibung', icon: '🔡', color: '#eab308' },
    punctuation: { name: 'Zeichensetzung', icon: '✏️', color: '#8b5cf6' },
    spacing: { name: 'Leerzeichen', icon: '⎵', color: '#64748b' },
    word_order: { name: 'Wortstellung', icon: '↔️', color: '#3b82f6' },
    article: { name: 'Artikel', icon: '📖', color: '#22c55e' },
    conjugation: { name: 'Konjugation', icon: '🔧', color: '#06b6d4' },
    declension: { name: 'Deklination', icon: '📐', color: '#ec4899' },
    compound: { name: 'Zusammenschreibung', icon: '🔗', color: '#84cc16' },
    separation: { name: 'Getrenntschreibung', icon: '✂️', color: '#84cc16' }
  };
  return categories[category] || { name: category, icon: '❓', color: '#64748b' };
}

function getSeverityLabel(severity) {
  const labels = {
    high: 'Schwer',
    medium: 'Mittel',
    low: 'Leicht'
  };
  return labels[severity] || severity;
}

function hidePanel(panelId) {
  const panel = document.getElementById(panelId);
  if (panel) {
    panel.classList.add('hidden');
    // Reset window size if needed
    if (window.electronAPI) {
      window.electronAPI.hidePanel();
    }
  }
}

// ========== PROMPT MODE (Blue) ==========
let lastGeneratedPrompt = '';

async function generatePrompt(text) {
  console.log('🔵 Generating prompt for:', text);

  // Show loading state
  showPromptLoading();
  showPanel('prompt-panel');

  try {
    const response = await fetch(`${API_BASE}/generate-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: text })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Prompt API response:', data);

    if (data.success) {
      showPromptResult(data);
    } else {
      showPromptError(data.error || 'Prompt-Generierung fehlgeschlagen');
    }
  } catch (error) {
    console.error('Prompt generation error:', error);
    showPromptError(error.message);
  }
}

function showPromptLoading() {
  // Hide other elements
  document.getElementById('prompt-intent-badge').classList.add('hidden');
  document.getElementById('prompt-output').classList.add('hidden');
  document.getElementById('prompt-tools').classList.add('hidden');
  document.getElementById('prompt-actions').classList.add('hidden');

  // Show loading
  document.getElementById('prompt-loading').classList.remove('hidden');
}

function showPromptResult(data) {
  // Hide loading
  document.getElementById('prompt-loading').classList.add('hidden');

  // Show intent badge
  const intentBadge = document.getElementById('prompt-intent-badge');
  const intentIcon = document.getElementById('prompt-intent-icon');
  const intentText = document.getElementById('prompt-intent-text');
  const confidenceEl = document.getElementById('prompt-confidence');

  intentIcon.textContent = data.intent_icon || '📝';
  intentText.textContent = data.intent_name || 'Content';
  confidenceEl.textContent = Math.round((data.confidence || 0.5) * 100) + '%';

  // Set color class based on intent
  intentBadge.className = 'intent-badge ' + (data.intent_color || '');
  intentBadge.classList.remove('hidden');

  // Show prompt output
  const promptOutput = document.getElementById('prompt-output');
  const promptText = document.getElementById('prompt-text');
  promptText.textContent = data.optimized_prompt;
  promptOutput.classList.remove('hidden');

  // Store for copy/insert
  lastGeneratedPrompt = data.optimized_prompt;

  // Show target tools
  if (data.target_tools && data.target_tools.length > 0) {
    const toolsList = document.getElementById('prompt-tools-list');
    toolsList.innerHTML = data.target_tools
      .map(tool => `<span class="tool-tag">${tool}</span>`)
      .join('');
    document.getElementById('prompt-tools').classList.remove('hidden');
  }

  // Show action buttons
  document.getElementById('prompt-actions').classList.remove('hidden');
}

function showPromptError(message) {
  // Hide loading
  document.getElementById('prompt-loading').classList.add('hidden');

  // Show error in prompt output
  const promptOutput = document.getElementById('prompt-output');
  const promptText = document.getElementById('prompt-text');
  promptText.innerHTML = `<span style="color: #ef4444;">❌ Fehler: ${message}</span>`;
  promptOutput.classList.remove('hidden');

  // Hide other elements
  document.getElementById('prompt-intent-badge').classList.add('hidden');
  document.getElementById('prompt-tools').classList.add('hidden');
  document.getElementById('prompt-actions').classList.add('hidden');
}

function copyPrompt() {
  if (lastGeneratedPrompt) {
    copyToClipboard(lastGeneratedPrompt);
    // Visual feedback
    const copyBtn = document.getElementById('prompt-copy-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✓ Kopiert!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 1500);
  }
}

function insertPrompt() {
  if (lastGeneratedPrompt) {
    insertText(lastGeneratedPrompt);
    // Visual feedback
    const insertBtn = document.getElementById('prompt-insert-btn');
    const originalText = insertBtn.textContent;
    insertBtn.textContent = '✓ Eingefügt!';
    setTimeout(() => {
      insertBtn.textContent = originalText;
    }, 1500);
  }
}

// Setup Prompt Panel event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Close button
  const closeBtn = document.getElementById('prompt-panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hidePanel('prompt-panel'));
  }

  // Copy button
  const copyBtn = document.getElementById('prompt-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', copyPrompt);
  }

  // Insert button
  const insertBtn = document.getElementById('prompt-insert-btn');
  if (insertBtn) {
    insertBtn.addEventListener('click', insertPrompt);
  }
});

// ========== GOOGLE INTEGRATION ==========
async function setupGoogleIntegration() {
  if (!window.electronAPI?.google) {
    console.log('Google API not available');
    return;
  }

  // Check initial status
  const status = await window.electronAPI.google.getAuthStatus();
  console.log('Google Auth Status:', status);
  updateGoogleUI(status.connected, status.user);

  // Connect button
  const connectBtn = document.getElementById('google-connect-btn');
  if (connectBtn) {
    const originalHTML = connectBtn.innerHTML;

    connectBtn.addEventListener('click', async () => {
      if (!status.configured) {
        alert('Google OAuth ist noch nicht konfiguriert.\n\nBitte CLIENT_ID und CLIENT_SECRET in googleAuth.js eintragen.');
        return;
      }

      // Show connecting state
      connectBtn.disabled = true;
      connectBtn.classList.add('connecting');
      connectBtn.innerHTML = 'Verbinde...';

      try {
        const result = await window.electronAPI.google.connect();
        if (result.success) {
          updateGoogleUI(true, result.user);
        } else {
          alert('Verbindung fehlgeschlagen: ' + (result.error || 'Unbekannter Fehler'));
          updateGoogleUI(false, null);
        }
      } catch (error) {
        console.error('Google connect error:', error);
        alert('Verbindung fehlgeschlagen: ' + error.message);
        updateGoogleUI(false, null);
      }

      connectBtn.disabled = false;
      connectBtn.classList.remove('connecting');
      connectBtn.innerHTML = originalHTML;
    });
  }

  // Disconnect button
  const disconnectBtn = document.getElementById('google-disconnect-btn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      if (confirm('Google-Verbindung wirklich trennen?')) {
        await window.electronAPI.google.disconnect();
        updateGoogleUI(false, null);
      }
    });
  }
}

function updateGoogleUI(connected, user) {
  const disconnectedSection = document.getElementById('google-disconnected');
  const connectedSection = document.getElementById('google-connected');
  const connectBtn = document.getElementById('google-connect-btn');
  const userAvatar = document.getElementById('google-user-avatar');
  const userName = document.getElementById('google-user-name');
  const userEmail = document.getElementById('google-user-email');

  if (connected && user) {
    // Show connected section, hide disconnected
    if (disconnectedSection) disconnectedSection.classList.add('hidden');
    if (connectedSection) connectedSection.classList.remove('hidden');

    // Update user info
    if (user.picture && userAvatar) {
      userAvatar.src = user.picture;
    }
    if (userName) {
      userName.textContent = user.name || '';
    }
    if (userEmail) {
      userEmail.textContent = user.email || '';
    }

    // Remove connecting state from button
    if (connectBtn) connectBtn.classList.remove('connecting');
  } else {
    // Show disconnected section, hide connected
    if (disconnectedSection) disconnectedSection.classList.remove('hidden');
    if (connectedSection) connectedSection.classList.add('hidden');

    // Remove connecting state from button
    if (connectBtn) connectBtn.classList.remove('connecting');
  }
}

// Test Google Calendar (can be called from console)
async function testGoogleCalendar() {
  if (!window.electronAPI?.google) {
    console.log('Google API not available');
    return;
  }

  console.log('Testing Google Calendar...');
  const result = await window.electronAPI.google.getTodayEvents();
  console.log('Today events:', result);

  if (result.success) {
    console.log('Speech:', result.speech);
    speakText(result.speech);
  }
}

// Test Gmail (can be called from console)
async function testGmail() {
  if (!window.electronAPI?.google) {
    console.log('Google API not available');
    return;
  }

  console.log('Testing Gmail...');
  const result = await window.electronAPI.google.getUnreadEmails();
  console.log('Unread emails:', result);

  if (result.success) {
    console.log('Speech:', result.speech);
    speakText(result.speech);
  }
}

// ========== GOOGLE ACTION HANDLER ==========
async function handleGoogleAction(action) {
  console.log('Handling Google Action:', action);

  if (!window.electronAPI?.google) {
    speakText('Google ist nicht verfügbar.');
    return;
  }

  // Check if connected
  const status = await window.electronAPI.google.getAuthStatus();
  if (!status.connected) {
    speakText('Bitte verbinde zuerst dein Google-Konto in den Einstellungen.');
    return;
  }

  try {
    switch (action) {
      case 'calendar_today':
        console.log('Fetching today\'s calendar...');
        showGoogleLoading('calendar');
        const todayResult = await window.electronAPI.google.getTodayEvents();
        if (todayResult.success) {
          console.log('Calendar result:', todayResult);
          showCalendarView('today', todayResult.events);
        } else {
          hidePanel('google-panel');
          console.error('Fehler beim Laden der Termine:', todayResult.error);
        }
        break;

      case 'calendar_week':
        console.log('Fetching week\'s calendar...');
        showGoogleLoading('calendar');
        const weekResult = await window.electronAPI.google.getWeekEvents();
        if (weekResult.success) {
          console.log('Calendar result:', weekResult);
          showCalendarView('week', weekResult.events);
        } else {
          hidePanel('google-panel');
          console.error('Fehler beim Laden der Termine:', weekResult.error);
        }
        break;

      case 'calendar_month':
        console.log('Fetching month\'s calendar...');
        showGoogleLoading('calendar');
        const monthResult = await window.electronAPI.google.getMonthEvents();
        if (monthResult.success) {
          console.log('Calendar month result:', monthResult);
          showCalendarView('month', monthResult.events);
        } else {
          hidePanel('google-panel');
          console.error('Fehler beim Laden der Termine:', monthResult.error);
        }
        break;

      case 'gmail_unread':
        console.log('Fetching unread emails...');
        showGoogleLoading('email');
        const emailResult = await window.electronAPI.google.getUnreadEmails();
        if (emailResult.success) {
          console.log('Email result:', emailResult);
          showGoogleResult('Neue E-Mails', emailResult.emails, 'email');
        } else {
          hidePanel('google-panel');
          console.error('Fehler beim Laden der E-Mails:', emailResult.error);
        }
        break;

      // ========== CALENDAR ACTIONS ==========
      case 'calendar_show':
        console.log('Opening calendar window...');
        if (window.electronAPI?.calendar?.openWindow) {
          await window.electronAPI.calendar.openWindow();
        }
        break;

      // ========== EMAIL ASSISTANT ACTIONS ==========
      case 'email_show':
        console.log('Opening email window...');
        await handleEmailAction('show');
        break;

      case 'email_read_last':
        console.log('Reading last email...');
        await handleEmailAction('read_last');
        break;

      case 'email_analyze':
        console.log('Analyzing email...');
        await handleEmailAction('analyze');
        break;

      case 'email_briefing':
        console.log('Creating email briefing...');
        await handleEmailAction('briefing');
        break;

      case 'email_reply':
        console.log('Opening reply panel...');
        await handleEmailAction('reply');
        break;

      case 'email_generate_reply':
        console.log('Generating KI reply...');
        await handleEmailAction('generate_reply');
        break;

      case 'email_send_reply':
        console.log('Sending reply...');
        await handleEmailAction('send_reply');
        break;

      default:
        // Check for email_read_from:{name}, email_intent:{name}, and email_reply_type:{type}
        if (action.startsWith('email_read_from:')) {
          const senderName = action.replace('email_read_from:', '');
          console.log('Reading email from:', senderName);
          await handleEmailAction('read_from', senderName);
        } else if (action.startsWith('email_reply_type:')) {
          const replyType = action.replace('email_reply_type:', '');
          console.log('Setting reply type:', replyType);
          await handleEmailAction('reply_type', replyType);
        } else if (action.startsWith('email_intent:')) {
          const senderName = action.replace('email_intent:', '');
          console.log('Analyzing intent from:', senderName);
          await handleEmailAction('intent', senderName);
        } else {
          console.log('Unknown Google action:', action);
        }
    }
  } catch (error) {
    console.error('Google action error:', error);
    hidePanel('google-panel');
  }
}

// ========== EMAIL ASSISTANT FUNCTIONS ==========

async function handleEmailAction(action, param = null) {
  const label = document.getElementById('mic-label');

  // Check if email service is available
  if (!window.electronAPI?.email) {
    speakText('E-Mail-Service ist nicht verfuegbar.');
    return;
  }

  // Check Google connection
  const status = await window.electronAPI.google.getAuthStatus();
  if (!status.connected) {
    speakText('Bitte verbinde zuerst dein Google-Konto in den Einstellungen.');
    return;
  }

  try {
    switch (action) {
      case 'show':
        // Open email window
        await window.electronAPI.email.openWindow();
        speakText('E-Mail-Fenster geoeffnet.');
        break;

      case 'read_last':
        // Open email window and read the last email
        if (label) {
          label.textContent = 'Lade E-Mails...';
          label.style.color = '#3b82f6';
        }

        const recentResult = await window.electronAPI.email.getRecent(1);
        if (recentResult.success && recentResult.emails && recentResult.emails.length > 0) {
          const email = recentResult.emails[0];
          await window.electronAPI.email.openWindow();
          speakText(`Letzte E-Mail von ${email.fromName || 'unbekannt'}. Betreff: ${email.subject}. ${email.snippet || ''}`);
        } else {
          speakText('Keine E-Mails gefunden.');
        }

        if (label) {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }
        break;

      case 'read_from':
        // Read emails from a specific sender
        if (!param) {
          speakText('Kein Absender angegeben.');
          return;
        }

        if (label) {
          label.textContent = `Suche E-Mails von ${param}...`;
          label.style.color = '#3b82f6';
        }

        const fromResult = await window.electronAPI.email.getFromSender(param);
        if (fromResult.success && fromResult.emails && fromResult.emails.length > 0) {
          const email = fromResult.emails[0];
          await window.electronAPI.email.openWindow();
          speakText(`E-Mail von ${email.fromName || param}. Betreff: ${email.subject}. ${email.snippet || ''}`);
        } else {
          speakText(`Keine E-Mails von ${param} gefunden.`);
        }

        if (label) {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }
        break;

      case 'analyze':
        // Analyze the last email
        if (label) {
          label.textContent = 'Analysiere E-Mail...';
          label.style.color = '#8b5cf6';
        }

        const lastEmail = await window.electronAPI.email.getRecent(1);
        if (lastEmail.success && lastEmail.emails && lastEmail.emails.length > 0) {
          const email = lastEmail.emails[0];
          const analysis = await window.electronAPI.email.analyze({
            text: email.body || email.snippet,
            subject: email.subject,
            sender: email.fromName || email.from
          });

          if (analysis.success && analysis.analysis) {
            const a = analysis.analysis;
            await window.electronAPI.email.openWindow();
            speakText(`Analyse der E-Mail von ${email.fromName || 'unbekannt'}. ${a.summary || ''} Dringlichkeit: ${a.urgency || 'mittel'}. ${a.suggestedAction || ''}`);
          } else {
            speakText('Analyse konnte nicht durchgefuehrt werden.');
          }
        } else {
          speakText('Keine E-Mail zum Analysieren gefunden.');
        }

        if (label) {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }
        break;

      case 'intent':
        // Analyze what a sender wants from me
        if (!param) {
          speakText('Kein Absender angegeben.');
          return;
        }

        if (label) {
          label.textContent = `Analysiere ${param}...`;
          label.style.color = '#8b5cf6';
        }

        const intentEmails = await window.electronAPI.email.getFromSender(param);
        if (intentEmails.success && intentEmails.emails && intentEmails.emails.length > 0) {
          const email = intentEmails.emails[0];
          const intentAnalysis = await window.electronAPI.email.analyze({
            text: email.body || email.snippet,
            subject: email.subject,
            sender: email.fromName || email.from
          });

          if (intentAnalysis.success && intentAnalysis.analysis) {
            const a = intentAnalysis.analysis;
            speakText(`${param} moechte: ${a.intent || 'unklar'}. ${a.summary || ''}`);
          } else {
            speakText('Konnte nicht analysieren was der Absender moechte.');
          }
        } else {
          speakText(`Keine E-Mails von ${param} gefunden.`);
        }

        if (label) {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }
        break;

      case 'briefing':
        // Create a daily briefing
        if (label) {
          label.textContent = 'Erstelle Briefing...';
          label.style.color = '#f59e0b';
        }

        const briefingEmails = await window.electronAPI.email.getForBriefing(20);
        if (briefingEmails.success && briefingEmails.emails) {
          const briefing = await window.electronAPI.email.briefing(briefingEmails.emails);

          if (briefing.success && briefing.briefing) {
            await window.electronAPI.email.openWindow();
            speakText(briefing.briefing);
          } else {
            speakText('Briefing konnte nicht erstellt werden.');
          }
        } else {
          speakText('Keine E-Mails fuer das Briefing gefunden.');
        }

        if (label) {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }
        break;

      case 'reply':
        // Open reply panel in email window
        await window.electronAPI.email.openWindow();
        // Send command to email window to open reply panel
        setTimeout(() => {
          window.electronAPI.email.sendCommand({ action: 'openReply' });
        }, 500);
        speakText('Antwort-Panel geoeffnet.');
        break;

      case 'generate_reply':
        // Generate KI reply
        speakText('Generiere KI-Antwort.');
        window.electronAPI.email.sendCommand({ action: 'generateReply' });
        break;

      case 'reply_type':
        // Set reply type
        const typeNames = {
          'professional': 'formell',
          'friendly': 'freundlich',
          'short': 'kurz'
        };
        speakText(`Antwort-Stil: ${typeNames[param] || param}`);
        window.electronAPI.email.sendCommand({ action: 'setReplyType', type: param });
        break;

      case 'send_reply':
        // Send the reply
        speakText('Sende Antwort.');
        window.electronAPI.email.sendCommand({ action: 'sendReply' });
        break;

      default:
        console.log('Unknown email action:', action);
    }
  } catch (error) {
    console.error('Email action error:', error);
    speakText('Fehler bei der E-Mail-Aktion.');
    if (label) {
      label.textContent = 'Smartklick';
      label.style.color = '';
    }
  }
}

// Handle calendar create via voice
async function handleCalendarCreate(eventText) {
  console.log('Creating calendar event:', eventText);

  const label = document.getElementById('mic-label');
  if (label) {
    label.textContent = '📅 Termin wird erstellt...';
    label.style.color = '#3b82f6';
  }

  if (!window.electronAPI?.google) {
    speakText('Google ist nicht verfügbar.');
    if (label) {
      label.textContent = '❌ Google nicht verfügbar';
      label.style.color = '#ef4444';
      setTimeout(() => { label.textContent = 'Smartklick'; label.style.color = ''; }, 3000);
    }
    return;
  }

  // Check if connected
  const status = await window.electronAPI.google.getAuthStatus();
  if (!status.connected) {
    speakText('Bitte verbinde zuerst dein Google-Konto in den Einstellungen.');
    if (label) {
      label.textContent = '❌ Google nicht verbunden';
      label.style.color = '#ef4444';
      setTimeout(() => { label.textContent = 'Smartklick'; label.style.color = ''; }, 3000);
    }
    return;
  }

  try {
    const result = await window.electronAPI.google.quickAddEvent(eventText);

    if (result.success) {
      console.log('Event created:', result.event);
      const event = result.event;
      speakText(`Termin erstellt: ${event.title} am ${event.startFormatted}`);
      if (label) {
        label.textContent = '✅ Termin erstellt!';
        label.style.color = '#22c55e';
        setTimeout(() => { label.textContent = 'Smartklick'; label.style.color = ''; }, 3000);
      }
    } else {
      console.error('Event creation failed:', result.error);
      speakText('Termin konnte nicht erstellt werden.');
      if (label) {
        label.textContent = '❌ Fehler';
        label.style.color = '#ef4444';
        setTimeout(() => { label.textContent = 'Smartklick'; label.style.color = ''; }, 3000);
      }
    }
  } catch (error) {
    console.error('Calendar create error:', error);
    speakText('Fehler beim Erstellen des Termins.');
    if (label) {
      label.textContent = '❌ Fehler';
      label.style.color = '#ef4444';
      setTimeout(() => { label.textContent = 'Smartklick'; label.style.color = ''; }, 3000);
    }
  }
}

// ========== GOOGLE PANEL FUNCTIONS ==========

// Show Calendar View (Today / Week)
function showCalendarView(viewType, events) {
  const panel = document.getElementById('google-panel');
  const panelTitle = document.getElementById('google-panel-title');
  const panelContent = document.getElementById('google-panel-content');
  const panelStats = document.getElementById('google-panel-stats');
  const panelAction = document.getElementById('google-panel-action');

  // German weekday names
  const weekdayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const weekdayShort = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  let html = '';

  if (viewType === 'today') {
    // TODAY VIEW: Big date header + timeline of events
    const today = new Date();
    const dayName = weekdayNames[today.getDay()];
    const dayNum = today.getDate();
    const monthName = monthNames[today.getMonth()];

    panelTitle.textContent = '📅 Heute';

    html = `
      <div class="calendar-today-header">
        <div class="calendar-today-day">${dayName}</div>
        <div class="calendar-today-date">${dayNum}. ${monthName}</div>
      </div>
    `;

    if (!events || events.length === 0) {
      html += `
        <div class="calendar-empty">
          <div class="calendar-empty-icon">✨</div>
          <div class="calendar-empty-text">Keine Termine heute</div>
        </div>
      `;
    } else {
      html += '<div class="calendar-timeline">';
      events.forEach(event => {
        const startTime = event.isAllDay ? 'Ganztägig' : formatEventTime(event.start);
        const endTime = event.isAllDay ? '' : formatEventTime(event.end);
        html += `
          <div class="calendar-event">
            <div class="calendar-event-time">
              <span class="time-start">${startTime}</span>
              ${endTime ? `<span class="time-end">${endTime}</span>` : ''}
            </div>
            <div class="calendar-event-content">
              <div class="calendar-event-title">${escapeHtml(event.title)}</div>
              ${event.location ? `<div class="calendar-event-location">📍 ${escapeHtml(event.location)}</div>` : ''}
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    panelStats.textContent = events.length === 0 ? 'Freier Tag!' : `${events.length} Termin${events.length > 1 ? 'e' : ''}`;

  } else if (viewType === 'week') {
    // WEEK VIEW: Next 7 days from today, vertical layout, focus on first day with events
    panelTitle.textContent = '📅 Nächste 7 Tage';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create array for next 7 days starting from TODAY
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(today);
      day.setDate(today.getDate() + i);
      weekDays.push({
        date: day,
        dayNum: day.getDate(),
        dayName: weekdayNames[day.getDay()],
        dayShort: weekdayShort[day.getDay()],
        monthName: monthNames[day.getMonth()],
        isToday: i === 0,
        events: []
      });
    }

    // Group events by day
    events.forEach(event => {
      const eventDate = new Date(event.start);
      eventDate.setHours(0, 0, 0, 0);
      const dayIndex = weekDays.findIndex(d => d.date.toDateString() === eventDate.toDateString());
      if (dayIndex !== -1) {
        weekDays[dayIndex].events.push(event);
      }
    });

    // Find first day with events (for focus)
    const firstDayWithEvents = weekDays.findIndex(d => d.events.length > 0);

    html = '<div class="calendar-week-vertical">';

    weekDays.forEach((day, index) => {
      const hasEvents = day.events.length > 0;
      const isFocusDay = index === firstDayWithEvents;
      const dayLabel = day.isToday ? 'Heute' : (index === 1 ? 'Morgen' : day.dayName);

      html += `
        <div class="week-day-row ${day.isToday ? 'is-today' : ''} ${hasEvents ? 'has-events' : ''} ${isFocusDay ? 'is-focus' : ''}">
          <div class="week-day-date">
            <span class="week-day-label">${dayLabel}</span>
            <span class="week-day-full">${day.dayShort}, ${day.dayNum}. ${day.monthName.substring(0, 3)}</span>
          </div>
          <div class="week-day-content">
      `;

      if (day.events.length === 0) {
        html += '<div class="week-no-events">Keine Termine</div>';
      } else {
        day.events.forEach(event => {
          const time = event.isAllDay ? 'Ganztägig' : formatEventTime(event.start);
          html += `
            <div class="week-event-item">
              <span class="week-event-time">${time}</span>
              <span class="week-event-title">${escapeHtml(event.title)}</span>
              ${event.location ? `<span class="week-event-location">📍 ${escapeHtml(event.location)}</span>` : ''}
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    });

    html += '</div>';

    const totalEvents = events.length;
    const daysWithEvents = weekDays.filter(d => d.events.length > 0).length;

    if (totalEvents === 0) {
      panelStats.textContent = 'Keine Termine in den nächsten 7 Tagen';
    } else {
      panelStats.textContent = `${totalEvents} Termin${totalEvents !== 1 ? 'e' : ''} an ${daysWithEvents} Tag${daysWithEvents !== 1 ? 'en' : ''}`;
    }

  } else if (viewType === 'month') {
    // MONTH VIEW: Full calendar grid with clickable days
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const monthName = monthNames[currentMonth];

    panelTitle.textContent = `📅 ${monthName} ${currentYear}`;

    // Get first day of month and number of days
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();
    const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0

    // Create days array with events
    const monthDays = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const dayDate = new Date(currentYear, currentMonth, i);
      monthDays.push({
        dayNum: i,
        date: dayDate,
        isToday: i === today.getDate(),
        events: []
      });
    }

    // Group events by day
    events.forEach(event => {
      const eventDate = new Date(event.start);
      if (eventDate.getMonth() === currentMonth) {
        const dayIndex = eventDate.getDate() - 1;
        if (monthDays[dayIndex]) {
          monthDays[dayIndex].events.push(event);
        }
      }
    });

    // Header with weekday names
    html = `
      <div class="calendar-month">
        <div class="month-header">
          <span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span>
        </div>
        <div class="month-grid">
    `;

    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
      html += '<div class="month-day empty"></div>';
    }

    // Days of month
    monthDays.forEach(day => {
      const hasEvents = day.events.length > 0;
      const eventCount = day.events.length;
      const eventTitles = day.events.map(e => `${formatEventTime(e.start)} ${e.title}`).join('\n');

      html += `
        <div class="month-day ${day.isToday ? 'is-today' : ''} ${hasEvents ? 'has-events' : ''}"
             ${hasEvents ? `title="${escapeHtml(eventTitles)}"` : ''}
             ${hasEvents ? `onclick="showDayEvents(${day.dayNum}, ${currentMonth}, ${currentYear})"` : ''}>
          <span class="month-day-num">${day.dayNum}</span>
          ${hasEvents ? `<span class="month-day-dot">${eventCount > 1 ? eventCount : '•'}</span>` : ''}
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    // Store events for day click
    window._monthEvents = events;
    window._currentMonth = currentMonth;
    window._currentYear = currentYear;

    const totalEvents = events.length;
    const daysWithEvents = monthDays.filter(d => d.events.length > 0).length;
    panelStats.textContent = `${totalEvents} Termin${totalEvents !== 1 ? 'e' : ''} an ${daysWithEvents} Tag${daysWithEvents !== 1 ? 'en' : ''}`;
  }

  panelContent.innerHTML = html;

  // Action button
  panelAction.textContent = '📅 Kalender öffnen';
  panelAction.onclick = () => {
    window.open('https://calendar.google.com', '_blank');
  };

  showPanel('google-panel');

  document.getElementById('google-panel-close').onclick = () => {
    hidePanel('google-panel');
  };
}

// Show events for a specific day (called when clicking on a day in month view)
function showDayEvents(dayNum, month, year) {
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const weekdayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  const clickedDate = new Date(year, month, dayNum);
  const dayName = weekdayNames[clickedDate.getDay()];

  // Filter events for this day
  const dayEvents = (window._monthEvents || []).filter(event => {
    const eventDate = new Date(event.start);
    return eventDate.getDate() === dayNum && eventDate.getMonth() === month;
  });

  const panelContent = document.getElementById('google-panel-content');
  const panelTitle = document.getElementById('google-panel-title');
  const panelStats = document.getElementById('google-panel-stats');

  panelTitle.textContent = `📅 ${dayName}, ${dayNum}. ${monthNames[month]}`;

  let html = '<div class="calendar-timeline">';

  dayEvents.forEach(event => {
    const startTime = event.isAllDay ? 'Ganztägig' : formatEventTime(event.start);
    const endTime = event.isAllDay ? '' : formatEventTime(event.end);
    html += `
      <div class="calendar-event">
        <div class="calendar-event-time">
          <span class="time-start">${startTime}</span>
          ${endTime ? `<span class="time-end">${endTime}</span>` : ''}
        </div>
        <div class="calendar-event-content">
          <div class="calendar-event-title">${escapeHtml(event.title)}</div>
          ${event.location ? `<div class="calendar-event-location">📍 ${escapeHtml(event.location)}</div>` : ''}
        </div>
      </div>
    `;
  });

  html += '</div>';
  html += `<button class="back-to-month-btn" onclick="handleGoogleAction('calendar_month')">← Zurück zur Monatsübersicht</button>`;

  panelContent.innerHTML = html;
  panelStats.textContent = `${dayEvents.length} Termin${dayEvents.length !== 1 ? 'e' : ''}`;
}

// Show Google Panel with calendar events
function showGoogleResult(title, items, type) {
  const panel = document.getElementById('google-panel');
  const panelTitle = document.getElementById('google-panel-title');
  const panelContent = document.getElementById('google-panel-content');
  const panelStats = document.getElementById('google-panel-stats');
  const panelAction = document.getElementById('google-panel-action');

  // Set title with icon
  if (type === 'calendar') {
    panelTitle.textContent = `📅 ${title}`;
    panelAction.textContent = '📅 Kalender öffnen';
    panelAction.onclick = () => {
      window.open('https://calendar.google.com', '_blank');
    };
  } else if (type === 'email') {
    panelTitle.textContent = `📧 ${title}`;
    panelAction.textContent = '📧 Gmail öffnen';
    panelAction.onclick = () => {
      window.open('https://mail.google.com', '_blank');
    };
  }

  // Build content
  let html = '';

  if (!items || items.length === 0) {
    html = `
      <div class="panel-empty">
        <div class="panel-empty-icon">${type === 'calendar' ? '📅' : '📧'}</div>
        <div class="panel-empty-text">${type === 'calendar' ? 'Keine Termine' : 'Keine E-Mails'}</div>
      </div>
    `;
    panelStats.textContent = '';
  } else {
    items.forEach(item => {
      if (type === 'calendar') {
        const timeStr = item.isAllDay ? 'Ganztägig' : (item.startFormatted || '');
        html += `
          <div class="event-item">
            ${item.isAllDay ? '<span class="event-allday">Ganztägig</span>' : `<div class="event-time">${formatEventTime(item.start)}</div>`}
            <div class="event-title">${escapeHtml(item.title || 'Ohne Titel')}</div>
            ${item.location ? `<div class="event-location">📍 ${escapeHtml(item.location)}</div>` : ''}
          </div>
        `;
      } else if (type === 'email') {
        html += `
          <div class="email-item ${item.isUnread ? 'email-unread' : 'email-read'}">
            <div class="email-header">
              <span class="email-from">${escapeHtml(item.fromName || item.from || 'Unbekannt')}</span>
              <span class="email-time">${item.dateFormatted || ''}</span>
            </div>
            <div class="email-subject">${escapeHtml(item.subject || 'Kein Betreff')}</div>
            <div class="email-snippet">${escapeHtml(item.snippet || '')}</div>
          </div>
        `;
      }
    });

    // Stats
    if (type === 'calendar') {
      const nextEvent = items[0];
      const nextIn = getTimeUntil(nextEvent?.start);
      panelStats.textContent = `${items.length} Termine${nextIn ? ` | Nächster ${nextIn}` : ''}`;
    } else {
      const unreadCount = items.filter(e => e.isUnread).length;
      panelStats.textContent = `${unreadCount} ungelesen`;
    }
  }

  panelContent.innerHTML = html;

  // Show panel
  showPanel('google-panel');

  // Setup close button
  document.getElementById('google-panel-close').onclick = () => {
    hidePanel('google-panel');
  };
}

// Format event time (extract just the time)
function formatEventTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Get time until event
function getTimeUntil(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const eventDate = new Date(dateStr);
  const diffMs = eventDate - now;

  if (diffMs < 0) return '';

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) {
    return `in ${diffMins} Min`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `in ${diffHours} Std`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `in ${diffDays} Tagen`;
}

// Show loading state in Google panel
function showGoogleLoading(type) {
  const panel = document.getElementById('google-panel');
  const panelTitle = document.getElementById('google-panel-title');
  const panelContent = document.getElementById('google-panel-content');
  const panelStats = document.getElementById('google-panel-stats');

  panelTitle.textContent = type === 'calendar' ? '📅 Lade Termine...' : '📧 Lade E-Mails...';
  panelStats.textContent = '';

  panelContent.innerHTML = `
    <div class="panel-loading">
      <div class="panel-loading-spinner"></div>
      <div class="panel-loading-text">Daten werden geladen...</div>
    </div>
  `;

  showPanel('google-panel');
}

// ========== NOTES PANEL (JTBT System) ==========

let currentNotesFilter = 'all';
let currentNotesSearch = '';

// Handle notes action from voice command
async function handleNotesAction(action, query = null) {
  console.log('Handling Notes Action:', action, query);

  if (!window.electronAPI?.notes) {
    console.error('Notes API not available');
    return;
  }

  try {
    switch (action) {
      case 'notes_list':
        await showNotesPanel('all');
        break;
      case 'notes_links':
        await showNotesPanel('links');
        break;
      case 'notes_code':
        await showNotesPanel('code');
        break;
      case 'notes_ideas':
        await showNotesPanel('ideas');
        break;
      case 'notes_today':
        await showNotesPanel('today');
        break;
      case 'notes_search':
        await showNotesPanel('all', query);
        break;
      default:
        await showNotesPanel('all');
    }
  } catch (error) {
    console.error('Notes action error:', error);
    hidePanel('notes-panel');
  }
}

// Handle notes save via voice command
async function handleNotesSave(content) {
  console.log('Saving note via voice:', content);

  if (!window.electronAPI?.notes) {
    console.error('Notes API not available');
    showNoteSaveResult(false, 'Notes API nicht verfügbar');
    return;
  }

  try {
    const result = await window.electronAPI.notes.save(content);

    if (result.success) {
      console.log('Note saved:', result.note);
      showNoteSaveResult(true, result.note);
    } else {
      console.error('Save failed:', result.error);
      showNoteSaveResult(false, result.error);
    }
  } catch (error) {
    console.error('Notes save error:', error);
    showNoteSaveResult(false, error.message);
  }
}

// Show save result feedback with fly-to-icon animation
function showNoteSaveResult(success, noteOrError) {
  const label = document.getElementById('mic-label');
  const popup = document.getElementById('note-saved-popup');
  const dockPopup = document.getElementById('dock-note-saved');
  const notesIcon = document.getElementById('dockNotesBtn');

  if (success) {
    // Determine icon based on category
    const icon = noteOrError.category === 'links' ? '🔗' :
                 noteOrError.category === 'code' ? '💻' :
                 noteOrError.category === 'ideas' ? '💡' : '📝';

    // Normal mode popup (simple animation)
    if (popup) {
      const iconEl = popup.querySelector('.note-saved-icon');
      const textEl = popup.querySelector('.note-saved-text');
      if (iconEl) iconEl.textContent = icon;
      if (textEl) textEl.textContent = 'Notiz gespeichert';

      popup.classList.remove('show');
      void popup.offsetWidth;
      popup.classList.add('show');
      setTimeout(() => popup.classList.remove('show'), 2500);
    }

    // Dock mode: Fly-to-icon animation
    if (dockPopup && notesIcon) {
      const dockIconEl = dockPopup.querySelector('.dock-note-icon');
      const dockTextEl = dockPopup.querySelector('.dock-note-text');
      if (dockIconEl) dockIconEl.textContent = icon;
      if (dockTextEl) dockTextEl.textContent = 'Notiz gespeichert';

      // Get positions
      const popupRect = dockPopup.getBoundingClientRect();
      const iconRect = notesIcon.getBoundingClientRect();

      // Calculate distance to fly
      const deltaX = iconRect.left - popupRect.left - (popupRect.width / 2) + (iconRect.width / 2);
      const deltaY = iconRect.top - popupRect.top;

      // Set CSS variables for animation
      dockPopup.style.setProperty('--fly-x', `${deltaX}px`);
      dockPopup.style.setProperty('--fly-y', `${deltaY}px`);

      // Start animation
      dockPopup.classList.remove('show', 'fly');
      void dockPopup.offsetWidth;
      dockPopup.classList.add('show', 'fly');

      // Flash the notes icon when popup arrives
      setTimeout(() => {
        notesIcon.classList.add('note-flash');
        setTimeout(() => notesIcon.classList.remove('note-flash'), 600);
      }, 800); // When popup reaches the icon

      // Cleanup
      setTimeout(() => {
        dockPopup.classList.remove('show', 'fly');
      }, 1500);
    }

    console.log('[NOTES] ✅ Notiz gespeichert - Fly Animation gestartet');
  } else if (!success && label) {
    // Show error in label
    const originalText = label.textContent;
    label.textContent = `❌ Fehler: ${noteOrError}`;
    label.style.color = '#ef4444';

    setTimeout(() => {
      label.textContent = originalText;
      label.style.color = '';
    }, 3000);
  }
}

// Show screenshot flash animation (camera flash effect)
function showScreenshotFlash() {
  const flash = document.getElementById('screenshot-flash');
  const indicator = document.getElementById('screenshot-indicator');

  if (flash) {
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 300);
  }

  if (indicator) {
    indicator.classList.add('active');
    setTimeout(() => indicator.classList.remove('active'), 500);
  }
}

// Show analyze animation on the A button
function showAnalyzeAnimation(show = true) {
  const btn = document.getElementById('screen-read-btn');
  if (btn) {
    if (show) {
      btn.classList.add('voice-analyzing');
    } else {
      btn.classList.remove('voice-analyzing');
    }
  }
}

// Handle screenshot to note
async function handleScreenshotNote() {
  console.log('Capturing screenshot for note...');

  const label = document.getElementById('mic-label');
  if (label) {
    label.textContent = '📸 Screenshot wird erstellt...';
    label.style.color = '#3b82f6';  // Blue
  }

  // Show flash animation
  showScreenshotFlash();

  if (!window.electronAPI?.captureScreenshotNote) {
    console.error('Screenshot API not available');
    if (label) {
      label.textContent = '❌ Screenshot nicht verfügbar';
      label.style.color = '#ef4444';
      setTimeout(() => {
        label.textContent = 'Smartklick';
        label.style.color = '';
      }, 3000);
    }
    return;
  }

  try {
    const result = await window.electronAPI.captureScreenshotNote();

    if (result.success) {
      console.log('Screenshot note saved:', result.note);
      if (label) {
        label.textContent = '📸 Screenshot gespeichert!';
        label.style.color = '#22c55e';  // Green
        setTimeout(() => {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }, 3000);
      }

      // Show confirmation in screen reading panel
      const resultEl = document.getElementById('screen-reading-result');
      if (resultEl) {
        const noteTitle = result.note?.title || 'Screenshot';
        resultEl.innerHTML = `
          <div class="summary-section">
            <div class="summary-header">📸 Screenshot gespeichert!</div>
            <div class="summary-text" style="text-align: center; padding: 20px;">
              <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
              <div style="color: #22c55e; font-weight: bold;">${escapeHtml(noteTitle)}</div>
              <div style="color: #64748b; font-size: 12px; margin-top: 8px;">In deinen Notizen gespeichert</div>
            </div>
          </div>
        `;
      }
      showPanel('screen-reading-panel');

      // Refresh notes panel if open
      const notesPanel = document.getElementById('notes-panel');
      if (notesPanel && !notesPanel.classList.contains('hidden')) {
        await showNotesPanel(currentNotesFilter, currentNotesSearch);
      }
    } else {
      console.error('Screenshot save failed:', result.error);
      if (label) {
        label.textContent = `❌ ${result.error}`;
        label.style.color = '#ef4444';
        setTimeout(() => {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }, 3000);
      }
    }
  } catch (error) {
    console.error('Screenshot note error:', error);
    if (label) {
      label.textContent = '❌ Screenshot Fehler';
      label.style.color = '#ef4444';
      setTimeout(() => {
        label.textContent = 'Smartklick';
        label.style.color = '';
      }, 3000);
    }
  }
}

// Handle analyze page to note (screenshot + AI analysis -> text note)
async function handleAnalyzePageNote() {
  console.log('[ANALYZE-UI] Starting page analysis...');

  const label = document.getElementById('mic-label');
  if (label) {
    label.textContent = '🔍 Seite wird analysiert...';
    label.style.color = '#3b82f6';  // Blue
  }

  // Show pulsing animation on the A button
  showAnalyzeAnimation(true);

  if (!window.electronAPI?.analyzePageNote) {
    console.error('[ANALYZE-UI] API not available');
    showAnalyzeAnimation(false);
    if (label) {
      label.textContent = '❌ Analyse nicht verfügbar';
      label.style.color = '#ef4444';
      setTimeout(() => {
        label.textContent = 'Smartklick';
        label.style.color = '';
      }, 3000);
    }
    return;
  }

  try {
    console.log('[ANALYZE-UI] Calling analyzePageNote...');
    const result = await window.electronAPI.analyzePageNote();
    console.log('[ANALYZE-UI] Result:', JSON.stringify(result));

    // Stop animation
    showAnalyzeAnimation(false);

    if (result && result.success) {
      console.log('[ANALYZE-UI] Success! Note:', result.note?.id);
      if (label) {
        label.textContent = '📝 Analyse gespeichert!';
        label.style.color = '#22c55e';  // Green
        setTimeout(() => {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }, 3000);
      }
    } else {
      const errorMsg = result?.error || 'Unbekannter Fehler';
      console.error('[ANALYZE-UI] Failed:', errorMsg);
      if (label) {
        label.textContent = `❌ ${errorMsg}`;
        label.style.color = '#ef4444';
        setTimeout(() => {
          label.textContent = 'Smartklick';
          label.style.color = '';
        }, 5000);
      }
    }
  } catch (error) {
    console.error('[ANALYZE-UI] Exception:', error);
    showAnalyzeAnimation(false);
    if (label) {
      label.textContent = '❌ Analyse Fehler';
      label.style.color = '#ef4444';
      setTimeout(() => {
        label.textContent = 'Smartklick';
        label.style.color = '';
      }, 3000);
    }
  }
}

// Handle analyze page with visual animation (like A button) AND save to notes
async function handleAnalyzePageNoteWithAnimation() {
  console.log('[ANALYZE-VOICE] Starting page analysis with animation...');

  // Show the screen reading panel with loading state
  const resultEl = document.getElementById('screen-reading-result');
  if (resultEl) {
    resultEl.innerHTML = '<div class="loading">🔍 Seite wird analysiert...</div>';
  }
  showPanel('screen-reading-panel');

  // Animate the A button
  const btn = document.getElementById('screen-read-btn');
  if (btn) {
    btn.classList.add('analyzing');
  }

  try {
    // Call the API that saves to notes
    const result = await window.electronAPI.analyzePageNote();
    console.log('[ANALYZE-VOICE] Result:', result);

    // Stop button animation
    if (btn) {
      btn.classList.remove('analyzing');
    }

    if (result && result.success && result.note) {
      // Show the summary in the panel
      const summary = result.note.content || result.note.preview || 'Analyse abgeschlossen';
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="summary-section">
            <div class="summary-header">📝 Zusammenfassung (gespeichert)</div>
            <div class="summary-text">${escapeHtml(summary)}</div>
          </div>
        `;
      }
      console.log('[ANALYZE-VOICE] Note saved:', result.note.id);
    } else {
      const errorMsg = result?.error || 'Analyse fehlgeschlagen';
      if (resultEl) {
        resultEl.innerHTML = `<div class="loading" style="color: #ef4444;">❌ ${escapeHtml(errorMsg)}</div>`;
      }
    }
  } catch (error) {
    console.error('[ANALYZE-VOICE] Error:', error);
    if (btn) {
      btn.classList.remove('analyzing');
    }
    if (resultEl) {
      resultEl.innerHTML = `<div class="loading" style="color: #ef4444;">❌ Fehler: ${escapeHtml(error.message)}</div>`;
    }
  }
}

// Show notes panel with filter
async function showNotesPanel(filter = 'all', searchQuery = null) {
  currentNotesFilter = filter;
  currentNotesSearch = searchQuery || '';

  const panel = document.getElementById('notes-panel');
  const panelTitle = document.getElementById('notes-panel-title');
  const panelContent = document.getElementById('notes-panel-content');
  const panelStats = document.getElementById('notes-panel-stats');
  const searchInput = document.getElementById('notes-search-input');

  // Update title
  const titles = {
    'all': '📝 Meine Notizen',
    'links': '🔗 Link-Notizen',
    'code': '💻 Code-Notizen',
    'ideas': '💡 Ideen',
    'today': '📅 Heute'
  };
  panelTitle.textContent = searchQuery ? `🔍 "${searchQuery}"` : titles[filter] || titles.all;

  // Update search input
  if (searchInput) {
    searchInput.value = searchQuery || '';
  }

  // Update filter tabs
  document.querySelectorAll('.notes-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === filter);
  });

  // Show loading
  panelContent.innerHTML = `
    <div class="panel-loading">
      <div class="panel-loading-spinner"></div>
      <div class="panel-loading-text">Notizen laden...</div>
    </div>
  `;

  showPanel('notes-panel');

  // Load notes
  const result = await window.electronAPI.notes.getAll(filter, searchQuery);

  if (result.success && result.notes) {
    renderNotes(result.notes);

    // Update stats
    const statsResult = await window.electronAPI.notes.getStats();
    if (statsResult.success) {
      panelStats.textContent = `${result.notes.length} von ${statsResult.stats.total} Notizen`;
    } else {
      panelStats.textContent = `${result.notes.length} Notizen`;
    }
  } else {
    panelContent.innerHTML = `
      <div class="notes-empty">
        <div class="notes-empty-icon">📭</div>
        <div class="notes-empty-text">Keine Notizen gefunden</div>
      </div>
    `;
    panelStats.textContent = '0 Notizen';
  }
}

// Render notes list
function renderNotes(notes) {
  const panelContent = document.getElementById('notes-panel-content');

  if (!notes || notes.length === 0) {
    panelContent.innerHTML = `
      <div class="notes-empty">
        <div class="notes-empty-icon">📭</div>
        <div class="notes-empty-text">Keine Notizen gefunden</div>
      </div>
    `;
    return;
  }

  const html = notes.map(note => `
    <div class="note-item ${note.category}" data-id="${note.id}">
      <div class="note-header">
        <span class="note-icon">${note.icon}</span>
        <span class="note-title">${note.title}</span>
        <span class="note-time">${note.relativeTime}</span>
      </div>
      ${note.preview ? `<div class="note-preview">${note.preview.substring(0, 100)}${note.preview.length > 100 ? '...' : ''}</div>` : ''}
      ${note.tags && note.tags.length > 0 ? `
        <div class="note-tags">
          ${note.tags.slice(0, 3).map(tag => `<span class="note-tag">#${tag}</span>`).join('')}
        </div>
      ` : ''}
      ${note.url ? `<span class="note-url">${note.url}</span>` : ''}
    </div>
  `).join('');

  panelContent.innerHTML = html;

  // Add click handlers to open detail modal
  document.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.note-action-btn')) {
        openNoteDetail(item.dataset.id);
      }
    });
  });
}

// Copy note URL to clipboard
function copyNoteUrl(noteId, url) {
  if (url) {
    navigator.clipboard.writeText(url);
    console.log('Copied URL:', url);
  }
}

// Open note URL in browser
function openNoteUrl(url) {
  if (url) {
    window.open(url, '_blank');
  }
}

// Delete note
async function deleteNote(noteId) {
  if (confirm('Notiz wirklich löschen?')) {
    const result = await window.electronAPI.notes.delete(noteId);
    if (result.success) {
      // Refresh notes panel
      await showNotesPanel(currentNotesFilter, currentNotesSearch);
    }
  }
}

// Current note ID for detail modal
let currentDetailNoteId = null;

// Open note detail modal
async function openNoteDetail(noteId) {
  console.log('[NOTE-DETAIL] Opening note:', noteId);
  currentDetailNoteId = noteId;

  const modal = document.getElementById('note-detail-modal');
  const titleEl = document.getElementById('note-detail-title');
  const bodyEl = document.getElementById('note-detail-body');
  const timeEl = document.getElementById('note-detail-time');

  // Show modal with loading state
  titleEl.textContent = 'Lädt...';
  bodyEl.innerHTML = '<div style="text-align: center; padding: 20px;">⏳ Laden...</div>';
  timeEl.textContent = '';
  modal.classList.remove('hidden');

  try {
    // Fetch full content from server via IPC (includes user_id)
    const data = await window.electronAPI.notes.getContent(noteId);

    if (data.success && data.note) {
      const note = data.note;
      titleEl.textContent = note.title || 'Notiz';
      timeEl.textContent = note.date ? new Date(note.date).toLocaleString('de-DE') : '';

      // Check if it's a screenshot note
      if (note.imageUrl || note.screenshot) {
        const imageUrl = note.imageUrl;
        bodyEl.innerHTML = `
          <div class="note-detail-screenshot">
            <img src="${imageUrl}" alt="Screenshot" onclick="openScreenshotFullscreen('${imageUrl}')">
            <button class="screenshot-enlarge-btn" onclick="openScreenshotFullscreen('${imageUrl}')">
              🔍 Vergrößern
            </button>
          </div>
        `;
      } else {
        // Regular text note
        const content = note.fullContent || note.preview || '';
        bodyEl.textContent = content;
      }
    } else {
      bodyEl.innerHTML = '<div style="color: #ef4444;">Fehler beim Laden der Notiz</div>';
    }
  } catch (error) {
    console.error('[NOTE-DETAIL] Error:', error);
    bodyEl.innerHTML = '<div style="color: #ef4444;">Fehler beim Laden der Notiz</div>';
  }
}

// Close note detail modal
function closeNoteDetail() {
  const modal = document.getElementById('note-detail-modal');
  modal.classList.add('hidden');
  currentDetailNoteId = null;
}

// Delete from detail modal
async function deleteNoteFromDetail() {
  if (currentDetailNoteId && confirm('Notiz wirklich löschen?')) {
    const result = await window.electronAPI.notes.delete(currentDetailNoteId);
    if (result.success) {
      closeNoteDetail();
      await showNotesPanel(currentNotesFilter, currentNotesSearch);
    }
  }
}

// Open screenshot in fullscreen
function openScreenshotFullscreen(imageUrl) {
  const fullscreen = document.getElementById('screenshot-fullscreen');
  const img = document.getElementById('screenshot-fullscreen-img');
  img.src = imageUrl;
  fullscreen.classList.remove('hidden');
}

// Close screenshot fullscreen
function closeScreenshotFullscreen() {
  const fullscreen = document.getElementById('screenshot-fullscreen');
  fullscreen.classList.add('hidden');
}

// Setup note detail modal events
function setupNoteDetailModal() {
  // Close button
  const closeBtn = document.getElementById('note-detail-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeNoteDetail);
  }

  // Backdrop click to close
  const backdrop = document.querySelector('.note-detail-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeNoteDetail);
  }

  // Delete button
  const deleteBtn = document.getElementById('note-detail-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteNoteFromDetail);
  }

  // Screenshot fullscreen close
  const fullscreenClose = document.getElementById('screenshot-fullscreen-close');
  if (fullscreenClose) {
    fullscreenClose.addEventListener('click', closeScreenshotFullscreen);
  }

  // Screenshot backdrop click to close
  const fullscreenBackdrop = document.querySelector('.screenshot-fullscreen-backdrop');
  if (fullscreenBackdrop) {
    fullscreenBackdrop.addEventListener('click', closeScreenshotFullscreen);
  }

  // ESC key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const fullscreen = document.getElementById('screenshot-fullscreen');
      const modal = document.getElementById('note-detail-modal');
      if (!fullscreen.classList.contains('hidden')) {
        closeScreenshotFullscreen();
      } else if (!modal.classList.contains('hidden')) {
        closeNoteDetail();
      }
    }
  });
}

// Setup notes panel events
function setupNotesPanel() {
  // Close button
  const closeBtn = document.getElementById('notes-panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hidePanel('notes-panel'));
  }

  // Refresh button
  const refreshBtn = document.getElementById('notes-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      // Invalidate cache and reload
      if (window.electronAPI?.notes?.invalidateCache) {
        await window.electronAPI.notes.invalidateCache();
      }
      await showNotesPanel(currentNotesFilter, currentNotesSearch);
      setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
    });
  }

  // Search input
  const searchInput = document.getElementById('notes-search-input');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = e.target.value.trim();
        if (query) {
          showNotesPanel('all', query);
        } else {
          showNotesPanel(currentNotesFilter);
        }
      }, 300);
    });
  }

  // Filter tabs
  document.querySelectorAll('.notes-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;
      currentNotesSearch = '';
      const searchInput = document.getElementById('notes-search-input');
      if (searchInput) searchInput.value = '';
      showNotesPanel(filter);
    });
  });

  // Open webview button
  const openFolderBtn = document.getElementById('notes-panel-action');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      window.electronAPI.notes.openWebview();
    });
  }
}

// Initialize notes panel on load
document.addEventListener('DOMContentLoaded', () => {
  setupNotesPanel();
  setupNoteDetailModal();
});
