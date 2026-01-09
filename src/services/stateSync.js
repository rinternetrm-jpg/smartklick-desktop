/**
 * Smartklick Multi-Monitor - State Synchronisation
 * Synchronisiert den State über alle Dock-Fenster hinweg
 */

const { ipcMain, BrowserWindow, screen } = require('electron');

// Referenz zum Multi-Monitor Manager (wird bei init gesetzt)
let multiMonitorManager = null;

// Shared State - wird auf alle Fenster synchronisiert
const sharedState = {
  isRecording: false,
  isProcessing: false,
  activeMode: 'native',
  activeLanguage: '',
  isDocked: false,
  dockPosition: 'top'
};

// Letzter aktiver Monitor (wo zuletzt geklickt wurde)
let lastActiveDisplayId = null;

/**
 * Initialisiert die State-Synchronisation
 */
function init(manager) {
  multiMonitorManager = manager;
  setupIpcHandlers();
  console.log('[StateSync] Initialisiert');
}

/**
 * Synchronisiert State zu allen Dock-Fenstern
 */
function syncStateToAllWindows() {
  if (!multiMonitorManager) return;

  const dockWindows = multiMonitorManager.getDockWindows();
  dockWindows.forEach((entry) => {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('dock:state-update', sharedState);
    }
  });
}

/**
 * Synchronisiert State zu einem einzelnen Fenster
 */
function syncStateToWindow(window) {
  if (window && !window.isDestroyed()) {
    window.webContents.send('dock:state-update', sharedState);
  }
}

/**
 * Aktualisiert State und synchronisiert zu allen Fenstern
 */
function updateSharedState(updates) {
  Object.assign(sharedState, updates);
  syncStateToAllWindows();
  console.log('[StateSync] State aktualisiert:', Object.keys(updates).join(', '));
}

/**
 * Gibt den aktuellen State zurück
 */
function getSharedState() {
  return { ...sharedState };
}

/**
 * Setzt den aktiven Monitor (wo zuletzt geklickt wurde)
 */
function setActiveDisplay(displayId) {
  lastActiveDisplayId = displayId;
  console.log(`[StateSync] Aktiver Monitor: ${displayId}`);

  // Optional: Visuelles Feedback auf allen Monitoren
  highlightActiveMonitor(displayId);
}

/**
 * Gibt den zuletzt aktiven Monitor zurück
 */
function getLastActiveDisplay() {
  if (lastActiveDisplayId) {
    const displays = screen.getAllDisplays();
    const found = displays.find(d => d.id === lastActiveDisplayId);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

/**
 * Ermittelt welcher Monitor aktiv ist basierend auf dem Event-Sender
 */
function getActiveDisplayFromEvent(event) {
  if (!multiMonitorManager) {
    return screen.getPrimaryDisplay();
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const dockWindows = multiMonitorManager.getDockWindows();

  for (const [displayId, entry] of dockWindows.entries()) {
    if (entry.window === senderWindow) {
      return screen.getAllDisplays().find(d => d.id === displayId) || screen.getPrimaryDisplay();
    }
  }

  return screen.getPrimaryDisplay();
}

/**
 * Hebt den aktiven Monitor visuell hervor
 */
function highlightActiveMonitor(activeDisplayId) {
  if (!multiMonitorManager) return;

  const dockWindows = multiMonitorManager.getDockWindows();
  dockWindows.forEach((entry, displayId) => {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('dock:set-active', displayId === activeDisplayId);
    }
  });
}

/**
 * Setup IPC Handler für State-Updates von Renderer
 */
function setupIpcHandlers() {
  // State-Änderung von einem Dock-Fenster
  ipcMain.on('dock:state-change', (event, updates) => {
    updateSharedState(updates);
  });

  // Dock-Fenster meldet Fokus
  ipcMain.on('dock:focused', (event) => {
    const display = getActiveDisplayFromEvent(event);
    setActiveDisplay(display.id);
  });

  // Dock-Fenster meldet Klick
  ipcMain.on('dock:clicked', (event) => {
    const display = getActiveDisplayFromEvent(event);
    setActiveDisplay(display.id);
  });

  // State abfragen
  ipcMain.handle('dock:get-state', () => {
    return getSharedState();
  });

  // Recording Status
  ipcMain.on('dock:recording-state', (event, state) => {
    updateSharedState({ isRecording: state === 'recording', isProcessing: state === 'processing' });
  });

  // Modus ändern
  ipcMain.on('dock:mode-change', (event, mode) => {
    updateSharedState({ activeMode: mode });
  });

  // Sprache ändern
  ipcMain.on('dock:language-change', (event, language) => {
    updateSharedState({ activeLanguage: language });
  });
}

module.exports = {
  init,
  syncStateToAllWindows,
  syncStateToWindow,
  updateSharedState,
  getSharedState,
  setActiveDisplay,
  getLastActiveDisplay,
  getActiveDisplayFromEvent,
  sharedState
};
