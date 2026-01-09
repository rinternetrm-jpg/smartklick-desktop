/**
 * Smartklick Multi-Monitor Docking System
 * Verwaltet Dock-Fenster auf mehreren Monitoren
 */

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const monitors = require('./monitors');
const stateSync = require('./stateSync');

// Map: displayId → { window: BrowserWindow, displayId, position }
const dockWindows = new Map();

// Dock-Größen
const DOCK_SIZES = {
  horizontal: { height: 44 },
  vertical: { width: 52 }
};

// Referenzen
let mainWindow = null;
let appBarManager = null;
let isMultiMonitorEnabled = false;

/**
 * Initialisiert das Multi-Monitor System
 */
function init(options = {}) {
  mainWindow = options.mainWindow;
  appBarManager = options.appBarManager;
  isMultiMonitorEnabled = options.enabled || false;

  // State-Sync initialisieren
  stateSync.init({
    getDockWindows: () => dockWindows
  });

  // Monitor-Events registrieren
  monitors.initMonitorEvents(
    (newDisplay) => {
      // Monitor hinzugefügt
      if (isMultiMonitorEnabled && stateSync.sharedState.isDocked) {
        createDockWindowForDisplay(newDisplay, stateSync.sharedState.dockPosition);
      }
    },
    (oldDisplay) => {
      // Monitor entfernt
      removeDockWindowForDisplay(oldDisplay.id);
    }
  );

  // IPC Handler für Multi-Monitor
  setupIpcHandlers();

  console.log('[MultiMonitorDocking] Initialisiert');
  console.log(monitors.getDisplayInfo());
}

/**
 * Aktiviert/Deaktiviert Multi-Monitor Modus
 */
function setMultiMonitorEnabled(enabled) {
  isMultiMonitorEnabled = enabled;
  console.log(`[MultiMonitorDocking] Multi-Monitor ${enabled ? 'aktiviert' : 'deaktiviert'}`);

  if (stateSync.sharedState.isDocked) {
    if (enabled) {
      // Dock auf allen Monitoren erstellen
      createDockOnAllMonitors(stateSync.sharedState.dockPosition);
    } else {
      // Nur Primary Monitor behalten
      const primaryId = screen.getPrimaryDisplay().id;
      dockWindows.forEach((entry, displayId) => {
        if (displayId !== primaryId) {
          removeDockWindowForDisplay(displayId);
        }
      });
    }
  }
}

/**
 * Erstellt Dock-Fenster auf allen Monitoren
 */
function createDockOnAllMonitors(position = 'top') {
  const displays = isMultiMonitorEnabled ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];

  displays.forEach(display => {
    createDockWindowForDisplay(display, position);
  });

  stateSync.updateSharedState({
    isDocked: true,
    dockPosition: position
  });

  console.log(`[MultiMonitorDocking] Dock erstellt auf ${displays.length} Monitor(en)`);
}

/**
 * Erstellt ein Dock-Fenster für einen bestimmten Monitor
 */
function createDockWindowForDisplay(display, position = 'top') {
  const { id } = display;

  // Bereits vorhanden?
  if (dockWindows.has(id)) {
    const existing = dockWindows.get(id);
    if (existing.window && !existing.window.isDestroyed()) {
      existing.window.show();
      return existing.window;
    }
  }

  // Bounds berechnen
  const dockBounds = calculateDockBounds(display, position);

  console.log(`[MultiMonitorDocking] Erstelle Dock für Display ${id}:`, dockBounds);

  // Fenster erstellen
  const dockWindow = new BrowserWindow({
    x: dockBounds.x,
    y: dockBounds.y,
    width: dockBounds.width,
    height: dockBounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Dock-UI laden (nutzt existierende index.html mit Dock-Bar)
  dockWindow.loadFile(path.join(__dirname, '../index.html'));

  // Always on top für Dock
  dockWindow.setAlwaysOnTop(true, 'screen-saver');

  // AppBar registrieren für diesen Monitor (wenn verfügbar)
  if (appBarManager && appBarManager.registerForDisplay) {
    const size = (position === 'top' || position === 'bottom')
      ? DOCK_SIZES.horizontal.height
      : DOCK_SIZES.vertical.width;
    appBarManager.registerForDisplay(dockWindow, position, size, display);
  }

  // In Map speichern
  dockWindows.set(id, {
    window: dockWindow,
    displayId: id,
    position: position
  });

  // Events
  dockWindow.on('closed', () => {
    dockWindows.delete(id);
  });

  // Nach Laden: State senden und Dock-Modus aktivieren
  dockWindow.webContents.on('did-finish-load', () => {
    // Dock-Modus im Renderer aktivieren
    dockWindow.webContents.send('dock:activate', {
      position: position,
      displayId: id
    });
    // State synchronisieren
    stateSync.syncStateToWindow(dockWindow);
  });

  return dockWindow;
}

/**
 * Berechnet die Dock-Position für einen Monitor
 */
function calculateDockBounds(display, position) {
  const { bounds, workArea } = display;

  switch (position) {
    case 'top':
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: DOCK_SIZES.horizontal.height
      };

    case 'bottom':
      return {
        x: bounds.x,
        y: bounds.y + bounds.height - DOCK_SIZES.horizontal.height,
        width: bounds.width,
        height: DOCK_SIZES.horizontal.height
      };

    case 'left':
      return {
        x: bounds.x,
        y: bounds.y,
        width: DOCK_SIZES.vertical.width,
        height: bounds.height
      };

    case 'right':
      return {
        x: bounds.x + bounds.width - DOCK_SIZES.vertical.width,
        y: bounds.y,
        width: DOCK_SIZES.vertical.width,
        height: bounds.height
      };

    default:
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: DOCK_SIZES.horizontal.height
      };
  }
}

/**
 * Entfernt Dock-Fenster für einen Monitor
 */
function removeDockWindowForDisplay(displayId) {
  const entry = dockWindows.get(displayId);
  if (!entry) return;

  console.log(`[MultiMonitorDocking] Entferne Dock für Display ${displayId}`);

  // AppBar entfernen
  if (appBarManager && appBarManager.unregisterForDisplay) {
    appBarManager.unregisterForDisplay(displayId);
  }

  // Fenster schließen
  if (entry.window && !entry.window.isDestroyed()) {
    entry.window.close();
  }

  dockWindows.delete(displayId);
}

/**
 * Entfernt alle Dock-Fenster (Undock)
 */
function removeAllDockWindows() {
  console.log('[MultiMonitorDocking] Entferne alle Dock-Fenster');

  dockWindows.forEach((entry, displayId) => {
    removeDockWindowForDisplay(displayId);
  });

  stateSync.updateSharedState({
    isDocked: false
  });
}

/**
 * Ändert die Position aller Docks
 */
function changeDockPosition(newPosition) {
  console.log(`[MultiMonitorDocking] Ändere Position zu: ${newPosition}`);

  // Alle Docks entfernen und neu erstellen
  const displays = [...dockWindows.keys()].map(id =>
    screen.getAllDisplays().find(d => d.id === id)
  ).filter(Boolean);

  removeAllDockWindows();

  displays.forEach(display => {
    createDockWindowForDisplay(display, newPosition);
  });

  stateSync.updateSharedState({
    dockPosition: newPosition,
    isDocked: true
  });
}

/**
 * Gibt alle Dock-Windows zurück
 */
function getDockWindows() {
  return dockWindows;
}

/**
 * Prüft ob Multi-Monitor aktiviert ist
 */
function isEnabled() {
  return isMultiMonitorEnabled;
}

/**
 * IPC Handler
 */
function setupIpcHandlers() {
  // Multi-Monitor aktivieren/deaktivieren
  // Note: main.js hat einen separaten 'multimonitor:save-setting' Handler der das Setting persistiert
  ipcMain.on('multimonitor:set-enabled', (event, enabled) => {
    setMultiMonitorEnabled(enabled);
    // Sende Event an main.js zum Persistieren
    ipcMain.emit('multimonitor:save-setting', event, enabled);
  });

  // Status abfragen
  ipcMain.handle('multimonitor:get-status', () => {
    try {
      return {
        enabled: isMultiMonitorEnabled,
        displayCount: screen.getAllDisplays().length,
        dockCount: dockWindows ? dockWindows.size : 0
      };
    } catch (err) {
      console.error('[MultiMonitorDocking] Error in get-status:', err);
      return {
        enabled: false,
        displayCount: 1,
        dockCount: 0
      };
    }
  });

  // Dock auf allen Monitoren erstellen
  ipcMain.handle('multimonitor:dock-all', (event, position) => {
    createDockOnAllMonitors(position);
    return { success: true };
  });

  // Alle Docks entfernen
  ipcMain.handle('multimonitor:undock-all', () => {
    removeAllDockWindows();
    return { success: true };
  });

  // Position ändern
  ipcMain.handle('multimonitor:change-position', (event, position) => {
    changeDockPosition(position);
    return { success: true };
  });
}

module.exports = {
  init,
  setMultiMonitorEnabled,
  createDockOnAllMonitors,
  createDockWindowForDisplay,
  removeDockWindowForDisplay,
  removeAllDockWindows,
  changeDockPosition,
  getDockWindows,
  isEnabled,
  DOCK_SIZES
};
