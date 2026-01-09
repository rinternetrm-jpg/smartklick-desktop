/**
 * Smartklick Docking System - Nach Spezifikation
 * Magnetisches Andocken an alle 4 Bildschirmkanten
 */

class DockingManager {
  constructor() {
    this.isDocked = false;
    this.dockPosition = null; // 'top', 'bottom', 'left', 'right'

    // DOM Elements
    this.dockBar = null;
    this.indicators = {};

    // Bound handlers
    this.handleModeClick = this.handleModeClick.bind(this);
    this.handleLangClick = this.handleLangClick.bind(this);
    this.handleMicClick = this.handleMicClick.bind(this);
    this.handleFontClick = this.handleFontClick.bind(this);
    this.handleNotesClick = this.handleNotesClick.bind(this);
    this.handleEmailClick = this.handleEmailClick.bind(this);
    this.handleCalendarClick = this.handleCalendarClick.bind(this);
    this.handleSettingsClick = this.handleSettingsClick.bind(this);
    this.handleUndockClick = this.handleUndockClick.bind(this);
    this.handlePositionChange = this.handlePositionChange.bind(this);
  }

  /**
   * Initialisiert das Docking-System
   */
  async init() {
    console.log('[Docking] Initialisiere...');

    this.dockBar = document.getElementById('dockBar');
    this.indicators = {
      top: document.getElementById('dockIndicatorTop'),
      bottom: document.getElementById('dockIndicatorBottom'),
      left: document.getElementById('dockIndicatorLeft'),
      right: document.getElementById('dockIndicatorRight')
    };

    if (!this.dockBar) {
      console.error('[Docking] Dock-Bar nicht gefunden!');
      return;
    }

    this.setupEventListeners();
    this.setupIpcListeners();

    console.log('[Docking] Initialisiert');
  }

  /**
   * Event Listeners fuer Dock-Bar Elemente
   */
  setupEventListeners() {
    // Mode Dots
    this.dockBar.querySelectorAll('.dock-mode-dot').forEach(dot => {
      dot.addEventListener('click', this.handleModeClick);
    });

    // Language Buttons
    this.dockBar.querySelectorAll('.dock-lang-btn').forEach(btn => {
      btn.addEventListener('click', this.handleLangClick);
    });

    // Mikrofon
    const micBtn = this.dockBar.querySelector('#dockMic');
    if (micBtn) micBtn.addEventListener('click', this.handleMicClick);

    // A-Button (Screen Reading)
    const fontBtn = this.dockBar.querySelector('#dockFontBtn');
    if (fontBtn) fontBtn.addEventListener('click', this.handleFontClick);

    // Notes Button
    const notesBtn = this.dockBar.querySelector('#dockNotesBtn');
    if (notesBtn) notesBtn.addEventListener('click', this.handleNotesClick);

    // Email Button
    const emailBtn = this.dockBar.querySelector('#dockEmailBtn');
    if (emailBtn) emailBtn.addEventListener('click', this.handleEmailClick);

    // Calendar Button
    const calendarBtn = this.dockBar.querySelector('#dockCalendarBtn');
    if (calendarBtn) calendarBtn.addEventListener('click', this.handleCalendarClick);

    // Settings Button - oeffnet Settings Window
    const settingsBtn = this.dockBar.querySelector('#dockSettingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', this.handleSettingsClick);

    // Undock
    const undockBtn = this.dockBar.querySelector('#dockUndockBtn');
    if (undockBtn) undockBtn.addEventListener('click', this.handleUndockClick);

    // Position Selector im Settings Panel
    const positionSelect = document.getElementById('dockPositionSelect');
    if (positionSelect) positionSelect.addEventListener('change', this.handlePositionChange);

  }

  /**
   * IPC Event Listeners vom Main Process
   */
  setupIpcListeners() {
    if (window.electronAPI?.docking) {
      window.electronAPI.docking.onApproachingEdge((data) => {
        this.showIndicator(data.edge, data.intensity || 0.6);
      });

      window.electronAPI.docking.onLeftEdge(() => {
        this.hideIndicators();
      });

      window.electronAPI.docking.onDocked((data) => {
        this.onDocked(data.position);
      });

      window.electronAPI.docking.onUndocked(() => {
        this.onUndocked();
      });
    }

    // Notes Window geschlossen (von außen)
    if (window.electronAPI?.notes?.onWindowClosed) {
      window.electronAPI.notes.onWindowClosed(() => {
        this.onNotesWindowClosed();
      });
    }
  }

  /**
   * Zeigt Dock-Indikator mit Intensitaet
   */
  showIndicator(edge, intensity = 0.6) {
    this.hideIndicators();
    const indicator = this.indicators[edge];
    if (indicator) {
      indicator.style.opacity = intensity;
      indicator.classList.add('visible');
    }
  }

  /**
   * Versteckt alle Indikatoren
   */
  hideIndicators() {
    Object.values(this.indicators).forEach(ind => {
      if (ind) {
        ind.classList.remove('visible', 'snapping');
        ind.style.opacity = '';
      }
    });
  }

  /**
   * Wird aufgerufen wenn angedockt
   */
  onDocked(position) {
    console.log(`[Docking] Angedockt: ${position}`);

    this.isDocked = true;
    this.dockPosition = position;

    // Dock-Bar Klassen setzen
    this.dockBar.classList.remove('hidden', 'horizontal', 'vertical', 'top', 'bottom', 'left', 'right');

    if (position === 'top' || position === 'bottom') {
      this.dockBar.classList.add('horizontal', position);
    } else {
      this.dockBar.classList.add('vertical', position);
    }

    // Haupt-App ausblenden
    const mainApp = document.getElementById('app');
    if (mainApp) mainApp.style.display = 'none';

    // Indikatoren verstecken
    this.hideIndicators();

    // Position Selector aktualisieren
    const posSelect = document.getElementById('dockPositionSelect');
    if (posSelect) posSelect.value = position;
  }

  /**
   * Wird aufgerufen wenn abgedockt
   */
  onUndocked() {
    console.log('[Docking] Abgedockt');

    this.isDocked = false;
    this.dockPosition = null;

    // Dock-Bar verstecken
    this.dockBar.classList.add('hidden');

    // Haupt-App anzeigen
    const mainApp = document.getElementById('app');
    if (mainApp) mainApp.style.display = '';
  }

  /**
   * Settings Fenster oeffnen (separates Window)
   */
  handleSettingsClick(e) {
    e.stopPropagation();
    if (window.electronAPI?.docking) {
      window.electronAPI.docking.openSettings();
    }
  }

  /**
   * A-Button Click (Screen Reading)
   */
  handleFontClick(e) {
    e.stopPropagation();
    // Dispatch event to app.js to start screen reading
    document.dispatchEvent(new CustomEvent('dock-screen-read-clicked'));
    console.log('[Docking] Screen Reading gestartet');
  }

  /**
   * Notes-Button Click - Toggle Verhalten
   */
  async handleNotesClick(e) {
    e.stopPropagation();
    const notesBtn = this.dockBar.querySelector('#dockNotesBtn');

    if (window.electronAPI?.notes?.toggleWindow) {
      const result = await window.electronAPI.notes.toggleWindow();
      if (result.success) {
        // Icon markiert/unmarkiert je nach Zustand
        if (notesBtn) {
          notesBtn.classList.toggle('active', result.isOpen);
        }
        console.log(`[Docking] Notes ${result.isOpen ? 'geoeffnet' : 'geschlossen'}`);
      }
    } else {
      // Fallback zu altem Verhalten
      document.dispatchEvent(new CustomEvent('dock-notes-clicked'));
      console.log('[Docking] Notes geoeffnet (fallback)');
    }
  }

  /**
   * Notes-Fenster geschlossen (von außen) - Icon-Markierung entfernen
   */
  onNotesWindowClosed() {
    const notesBtn = this.dockBar?.querySelector('#dockNotesBtn');
    if (notesBtn) {
      notesBtn.classList.remove('active');
    }
    console.log('[Docking] Notes-Fenster geschlossen');
  }

  /**
   * Email-Button Click
   */
  handleEmailClick(e) {
    e.stopPropagation();
    // Dispatch event to app.js to open email
    document.dispatchEvent(new CustomEvent('dock-email-clicked'));
    console.log('[Docking] Email geoeffnet');
  }

  /**
   * Calendar-Button Click
   */
  handleCalendarClick(e) {
    e.stopPropagation();
    // Dispatch event to app.js to open calendar
    document.dispatchEvent(new CustomEvent('dock-calendar-clicked'));
    console.log('[Docking] Kalender geoeffnet');
  }

  /**
   * Position aendern (via Dropdown)
   */
  handlePositionChange(e) {
    const newPosition = e.target.value;
    if (newPosition && newPosition !== this.dockPosition) {
      // Main Process informieren
      if (window.electronAPI?.docking) {
        window.electronAPI.docking.dock(newPosition);
      }
    }
  }

  /**
   * Mode-Dot Click
   */
  handleModeClick(e) {
    const mode = e.target.dataset.mode;
    if (!mode) return;

    // Alle deaktivieren, angeklickten aktivieren
    this.dockBar.querySelectorAll('.dock-mode-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.mode === mode);
    });

    // App.js informieren
    document.dispatchEvent(new CustomEvent('dock-mode-changed', {
      detail: { mode }
    }));

    console.log(`[Docking] Mode: ${mode}`);
  }

  /**
   * Language Button Click
   */
  handleLangClick(e) {
    const lang = e.target.dataset.lang;
    if (lang === undefined) return;

    // Alle deaktivieren, angeklickten aktivieren
    this.dockBar.querySelectorAll('.dock-lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // App.js informieren
    document.dispatchEvent(new CustomEvent('dock-lang-changed', {
      detail: { lang }
    }));

    console.log(`[Docking] Sprache: ${lang}`);
  }

  /**
   * Mikrofon Click
   */
  handleMicClick() {
    const micBtn = this.dockBar.querySelector('#dockMic');
    if (!micBtn) return;

    // Toggle recording state (wird von app.js gesteuert)
    document.dispatchEvent(new CustomEvent('dock-mic-clicked'));
  }

  /**
   * Undock Click
   */
  handleUndockClick() {
    if (window.electronAPI?.docking) {
      window.electronAPI.docking.undock();
    }
  }

  /**
   * Recording-Status aktualisieren (von app.js)
   * @param {string} state - 'idle', 'recording', 'processing'
   */
  setRecordingState(state) {
    const micBtn = this.dockBar?.querySelector('#dockMic');
    const micIcon = micBtn?.querySelector('.mic-icon');
    const stopIcon = micBtn?.querySelector('.stop-icon');
    const statusText = this.dockBar?.querySelector('#dockRecordingStatus');

    if (!micBtn) return;

    // Reset classes
    micBtn.classList.remove('recording', 'processing');

    if (state === 'recording') {
      // Recording: Show stop icon, show "Aufnahme..." text
      micBtn.classList.add('recording');
      micBtn.title = 'Aufnahme stoppen';
      if (micIcon) micIcon.classList.add('hidden');
      if (stopIcon) stopIcon.classList.remove('hidden');
      if (statusText) {
        statusText.textContent = 'Aufnahme...';
        statusText.classList.remove('hidden');
      }
    } else if (state === 'processing') {
      // Processing: Show mic icon, show "Verarbeitung..." text
      micBtn.classList.add('processing');
      micBtn.title = 'Wird verarbeitet...';
      if (micIcon) micIcon.classList.remove('hidden');
      if (stopIcon) stopIcon.classList.add('hidden');
      if (statusText) {
        statusText.textContent = 'Verarbeitung...';
        statusText.classList.remove('hidden');
      }
    } else {
      // Idle: Show mic icon, hide status text
      micBtn.title = 'Aufnahme starten';
      if (micIcon) micIcon.classList.remove('hidden');
      if (stopIcon) stopIcon.classList.add('hidden');
      if (statusText) {
        statusText.classList.add('hidden');
      }
    }
  }

  /**
   * Aktiven Mode setzen (von app.js)
   */
  setActiveMode(mode) {
    if (!this.dockBar) return;
    this.dockBar.querySelectorAll('.dock-mode-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.mode === mode);
    });
  }

  /**
   * Aktive Sprache setzen (von app.js)
   */
  setActiveLanguage(lang) {
    if (!this.dockBar) return;
    this.dockBar.querySelectorAll('.dock-lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }
}

// Singleton
const dockingManager = new DockingManager();

// Auto-Init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => dockingManager.init());
} else {
  dockingManager.init();
}

// Global verfuegbar
window.dockingManager = dockingManager;
