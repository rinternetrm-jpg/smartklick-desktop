/**
 * Smartklick Docking System
 * Ermoeglicht das Andocken an alle 4 Bildschirmkanten
 */

class DockingManager {
  constructor() {
    this.isDocked = false;
    this.dockPosition = null; // 'top', 'bottom', 'left', 'right'
    this.isApproaching = false;
    this.approachingEdge = null;
    this.snapThreshold = 80; // px vom Rand
    this.settingsPanelOpen = false;

    // Original Window-Groesse speichern
    this.originalBounds = null;

    // DOM Elements
    this.dockBar = null;
    this.indicators = {};
    this.settingsPanel = null;

    // Event handlers bound to this
    this.handleModeClick = this.handleModeClick.bind(this);
    this.handleLangClick = this.handleLangClick.bind(this);
    this.handleMicClick = this.handleMicClick.bind(this);
    this.handleSettingsClick = this.handleSettingsClick.bind(this);
    this.handleUndockClick = this.handleUndockClick.bind(this);
  }

  /**
   * Initialisiert das Docking-System
   */
  async init() {
    console.log('[Docking] Initialisiere...');

    // DOM Elements finden
    this.dockBar = document.getElementById('dockBar');
    this.indicators = {
      top: document.getElementById('dockIndicatorTop'),
      bottom: document.getElementById('dockIndicatorBottom'),
      left: document.getElementById('dockIndicatorLeft'),
      right: document.getElementById('dockIndicatorRight')
    };
    this.settingsPanel = document.getElementById('dockSettingsPanel');

    if (!this.dockBar) {
      console.error('[Docking] Dock-Bar nicht gefunden!');
      return;
    }

    // Event Listeners
    this.setupEventListeners();

    // Settings laden
    await this.loadSettings();

    // IPC Events
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

    // Settings
    const settingsBtn = this.dockBar.querySelector('#dockSettingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', this.handleSettingsClick);

    // Undock
    const undockBtn = this.dockBar.querySelector('#dockUndockBtn');
    if (undockBtn) undockBtn.addEventListener('click', this.handleUndockClick);

    // Settings Panel Checkboxes
    if (this.settingsPanel) {
      const autoSnap = this.settingsPanel.querySelector('#dockAutoSnap');
      if (autoSnap) {
        autoSnap.addEventListener('change', (e) => {
          window.electronAPI.setSetting('dockAutoSnap', e.target.checked);
        });
      }

      const snapThreshold = this.settingsPanel.querySelector('#dockSnapThreshold');
      if (snapThreshold) {
        snapThreshold.addEventListener('change', (e) => {
          this.snapThreshold = parseInt(e.target.value);
          window.electronAPI.setSetting('dockSnapThreshold', this.snapThreshold);
        });
      }

      const wakeWordToggle = this.settingsPanel.querySelector('#dockWakeWordToggle');
      if (wakeWordToggle) {
        wakeWordToggle.addEventListener('change', (e) => {
          if (e.target.checked) {
            window.electronAPI.wakeWord.start();
          } else {
            window.electronAPI.wakeWord.stop();
          }
        });
      }
    }

    // Click outside Settings Panel schliessen
    document.addEventListener('click', (e) => {
      if (this.settingsPanelOpen &&
          !this.settingsPanel.contains(e.target) &&
          !e.target.closest('#dockSettingsBtn')) {
        this.closeSettingsPanel();
      }
    });
  }

  /**
   * IPC Event Listeners
   */
  setupIpcListeners() {
    // Window Position Updates vom Main Process
    if (window.electronAPI.docking) {
      window.electronAPI.docking.onApproachingEdge((data) => {
        this.showDockIndicator(data.edge);
      });

      window.electronAPI.docking.onLeftEdge(() => {
        this.hideDockIndicators();
      });

      window.electronAPI.docking.onDocked((data) => {
        this.dock(data.position);
      });

      window.electronAPI.docking.onUndocked(() => {
        this.undock();
      });
    }
  }

  /**
   * Settings laden
   */
  async loadSettings() {
    try {
      const settings = await window.electronAPI.getSettings();

      this.snapThreshold = settings.dockSnapThreshold || 80;

      // Settings Panel aktualisieren
      if (this.settingsPanel) {
        const autoSnap = this.settingsPanel.querySelector('#dockAutoSnap');
        if (autoSnap) autoSnap.checked = settings.dockAutoSnap !== false;

        const snapThreshold = this.settingsPanel.querySelector('#dockSnapThreshold');
        if (snapThreshold) snapThreshold.value = this.snapThreshold.toString();
      }
    } catch (e) {
      console.error('[Docking] Fehler beim Laden der Settings:', e);
    }
  }

  /**
   * Zeigt den Dock-Indikator fuer eine Kante
   */
  showDockIndicator(edge) {
    this.hideDockIndicators();

    if (this.indicators[edge]) {
      this.indicators[edge].classList.add('visible');
      this.isApproaching = true;
      this.approachingEdge = edge;
    }
  }

  /**
   * Versteckt alle Dock-Indikatoren
   */
  hideDockIndicators() {
    Object.values(this.indicators).forEach(indicator => {
      if (indicator) indicator.classList.remove('visible');
    });
    this.isApproaching = false;
    this.approachingEdge = null;
  }

  /**
   * Dockt das Fenster an einer Kante an
   */
  dock(position) {
    console.log(`[Docking] Docke an: ${position}`);

    this.isDocked = true;
    this.dockPosition = position;

    // Dock-Bar anzeigen
    this.dockBar.classList.remove('hidden');

    // Orientation setzen
    if (position === 'top' || position === 'bottom') {
      this.dockBar.classList.remove('vertical', 'left', 'right');
      this.dockBar.classList.add('horizontal', position);
    } else {
      this.dockBar.classList.remove('horizontal', 'top', 'bottom');
      this.dockBar.classList.add('vertical', position);
    }

    // Settings Panel Position anpassen
    if (this.settingsPanel) {
      this.settingsPanel.className = 'dock-settings-panel';
      this.settingsPanel.classList.add(`from-${position}`);
    }

    // Haupt-UI ausblenden
    this.hideMainUI();

    // Indikatoren verstecken
    this.hideDockIndicators();

    // Event fuer andere Komponenten
    document.dispatchEvent(new CustomEvent('docking-changed', {
      detail: { isDocked: true, position }
    }));
  }

  /**
   * Loest das Fenster vom Dock
   */
  undock() {
    console.log('[Docking] Undocke...');

    this.isDocked = false;
    this.dockPosition = null;

    // Dock-Bar verstecken
    this.dockBar.classList.add('hidden');

    // Settings Panel schliessen
    this.closeSettingsPanel();

    // Haupt-UI anzeigen
    this.showMainUI();

    // Main Process informieren
    if (window.electronAPI.docking) {
      window.electronAPI.docking.undock();
    }

    // Event fuer andere Komponenten
    document.dispatchEvent(new CustomEvent('docking-changed', {
      detail: { isDocked: false, position: null }
    }));
  }

  /**
   * Versteckt die Haupt-UI (im Dock-Modus)
   */
  hideMainUI() {
    const mainApp = document.getElementById('app');
    if (mainApp) mainApp.style.display = 'none';
  }

  /**
   * Zeigt die Haupt-UI (nach Undock)
   */
  showMainUI() {
    const mainApp = document.getElementById('app');
    if (mainApp) mainApp.style.display = '';
  }

  /**
   * Mode-Dot Click Handler
   */
  handleModeClick(e) {
    const mode = e.target.dataset.mode;
    if (!mode) return;

    // Alle deaktivieren
    this.dockBar.querySelectorAll('.dock-mode-dot').forEach(dot => {
      dot.classList.remove('active');
    });

    // Angeklickten aktivieren
    e.target.classList.add('active');

    // Mode setzen (via globale Funktion oder Event)
    if (typeof window.setTonalityMode === 'function') {
      window.setTonalityMode(mode);
    }

    // Event fuer app.js
    document.dispatchEvent(new CustomEvent('dock-mode-changed', {
      detail: { mode }
    }));

    console.log(`[Docking] Mode: ${mode}`);
  }

  /**
   * Language Button Click Handler
   */
  handleLangClick(e) {
    const lang = e.target.dataset.lang;
    if (lang === undefined) return;

    // Alle deaktivieren
    this.dockBar.querySelectorAll('.dock-lang-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    // Angeklickten aktivieren
    e.target.classList.add('active');

    // Sprache setzen
    if (typeof window.setLanguage === 'function') {
      window.setLanguage(lang);
    }

    // Event fuer app.js
    document.dispatchEvent(new CustomEvent('dock-lang-changed', {
      detail: { lang }
    }));

    console.log(`[Docking] Sprache: ${lang}`);
  }

  /**
   * Mikrofon Click Handler
   */
  handleMicClick() {
    const micBtn = this.dockBar.querySelector('#dockMic');

    if (micBtn.classList.contains('recording')) {
      // Aufnahme stoppen
      if (window.electronAPI.wakeWord) {
        window.electronAPI.wakeWord.send({ type: 'stop_recording' });
      }
      micBtn.classList.remove('recording');
    } else {
      // Aufnahme starten
      if (window.electronAPI.wakeWord) {
        window.electronAPI.wakeWord.send({ type: 'start_recording' });
      }
      micBtn.classList.add('recording');
    }
  }

  /**
   * Settings Button Click Handler
   */
  handleSettingsClick() {
    if (this.settingsPanelOpen) {
      this.closeSettingsPanel();
    } else {
      this.openSettingsPanel();
    }
  }

  /**
   * Oeffnet das Settings Panel
   */
  openSettingsPanel() {
    if (this.settingsPanel) {
      this.settingsPanel.classList.add('open');
      this.settingsPanelOpen = true;
    }
  }

  /**
   * Schliesst das Settings Panel
   */
  closeSettingsPanel() {
    if (this.settingsPanel) {
      this.settingsPanel.classList.remove('open');
      this.settingsPanelOpen = false;
    }
  }

  /**
   * Undock Button Click Handler
   */
  handleUndockClick() {
    this.undock();
  }

  /**
   * Aktualisiert den Recording-Status
   */
  setRecordingState(isRecording) {
    const micBtn = this.dockBar?.querySelector('#dockMic');
    if (micBtn) {
      if (isRecording) {
        micBtn.classList.add('recording');
      } else {
        micBtn.classList.remove('recording');
      }
    }
  }

  /**
   * Aktualisiert den aktiven Mode
   */
  setActiveMode(mode) {
    if (!this.dockBar) return;

    this.dockBar.querySelectorAll('.dock-mode-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.mode === mode);
    });
  }

  /**
   * Aktualisiert die aktive Sprache
   */
  setActiveLanguage(lang) {
    if (!this.dockBar) return;

    this.dockBar.querySelectorAll('.dock-lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }

  /**
   * Prueft ob gedockt
   */
  get docked() {
    return this.isDocked;
  }

  /**
   * Gibt die Dock-Position zurueck
   */
  get position() {
    return this.dockPosition;
  }
}

// Singleton Export
const dockingManager = new DockingManager();

// Auto-Init wenn DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => dockingManager.init());
} else {
  dockingManager.init();
}

// Global verfuegbar machen
window.dockingManager = dockingManager;
