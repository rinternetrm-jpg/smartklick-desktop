const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, clipboard, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// ============================================
// .env Datei laden (für OpenAI API Key etc.)
// WICHTIG: Muss VOR allen anderen requires passieren!
// ============================================
(function loadEnvFile() {
  // Suche .env an mehreren Orten (synchron, vor app.ready)
  const possiblePaths = [
    path.join(__dirname, '.env'),                    // Development / Source
    path.join(process.cwd(), '.env'),                // Current working directory
    path.join(process.resourcesPath || __dirname, '.env'), // Resources (Production)
  ];

  for (const envPath of possiblePaths) {
    try {
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
              process.env[key.trim()] = valueParts.join('=').trim();
            }
          }
        });
        console.log('[ENV] .env geladen von:', envPath);
        if (process.env.OPENAI_API_KEY) {
          console.log('[ENV] OPENAI_API_KEY gefunden:', process.env.OPENAI_API_KEY.substring(0, 10) + '...');
        }
        return;
      }
    } catch (error) {
      console.log('[ENV] Fehler bei:', envPath, error.message);
    }
  }
  console.log('[ENV] Keine .env Datei gefunden');
})();
const { exec, spawn } = require('child_process');
const readline = require('readline');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const SmartklickWebSocketServer = require('./src/scripts/websocketServer');

// Generate UUID without external dependency
function generateUserId() {
  return crypto.randomUUID();
}

// Google Services
const googleAuth = require('./src/services/googleAuth');
const calendarService = require('./src/services/calendarService');
const gmailService = require('./src/services/gmailService');
const notesService = require('./src/services/notesService');
const imapService = require('./src/services/imapService');
const imapAccountManager = require('./src/services/imapAccountManager');

// Intelligentes E-Mail-Klassifizierungssystem
const emailClassifier = require('./src/services/email/classifierService');

// Multi-Provider Email
const EmailProviderManager = require('./src/services/emailProviderManager');
let emailProviderManager = null;

// Windows AppBar API (reserviert Bildschirmbereich wie Taskleiste)
// Koffi-basiert - keine native Compilation nötig, funktioniert cross-platform build!
const { initNativeAPIs: initAppBarAPIs, appBarManager, isWindows: isWindowsAppBar, getInitError, wasInitCalled } = require('./src/services/appBarKoffi');

// Cursor Feedback - Fügt "Aufnahme" / "Verarbeitung" an Cursor-Position in Ziel-App ein
const cursorFeedback = require('./src/services/cursorFeedback');

// Multi-Monitor Docking System
const multiMonitorDocking = require('./src/services/multiMonitorDocking');
const monitors = require('./src/services/monitors');
const stateSync = require('./src/services/stateSync');

// Outlook OAuth Configuration
const OUTLOOK_CONFIG = {
  clientId: '5c7ce6e5-5d5d-4c0c-b0c0-5e5e5e5e5e5e', // Placeholder - User needs to set this
  redirectUri: 'http://localhost:5678/outlook/callback',
  scopes: ['Mail.Read', 'Mail.Send', 'Mail.ReadWrite', 'offline_access', 'User.Read']
};

// WebSocket Server für Chrome Extension
let wsServer = null;

const store = new Store({
  defaults: {
    user_id: null,  // Will be generated on first launch
    view_mode: 'compact',
    auto_insert: true,
    sounds: false,
    hotkey: 'CommandOrControl+Shift+S',
    autostart: false,
    always_on_top: true,
    last_tone: 'native',
    last_language: null,
    window_position: null,
    wake_word_enabled: false,  // Wake word off by default
    wake_word_threshold: 0.5,
    multi_monitor_enabled: false  // Multi-Monitor Docking off by default
  }
});

let mainWindow = null;
let tray = null;
let wakeWordProcess = null;
let wakeWordEnabled = false;

// Dictation mode
let dictationProcess = null;
let dictationActive = false;

// Screen Reading
let overlayWindow = null;
let screenReadingActive = false;

// Snap Overlay Window (fuer Dock-Indikatoren)
let snapOverlayWindow = null;

// Notes Webview Window
let notesWindow = null;

// Analysis Viewer Window
let analysisWindow = null;
let pendingAnalysisData = null;

// Email Window
let emailWindow = null;

// Calendar Window
let calendarWindow = null;

// Dock Settings Window
let dockSettingsWindow = null;

// Window sizes for each mode
const WINDOW_SIZES = {
  mini: { width: 80, height: 190 },
  compact: { width: 200, height: 340 },
  normal: { width: 220, height: 420 },
  normal_with_panel: { width: 500, height: 420 }
};

// Dock sizes for each edge
const DOCK_SIZES = {
  horizontal: { height: 44 },  // top, bottom
  vertical: { width: 48 }       // left, right
};

// Docking state
let isDocked = false;
let dockPosition = null; // 'top', 'bottom', 'left', 'right'
let preDockBounds = null; // Window bounds before docking
let snapThreshold = 80; // Pixels from edge to trigger snap
let isApproachingEdge = false;
let currentApproachingEdge = null;

function createWindow() {
  const viewMode = store.get('view_mode');
  const size = WINDOW_SIZES[viewMode] || WINDOW_SIZES.compact;
  const savedPosition = store.get('window_position');

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: savedPosition?.x,
    y: savedPosition?.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // IMMER im Vordergrund - screen-saver ist hoechste Ebene
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Bei Focus und Show erneut setzen (Windows Bug Workaround)
  mainWindow.on('focus', () => {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  mainWindow.on('show', () => {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  mainWindow.loadFile('src/index.html');

  // Save position on move + Docking detection + Bounds constraint
  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const bounds = mainWindow.getBounds();
    const currentScreen = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const { workArea } = currentScreen;

    // Mindestens 50px des Fensters muss sichtbar sein
    const minVisible = 50;
    let needsCorrection = false;
    let newX = bounds.x;
    let newY = bounds.y;

    // Linker Rand: Fenster darf nicht komplett links verschwinden
    if (bounds.x + bounds.width < workArea.x + minVisible) {
      newX = workArea.x + minVisible - bounds.width;
      needsCorrection = true;
    }
    // Rechter Rand: Fenster darf nicht komplett rechts verschwinden
    if (bounds.x > workArea.x + workArea.width - minVisible) {
      newX = workArea.x + workArea.width - minVisible;
      needsCorrection = true;
    }
    // Oberer Rand: Fenster darf nicht komplett oben verschwinden
    if (bounds.y < workArea.y) {
      newY = workArea.y;
      needsCorrection = true;
    }
    // Unterer Rand: Fenster darf nicht komplett unten verschwinden
    if (bounds.y > workArea.y + workArea.height - minVisible) {
      newY = workArea.y + workArea.height - minVisible;
      needsCorrection = true;
    }

    // Position korrigieren wenn noetig
    if (needsCorrection) {
      mainWindow.setPosition(Math.round(newX), Math.round(newY));
      return; // Nicht weiter pruefen, da wir gerade korrigiert haben
    }

    store.set('window_position', { x: bounds.x, y: bounds.y });

    // Skip if already docked
    if (isDocked) return;

    // Check for edge proximity (snap detection)
    const autoSnap = store.get('dockAutoSnap') !== false;
    if (autoSnap) {
      checkEdgeProximity(bounds.x, bounds.y);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Hide instead of close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// ========================================
// DOCKING FUNCTIONS - Magnetisches Andocken
// ========================================

const APPROACH_THRESHOLD = 150;  // Indikator erscheint
const SNAP_THRESHOLD = 80;       // Magnet-Zone
const SNAP_DURATION = 200;       // ms fuer Animation
let isSnapping = false;

// ========================================
// SNAP OVERLAY WINDOW - Visueller Indikator
// ========================================

/**
 * Erstellt das transparente Overlay-Fenster fuer Snap-Indikatoren
 */
function createSnapOverlayWindow() {
  if (snapOverlayWindow && !snapOverlayWindow.isDestroyed()) {
    return snapOverlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const { x, y } = primaryDisplay.workArea;

  snapOverlayWindow = new BrowserWindow({
    width: width,
    height: height,
    x: x,
    y: y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Klicks durch das Fenster durchlassen
  snapOverlayWindow.setIgnoreMouseEvents(true);

  // IMMER im Vordergrund - screen-saver ist hoechste Ebene
  snapOverlayWindow.setAlwaysOnTop(true, 'screen-saver');

  // Overlay HTML laden
  snapOverlayWindow.loadFile('src/overlay.html');

  snapOverlayWindow.on('closed', () => {
    snapOverlayWindow = null;
  });

  return snapOverlayWindow;
}

/**
 * Zeigt den Snap-Indikator am entsprechenden Rand
 */
function showSnapIndicator(edge, intensity = 1) {
  if (!snapOverlayWindow || snapOverlayWindow.isDestroyed()) {
    createSnapOverlayWindow();
  }

  if (snapOverlayWindow && !snapOverlayWindow.isDestroyed()) {
    snapOverlayWindow.webContents.send('show-indicator', { edge, intensity });
    if (!snapOverlayWindow.isVisible()) {
      snapOverlayWindow.show();
    }
  }
}

/**
 * Versteckt den Snap-Indikator
 */
function hideSnapIndicator() {
  if (!snapOverlayWindow || snapOverlayWindow.isDestroyed()) return;

  snapOverlayWindow.webContents.send('hide-indicator');
  // Kurz warten fuer Fade-Out Animation
  setTimeout(() => {
    if (snapOverlayWindow && !snapOverlayWindow.isDestroyed()) {
      snapOverlayWindow.hide();
    }
  }, 200);
}

/**
 * Pulse-Animation beim Snappen
 */
function pulseSnapIndicator(edge) {
  if (!snapOverlayWindow || snapOverlayWindow.isDestroyed()) return;

  snapOverlayWindow.webContents.send('pulse-indicator', { edge });
}

/**
 * Prueft ob Fenster nahe an einer Bildschirmkante ist
 */
function checkEdgeProximity(x, y) {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || isSnapping || isDocked) return;

    const bounds = mainWindow.getBounds();
    const currentScreen = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const { workArea } = currentScreen;

    // Abstaende zu allen Raendern (absolute Werte)
    const distTop = Math.abs(bounds.y - workArea.y);
    const distBottom = Math.abs((workArea.y + workArea.height) - (bounds.y + bounds.height));
    const distLeft = Math.abs(bounds.x - workArea.x);
    const distRight = Math.abs((workArea.x + workArea.width) - (bounds.x + bounds.width));

    // Finde naechsten Rand
    const distances = [
      { edge: 'top', dist: distTop },
      { edge: 'bottom', dist: distBottom },
      { edge: 'left', dist: distLeft },
      { edge: 'right', dist: distRight }
    ];

    distances.sort((a, b) => a.dist - b.dist);
    const nearest = distances[0];

    // Phase 1: Annaeherung (150px - 80px) - OVERLAY Indikator zeigen
    if (nearest.dist < APPROACH_THRESHOLD && nearest.dist >= SNAP_THRESHOLD) {
      const intensity = 1 - (nearest.dist / APPROACH_THRESHOLD);

      // Zeige Overlay-Indikator
      showSnapIndicator(nearest.edge, intensity);

      // Auch an Renderer senden (fuer lokale Effekte)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('docking-approaching-edge', {
          edge: nearest.edge,
          intensity: intensity * 0.6
        });
      }
      currentApproachingEdge = nearest.edge;
      isApproachingEdge = true;
    }
    // Phase 2: Snap-Zone (< 80px) - Magnetisch andocken
    else if (nearest.dist < SNAP_THRESHOLD) {
      // Pulse-Animation vor dem Snap
      pulseSnapIndicator(nearest.edge);
      triggerMagneticSnap(nearest.edge, workArea);
    }
    // Ausserhalb - Indikator verstecken
    else if (currentApproachingEdge) {
      // Overlay verstecken
      hideSnapIndicator();

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('docking-left-edge');
      }
      currentApproachingEdge = null;
      isApproachingEdge = false;
    }
  } catch (error) {
    console.error('[Docking] Fehler bei checkEdgeProximity:', error);
  }
}

/**
 * Triggert das magnetische Andocken mit Animation
 */
async function triggerMagneticSnap(edge, workArea) {
  if (!mainWindow || mainWindow.isDestroyed() || isDocked || isSnapping) return;

  try {
    isSnapping = true;
    console.log(`[Docking] Magnetisches Snap zu: ${edge}`);

    // Aktuelle Bounds speichern
    preDockBounds = mainWindow.getBounds();

    // Ziel-Bounds berechnen
    let targetBounds = {};

    if (edge === 'top' || edge === 'bottom') {
      targetBounds = {
        x: workArea.x,
        y: edge === 'top' ? workArea.y : workArea.y + workArea.height - DOCK_SIZES.horizontal.height,
        width: workArea.width,
        height: DOCK_SIZES.horizontal.height
      };
    } else {
      targetBounds = {
        x: edge === 'left' ? workArea.x : workArea.x + workArea.width - DOCK_SIZES.vertical.width,
        y: workArea.y,
        width: DOCK_SIZES.vertical.width,
        height: workArea.height
      };
    }

    // Renderer: Snapping-Effekt
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docking-snapping', { edge });
    }

    // Animierte Bewegung zum Rand
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setResizable(true);
      await animateWindowTo(mainWindow, targetBounds, SNAP_DURATION);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setResizable(false);
      }
    }

    // Status aktualisieren
    isDocked = true;
    dockPosition = edge;
    store.set('dock_position', edge);
    store.set('pre_dock_bounds', preDockBounds);

    // Fenster IMMER im Vordergrund - screen-saver ist hoechste Ebene
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    // Windows AppBar registrieren - reserviert Bildschirmbereich PERMANENT
    // Andere Fenster (Chrome etc.) maximieren sich NUR in den freien Bereich!
    // Logs an Renderer senden damit sie in DevTools erscheinen
    const sendLog = (msg) => {
      console.log(msg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        // JSON.stringify escaped alles sicher
        const jsonStr = JSON.stringify('[MAIN] ' + String(msg));
        mainWindow.webContents.executeJavaScript(`console.log(${jsonStr});`);
      }
    };

    sendLog('AppBar Check - isWindowsAppBar: ' + isWindowsAppBar);
    sendLog('AppBar Check - wasInitCalled: ' + wasInitCalled());
    sendLog('AppBar Check - initError: ' + (getInitError() || 'none'));

    if (isWindowsAppBar && mainWindow && !mainWindow.isDestroyed()) {
      sendLog('Rufe AppBar register auf...');
      const hwnd = mainWindow.getNativeWindowHandle();
      sendLog('HWND erhalten - Laenge: ' + (hwnd ? hwnd.length : 0));

      const size = (edge === 'top' || edge === 'bottom')
        ? DOCK_SIZES.horizontal.height
        : DOCK_SIZES.vertical.width;
      sendLog('AppBar Size: ' + size + ', Edge: ' + edge);

      try {
        // Display-Bounds für Multi-Monitor-Support
        // Den Display finden basierend auf der Fenstermitte
        const winBounds = mainWindow.getBounds();
        const centerPoint = {
          x: winBounds.x + winBounds.width / 2,
          y: winBounds.y + winBounds.height / 2
        };
        const currentDisplay = screen.getDisplayNearestPoint(centerPoint);

        // Beide Werte loggen für Debug
        sendLog('Display bounds: ' + JSON.stringify(currentDisplay.bounds));
        sendLog('Display workArea: ' + JSON.stringify(currentDisplay.workArea));

        // Für AppBar: bounds verwenden (der gesamte Monitorbereich)
        const displayBounds = {
          x: currentDisplay.bounds.x,
          y: currentDisplay.bounds.y,
          width: currentDisplay.bounds.width,
          height: currentDisplay.bounds.height
        };

        // workArea für bottom-Docking (um Taskleiste nicht zu überschreiben)
        const displayWorkArea = {
          x: currentDisplay.workArea.x,
          y: currentDisplay.workArea.y,
          width: currentDisplay.workArea.width,
          height: currentDisplay.workArea.height
        };

        sendLog('Using displayBounds: ' + JSON.stringify(displayBounds));
        sendLog('Using workArea: ' + JSON.stringify(displayWorkArea));

        const success = appBarManager.register(hwnd, edge, size, displayBounds, displayWorkArea);
        sendLog('AppBar register() Ergebnis: ' + success);

        // Debug-Logs aus AppBarManager abrufen und anzeigen
        const debugLogs = appBarManager.getDebugLogs();
        debugLogs.forEach(log => sendLog('  > ' + log));

        if (success) {
          sendLog('AppBar erfolgreich registriert fuer: ' + edge);

          // WICHTIG: Electron Fenster auch explizit positionieren!
          // SetWindowPos allein reicht nicht - Electron muss es auch wissen
          const appBarBounds = {
            x: displayBounds.x,
            y: displayBounds.y,
            width: displayBounds.width,
            height: size
          };

          // Für verschiedene Kanten
          if (edge === 'bottom') {
            // workArea verwenden um Taskleiste nicht zu überschreiben
            appBarBounds.y = displayWorkArea.y + displayWorkArea.height - size;
          } else if (edge === 'left') {
            appBarBounds.width = size;
            appBarBounds.height = displayBounds.height;
          } else if (edge === 'right') {
            appBarBounds.x = displayBounds.x + displayBounds.width - size;
            appBarBounds.width = size;
            appBarBounds.height = displayBounds.height;
          }

          sendLog('Setze Electron bounds: ' + JSON.stringify(appBarBounds));
          mainWindow.setBounds(appBarBounds);

          // Nochmal prüfen
          const actualBounds = mainWindow.getBounds();
          sendLog('Tatsaechliche Fensterposition: ' + JSON.stringify(actualBounds));

          // Finale Position nach kurzer Verzögerung erzwingen (falls etwas überschreibt)
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setBounds(appBarBounds);
              sendLog('Finale Position erzwungen: ' + JSON.stringify(mainWindow.getBounds()));
            }
          }, 150);
        } else {
          const lastError = appBarManager.getLastError();
          sendLog('AppBar FEHLER: ' + (lastError || 'unbekannt'));
        }
      } catch (err) {
        sendLog('AppBar EXCEPTION: ' + err.message);
      }
    } else {
      sendLog('AppBar NICHT aufgerufen - isWindowsAppBar=' + isWindowsAppBar);
    }

    // Renderer informieren
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docking-docked', { position: edge });
    }

    // Overlay verstecken nach erfolgreichem Snap
    hideSnapIndicator();

    // Multi-Monitor: Docks auf anderen Monitoren erstellen wenn aktiviert
    if (store.get('multi_monitor_enabled')) {
      const allDisplays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();

      // Auf allen anderen Monitoren Docks erstellen
      allDisplays.forEach(display => {
        if (display.id !== primaryDisplay.id) {
          multiMonitorDocking.createDockWindowForDisplay(display, edge);
        }
      });

      // State synchronisieren
      stateSync.updateSharedState({
        isDocked: true,
        dockPosition: edge,
        isRecording: false,
        isProcessing: false
      });

      console.log(`[MultiMonitor] Docks auf ${allDisplays.length - 1} weiteren Monitor(en) erstellt`);
    }

    console.log(`[Docking] Angedockt an: ${edge}`);
  } catch (error) {
    console.error('[Docking] Fehler beim Snap:', error);
    hideSnapIndicator();
  } finally {
    isSnapping = false;
    currentApproachingEdge = null;
  }
}

/**
 * Validiert Bounds und stellt sicher, dass sie sichtbar sind
 */
function validateBounds(bounds) {
  // Mindestgroesse sicherstellen
  const minWidth = 44;
  const minHeight = 44;

  return {
    x: isNaN(bounds.x) ? 0 : Math.round(bounds.x),
    y: isNaN(bounds.y) ? 0 : Math.round(bounds.y),
    width: Math.max(minWidth, isNaN(bounds.width) ? 200 : Math.round(bounds.width)),
    height: Math.max(minHeight, isNaN(bounds.height) ? 200 : Math.round(bounds.height))
  };
}

/**
 * Stellt sicher, dass das Fenster auf dem Bildschirm sichtbar ist
 */
function ensureWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const bounds = mainWindow.getBounds();
    const displays = screen.getAllDisplays();

    // Pruefen ob Fenster auf irgendeinem Display sichtbar ist
    let isVisible = false;
    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      if (bounds.x < x + width && bounds.x + bounds.width > x &&
          bounds.y < y + height && bounds.y + bounds.height > y) {
        isVisible = true;
        break;
      }
    }

    // Wenn nicht sichtbar, auf Primary Display zentrieren
    if (!isVisible) {
      console.log('[Window] Fenster nicht sichtbar, zentriere auf Primary Display');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { workArea } = primaryDisplay;
      const viewMode = store.get('view_mode') || 'compact';
      const size = WINDOW_SIZES[viewMode] || WINDOW_SIZES.compact;

      mainWindow.setBounds({
        x: Math.round(workArea.x + (workArea.width - size.width) / 2),
        y: Math.round(workArea.y + (workArea.height - size.height) / 2),
        width: size.width,
        height: size.height
      });
    }
  } catch (error) {
    console.error('[Window] Fehler bei ensureWindowVisible:', error);
  }
}

/**
 * Animierte Fensterbewegung mit easeOutCubic
 */
function animateWindowTo(window, targetBounds, duration) {
  return new Promise(resolve => {
    if (!window || window.isDestroyed()) {
      resolve();
      return;
    }

    const startBounds = window.getBounds();
    const startTime = Date.now();

    // Validiere Zielbounds
    const validTarget = validateBounds(targetBounds);

    function step() {
      if (!window || window.isDestroyed()) {
        resolve();
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // easeOutCubic fuer "magnetisches" Gefuehl
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentBounds = validateBounds({
        x: startBounds.x + (validTarget.x - startBounds.x) * eased,
        y: startBounds.y + (validTarget.y - startBounds.y) * eased,
        width: startBounds.width + (validTarget.width - startBounds.width) * eased,
        height: startBounds.height + (validTarget.height - startBounds.height) * eased
      });

      try {
        window.setBounds(currentBounds);
      } catch (e) {
        console.error('[Animation] Fehler bei setBounds:', e);
        resolve();
        return;
      }

      if (progress < 1) {
        setImmediate(step);
      } else {
        resolve();
      }
    }

    step();
  });
}

/**
 * Dockt das Fenster manuell an einer Kante an (ohne Animation)
 */
function dockToEdge(edge) {
  if (!mainWindow || isDocked) return;

  const currentScreen = screen.getDisplayNearestPoint(mainWindow.getBounds());
  const { workArea } = currentScreen;

  triggerMagneticSnap(edge, workArea);
}

/**
 * Loest das Fenster vom Dock
 */
function undockWindow() {
  if (!mainWindow || !isDocked) return;

  console.log('[Docking] Undocke...');

  // Alte Position wiederherstellen
  const savedBounds = preDockBounds || store.get('pre_dock_bounds');

  if (savedBounds) {
    mainWindow.setResizable(true);
    mainWindow.setBounds(savedBounds);
    mainWindow.setResizable(false);
  } else {
    // Fallback: Standard-Groesse in der Mitte
    const viewMode = store.get('view_mode') || 'compact';
    const size = WINDOW_SIZES[viewMode] || WINDOW_SIZES.compact;
    const primaryScreen = screen.getPrimaryDisplay();
    const { workArea } = primaryScreen;

    mainWindow.setResizable(true);
    mainWindow.setBounds({
      x: Math.round(workArea.x + (workArea.width - size.width) / 2),
      y: Math.round(workArea.y + (workArea.height - size.height) / 2),
      width: size.width,
      height: size.height
    });
    mainWindow.setResizable(false);
  }

  // Multi-Monitor: Alle zusätzlichen Docks entfernen
  if (store.get('multi_monitor_enabled')) {
    multiMonitorDocking.removeAllDockWindows();
    console.log('[MultiMonitor] Alle zusätzlichen Docks entfernt');
  }

  // Windows AppBar deregistrieren - gibt Bildschirmbereich wieder frei
  if (isWindowsAppBar && appBarManager.getIsRegistered()) {
    appBarManager.unregisterAll(); // unregisterAll für Multi-Monitor Support
    console.log('[Docking] AppBar deregistriert');
  }

  // Status zuruecksetzen
  isDocked = false;
  dockPosition = null;
  preDockBounds = null;
  store.delete('dock_position');
  store.delete('pre_dock_bounds');

  // Fenster IMMER im Vordergrund - screen-saver ist hoechste Ebene
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(false);

  // Multi-Monitor State aktualisieren
  stateSync.updateSharedState({
    isDocked: false,
    dockPosition: null
  });

  // Renderer informieren
  mainWindow.webContents.send('docking-undocked');

  console.log('[Docking] Undocked');
}

/**
 * Gibt aktuellen Docking-Status zurueck
 */
function getDockingStatus() {
  return {
    isDocked,
    position: dockPosition,
    preDockBounds
  };
}

// ========================================
// END DOCKING FUNCTIONS
// ========================================

function createTray() {
  // Create a simple tray icon (16x16 colored square)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABSSURBVDiNY/z//z8DJYCJgUIwaA1gZGT8T6oL/v//z8jIyEhTFzCQ7AIGBgaKXECRC0YDYTQQRgOBAkBTF1DkAkZGRvJdMBoIo4EwGggUAwCZ4BKdxAXJwQAAAABJRU5ErkJggg=='
  );

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Smartklick öffnen', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: 'Mini-Modus',
      type: 'radio',
      checked: store.get('view_mode') === 'mini',
      click: () => changeViewMode('mini')
    },
    {
      label: 'Kompakt-Modus',
      type: 'radio',
      checked: store.get('view_mode') === 'compact',
      click: () => changeViewMode('compact')
    },
    {
      label: 'Normal-Modus',
      type: 'radio',
      checked: store.get('view_mode') === 'normal',
      click: () => changeViewMode('normal')
    },
    { type: 'separator' },
    {
      label: 'Immer im Vordergrund',
      type: 'checkbox',
      checked: store.get('always_on_top'),
      click: (item) => {
        store.set('always_on_top', item.checked);
        mainWindow?.setAlwaysOnTop(item.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Beenden',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Smartklick');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      // Sicherstellen, dass Fenster sichtbar ist
      ensureWindowVisible();
    }
  });
}

function changeViewMode(mode) {
  store.set('view_mode', mode);
  const size = WINDOW_SIZES[mode];
  if (mainWindow && size) {
    mainWindow.setSize(size.width, size.height);
    mainWindow.webContents.send('view-mode-changed', mode);
  }
}

function registerHotkey() {
  const hotkey = store.get('hotkey');
  globalShortcut.unregisterAll();

  try {
    globalShortcut.register(hotkey, () => {
      mainWindow?.webContents.send('hotkey-pressed');
      if (!mainWindow?.isVisible()) {
        mainWindow?.show();
      }
    });

    // Register Ctrl+Shift+D for dictation toggle
    const dictResult = globalShortcut.register('CommandOrControl+Shift+D', () => {
      console.log('Dictation hotkey pressed (Ctrl+Shift+D)');
      toggleDictation();
    });
    console.log('Dictation hotkey registered:', dictResult);

    // Also try F9 as backup
    const f9Result = globalShortcut.register('F9', () => {
      console.log('F9 pressed - starting dictation');
      toggleDictation();
    });
    console.log('F9 hotkey registered:', f9Result);

  } catch (e) {
    console.error('Failed to register hotkey:', e);
  }
}

// ============ Dictation Mode (Hotkey-based) ============

function toggleDictation() {
  if (dictationActive) {
    stopDictation();
  } else {
    startDictation();
  }
}

function startDictation() {
  if (dictationActive) {
    console.log('Dictation already active');
    return;
  }

  const paths = getWakeWordPaths();
  if (!paths.pythonPath || !fs.existsSync(paths.pythonPath)) {
    console.error('Python not found for dictation');
    mainWindow?.webContents.send('dictation-error', { message: 'Python nicht gefunden' });
    return;
  }

  console.log('Starting dictation...');
  dictationActive = true;
  mainWindow?.webContents.send('dictation-started', {});

  // Start Python dictation service
  try {
    dictationProcess = spawn(paths.pythonPath, [
      '-c',
      `
import sys
import json
import asyncio
sys.path.insert(0, r'${paths.pythonPath.replace(/\\/g, '\\\\')}')
sys.path.insert(0, r'${path.dirname(paths.scriptPath).replace(/\\/g, '\\\\')}')

from whisper_client import WhisperClient
import sounddevice as sd
import numpy as np
import wave
import io

SAMPLE_RATE = 16000
CHANNELS = 1

async def record_and_transcribe():
    print(json.dumps({"type": "recording", "data": {}}), flush=True)

    # Record until silence
    recording = []
    silence_count = 0
    max_silence = int(3.0 * SAMPLE_RATE / 1280)  # 3 seconds silence

    def callback(indata, frames, time, status):
        recording.append(indata.copy())

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype='int16', blocksize=1280, callback=callback):
        while True:
            await asyncio.sleep(0.08)
            if len(recording) > 0:
                rms = np.sqrt(np.mean(recording[-1].astype(np.float32) ** 2))
                if rms < 500:
                    silence_count += 1
                else:
                    silence_count = 0
                if silence_count > max_silence:
                    break
                if len(recording) > int(60 * SAMPLE_RATE / 1280):  # Max 60 seconds
                    break

    if len(recording) < 10:
        print(json.dumps({"type": "error", "data": {"message": "Zu kurz"}}), flush=True)
        return

    audio = np.concatenate(recording).flatten()
    print(json.dumps({"type": "processing", "data": {}}), flush=True)

    # Convert to WAV
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(audio.tobytes())

    # Transcribe
    client = WhisperClient("http://188.40.97.126:8080")
    await client.connect()
    result = await client.transcribe(buf.getvalue(), "wav", jarvis_enabled=False, jarvis_direct_mode=False)
    await client.close()

    if result.success and result.text:
        print(json.dumps({"type": "text", "data": {"text": result.text}}), flush=True)
    else:
        print(json.dumps({"type": "error", "data": {"message": result.error or "Keine Erkennung"}}), flush=True)

asyncio.run(record_and_transcribe())
`
    ], {
      cwd: path.dirname(paths.scriptPath),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    const rl = readline.createInterface({ input: dictationProcess.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        handleDictationMessage(msg);
      } catch (e) {
        console.log('Dictation output:', line);
      }
    });

    dictationProcess.stderr.on('data', (data) => {
      console.log('Dictation log:', data.toString());
    });

    dictationProcess.on('close', (code) => {
      console.log('Dictation process ended with code:', code);
      dictationActive = false;
      dictationProcess = null;
      mainWindow?.webContents.send('dictation-ended', {});
    });

  } catch (e) {
    console.error('Failed to start dictation:', e);
    dictationActive = false;
    mainWindow?.webContents.send('dictation-error', { message: e.message });
  }
}

function stopDictation() {
  if (dictationProcess) {
    console.log('Stopping dictation...');
    dictationProcess.kill('SIGTERM');
    dictationProcess = null;
  }
  dictationActive = false;
  mainWindow?.webContents.send('dictation-ended', {});
}

function handleDictationMessage(msg) {
  const { type, data } = msg;
  console.log('Dictation message:', type, data);

  switch (type) {
    case 'recording':
      mainWindow?.webContents.send('dictation-recording', {});
      break;

    case 'processing':
      mainWindow?.webContents.send('dictation-processing', {});
      break;

    case 'text':
      if (data.text && data.text.length > 5) {
        // Filter out noise
        const noise = ['danke', 'thank you', 'thanks', 'ja', 'okay', 'ok'];
        const textLower = data.text.toLowerCase().trim().replace(/\.$/, '');
        if (!noise.includes(textLower)) {
          insertTextAtCursor(data.text);
          mainWindow?.webContents.send('dictation-text', data);
        }
      }
      break;

    case 'error':
      mainWindow?.webContents.send('dictation-error', data);
      break;
  }
}

// ============ Wake Word Service Functions ============

function getWakeWordPaths() {
  if (process.platform === 'win32') {
    // Windows: python-win is always in resources folder
    // Try multiple possible locations
    const possiblePaths = [
      path.join(process.resourcesPath, 'python-win'),  // Packaged app
      path.join(__dirname, '..', 'python-win'),        // Unpacked: main.js is in app folder
      path.join(__dirname, 'python-win'),              // Dev mode
      path.join(path.dirname(process.execPath), 'resources', 'python-win')  // Relative to exe
    ];

    let pythonDir = null;
    for (const p of possiblePaths) {
      const testPath = path.join(p, 'python.exe');
      console.log('Checking Python path:', testPath);
      if (fs.existsSync(testPath)) {
        pythonDir = p;
        console.log('Found Python at:', pythonDir);
        break;
      }
    }

    if (!pythonDir) {
      console.error('Python not found in any location!');
      pythonDir = possiblePaths[0]; // Fallback
    }

    return {
      pythonPath: path.join(pythonDir, 'python.exe'),
      scriptPath: path.join(pythonDir, 'wake_word_service.py'),
      cwd: pythonDir,
      setupScript: path.join(pythonDir, 'setup.bat'),
      checkFile: path.join(pythonDir, 'Lib', 'site-packages', 'openwakeword')
    };
  } else {
    // Linux/Mac: Use venv
    const isPackaged = app.isPackaged;
    const baseDir = isPackaged ? process.resourcesPath : __dirname;
    const venvPath = path.join(baseDir, 'python', 'venv');
    return {
      pythonPath: path.join(venvPath, 'bin', 'python'),
      scriptPath: path.join(baseDir, 'python', 'wake_word_service.py'),
      cwd: path.join(baseDir, 'python'),
      setupScript: null,
      checkFile: path.join(venvPath, 'lib', 'python3.12', 'site-packages', 'openwakeword')
    };
  }
}

function isWakeWordInstalled() {
  const paths = getWakeWordPaths();
  try {
    return fs.existsSync(paths.checkFile);
  } catch (e) {
    return false;
  }
}

async function setupWakeWord() {
  const paths = getWakeWordPaths();

  if (!paths.setupScript) {
    console.log('No setup script for this platform');
    return false;
  }

  console.log('Running Wake Word setup...');
  mainWindow?.webContents.send('wake-word-setup-started', {});

  return new Promise((resolve) => {
    const setupProcess = spawn('cmd.exe', ['/c', paths.setupScript], {
      cwd: paths.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    setupProcess.stdout.on('data', (data) => {
      console.log('Setup:', data.toString());
      mainWindow?.webContents.send('wake-word-setup-progress', { message: data.toString() });
    });

    setupProcess.stderr.on('data', (data) => {
      console.log('Setup error:', data.toString());
    });

    setupProcess.on('close', (code) => {
      console.log('Setup finished with code:', code);
      mainWindow?.webContents.send('wake-word-setup-finished', { success: code === 0 });
      resolve(code === 0);
    });
  });
}

async function startWakeWordService() {
  if (wakeWordProcess) {
    console.log('Wake Word Service already running');
    return;
  }

  const paths = getWakeWordPaths();

  // Check if Python/dependencies are installed
  if (!isWakeWordInstalled()) {
    console.log('Wake Word not installed, running setup...');
    const success = await setupWakeWord();
    if (!success) {
      console.error('Wake Word setup failed');
      mainWindow?.webContents.send('wake-word-error', { message: 'Setup fehlgeschlagen. Bitte manuell installieren.' });
      return;
    }
  }

  console.log('Starting Wake Word Service...');
  console.log('Python path:', paths.pythonPath);
  console.log('Script path:', paths.scriptPath);

  try {
    wakeWordProcess = spawn(paths.pythonPath, [paths.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: paths.cwd
    });

    wakeWordEnabled = true;

    // Handle stdout (JSON messages from Python)
    const rl = readline.createInterface({
      input: wakeWordProcess.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        handleWakeWordMessage(message);
      } catch (e) {
        console.log('Wake Word stdout:', line);
      }
    });

    // Handle stderr (logs from Python)
    wakeWordProcess.stderr.on('data', (data) => {
      console.log('Wake Word log:', data.toString());
    });

    // Handle process exit
    wakeWordProcess.on('close', (code) => {
      console.log(`Wake Word Service exited with code ${code}`);
      wakeWordProcess = null;
      wakeWordEnabled = false;
      mainWindow?.webContents.send('wake-word-status', { running: false });
    });

    wakeWordProcess.on('error', (err) => {
      console.error('Wake Word Service error:', err);
      wakeWordProcess = null;
      wakeWordEnabled = false;
    });

    mainWindow?.webContents.send('wake-word-status', { running: true });

  } catch (e) {
    console.error('Failed to start Wake Word Service:', e);
    wakeWordProcess = null;
    wakeWordEnabled = false;
  }
}

function stopWakeWordService() {
  if (!wakeWordProcess) {
    console.log('Wake Word Service not running');
    return;
  }

  console.log('Stopping Wake Word Service...');

  // Send stop command
  sendWakeWordMessage({ type: 'stop', data: {} });

  // Force kill after timeout
  setTimeout(() => {
    if (wakeWordProcess) {
      wakeWordProcess.kill('SIGTERM');
      wakeWordProcess = null;
      wakeWordEnabled = false;
    }
  }, 2000);
}

function sendWakeWordMessage(message) {
  if (wakeWordProcess && wakeWordProcess.stdin.writable) {
    wakeWordProcess.stdin.write(JSON.stringify(message) + '\n');
  }
}

function handleWakeWordMessage(message) {
  const { type, data } = message;

  console.log('Wake Word message:', type, data);

  switch (type) {
    case 'initialized':
      console.log('Wake Word Service initialized');
      mainWindow?.webContents.send('wake-word-initialized', data);
      break;

    case 'state':
      // State update (idle, listening, processing, executing)
      mainWindow?.webContents.send('wake-word-state', data);
      break;

    case 'wake_word_detected':
      // Play acknowledgment sound
      console.log('Wake word detected!');
      mainWindow?.webContents.send('wake-word-detected', {});
      // Show window if hidden
      if (!mainWindow?.isVisible()) {
        mainWindow?.show();
      }
      break;

    case 'transcription':
      // Transcribed text from voice command
      mainWindow?.webContents.send('wake-word-transcription', data);
      break;

    case 'command':
      // Parsed command ready for execution
      console.log('Executing command:', data.action);
      executeWakeWordCommand(data);
      mainWindow?.webContents.send('wake-word-command', data);
      break;

    case 'smartklick_response':
      // AI response from Smartklick
      mainWindow?.webContents.send('wake-word-smartklick-response', data);
      break;

    case 'exit_reminder':
      // Exit Reminder command - forward to renderer
      mainWindow?.webContents.send('wake-word-exit-reminder', data);
      break;

    case 'unknown_command':
      mainWindow?.webContents.send('wake-word-unknown-command', data);
      break;

    case 'text_input':
      // Insert dictated text at cursor position
      if (data.text) {
        insertTextAtCursor(data.text);
        mainWindow?.webContents.send('wake-word-text-inserted', data);
      }
      break;

    case 'error':
      console.error('Wake Word error:', data.message);
      mainWindow?.webContents.send('wake-word-error', data);
      break;

    case 'shutdown':
      console.log('Wake Word Service shut down');
      wakeWordProcess = null;
      wakeWordEnabled = false;
      mainWindow?.webContents.send('wake-word-status', { running: false });
      break;
  }
}

function insertTextAtCursor(text) {
  // Insert text at cursor position in any application
  console.log('Inserting text:', text);

  // Save current clipboard content
  const previousClipboard = clipboard.readText();

  // Copy text to clipboard
  clipboard.writeText(text);

  // Simulate Ctrl+V to paste
  if (process.platform === 'win32') {
    // Windows: Use PowerShell to simulate Ctrl+V
    const ps = spawn('powershell', ['-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 100
      [System.Windows.Forms.SendKeys]::SendWait('^v')
    `], { windowsHide: true });

    ps.on('close', () => {
      // Restore clipboard after paste (optional)
      setTimeout(() => {
        // clipboard.writeText(previousClipboard);
      }, 500);
    });
  } else if (process.platform === 'darwin') {
    // macOS: Use AppleScript
    exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
  } else {
    // Linux: Use xdotool
    exec('xdotool key ctrl+v');
  }
}

function executeWakeWordCommand(command) {
  // Execute system commands based on parsed command
  const { category, action, parameters } = command;

  switch (category) {
    case 'system':
      executeSystemCommand(action, parameters);
      break;

    case 'app':
      executeAppCommand(action, parameters);
      break;

    case 'media':
      executeMediaCommand(action, parameters);
      break;

    // Other categories are handled by the renderer
  }
}

function executeSystemCommand(action, params) {
  const platform = process.platform;

  switch (action) {
    case 'shutdown':
      if (platform === 'win32') {
        exec('shutdown /s /t 60');
      } else if (platform === 'darwin') {
        exec('sudo shutdown -h +1');
      } else {
        exec('shutdown -h +1');
      }
      break;

    case 'restart':
      if (platform === 'win32') {
        exec('shutdown /r /t 60');
      } else if (platform === 'darwin') {
        exec('sudo shutdown -r +1');
      } else {
        exec('shutdown -r +1');
      }
      break;

    case 'lock_screen':
      if (platform === 'win32') {
        exec('rundll32.exe user32.dll,LockWorkStation');
      } else if (platform === 'darwin') {
        exec('pmset displaysleepnow');
      } else {
        exec('xdg-screensaver lock');
      }
      break;

    case 'set_volume':
      const level = params.level || 50;
      if (platform === 'win32') {
        // Windows volume control via PowerShell
        exec(`powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`);
      } else if (platform === 'darwin') {
        exec(`osascript -e "set volume output volume ${level}"`);
      } else {
        exec(`amixer set Master ${level}%`);
      }
      break;

    case 'volume_up':
      if (platform === 'win32') {
        exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"');
      } else if (platform === 'darwin') {
        exec('osascript -e "set volume output volume (output volume of (get volume settings) + 10)"');
      } else {
        exec('amixer set Master 10%+');
      }
      break;

    case 'volume_down':
      if (platform === 'win32') {
        exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"');
      } else if (platform === 'darwin') {
        exec('osascript -e "set volume output volume (output volume of (get volume settings) - 10)"');
      } else {
        exec('amixer set Master 10%-');
      }
      break;

    case 'mute':
      if (platform === 'win32') {
        exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"');
      } else if (platform === 'darwin') {
        exec('osascript -e "set volume with output muted"');
      } else {
        exec('amixer set Master mute');
      }
      break;

    case 'screenshot':
      if (platform === 'win32') {
        exec('snippingtool');
      } else if (platform === 'darwin') {
        exec('screencapture -i ~/Desktop/screenshot.png');
      } else {
        exec('gnome-screenshot -i');
      }
      break;
  }
}

function executeAppCommand(action, params) {
  const platform = process.platform;
  const appName = params.app_name?.toLowerCase() || '';

  // Common app name mappings
  const appMappings = {
    'chrome': { win: 'chrome', mac: 'Google Chrome', linux: 'google-chrome' },
    'firefox': { win: 'firefox', mac: 'Firefox', linux: 'firefox' },
    'edge': { win: 'msedge', mac: 'Microsoft Edge', linux: 'microsoft-edge' },
    'vscode': { win: 'code', mac: 'Visual Studio Code', linux: 'code' },
    'terminal': { win: 'cmd', mac: 'Terminal', linux: 'gnome-terminal' },
    'explorer': { win: 'explorer', mac: 'Finder', linux: 'nautilus' },
    'notepad': { win: 'notepad', mac: 'TextEdit', linux: 'gedit' },
    'spotify': { win: 'spotify', mac: 'Spotify', linux: 'spotify' },
  };

  switch (action) {
    case 'open_app':
      const mapping = appMappings[appName] || { win: appName, mac: appName, linux: appName };
      if (platform === 'win32') {
        exec(`start ${mapping.win}`);
      } else if (platform === 'darwin') {
        exec(`open -a "${mapping.mac}"`);
      } else {
        exec(mapping.linux);
      }
      break;

    case 'close_app':
      if (platform === 'win32') {
        exec(`taskkill /im ${appName}.exe /f`);
      } else if (platform === 'darwin') {
        exec(`osascript -e 'quit app "${appName}"'`);
      } else {
        exec(`pkill ${appName}`);
      }
      break;
  }
}

function executeMediaCommand(action, params) {
  const platform = process.platform;

  // Media controls - send key presses
  switch (action) {
    case 'play':
    case 'pause':
      if (platform === 'win32') {
        exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"');
      } else if (platform === 'darwin') {
        exec('osascript -e "tell application \\"System Events\\" to key code 16"');
      } else {
        exec('xdotool key XF86AudioPlay');
      }
      break;

    case 'next_track':
      if (platform === 'win32') {
        exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"');
      } else if (platform === 'darwin') {
        exec('osascript -e "tell application \\"System Events\\" to key code 17"');
      } else {
        exec('xdotool key XF86AudioNext');
      }
      break;

    case 'previous_track':
      if (platform === 'win32') {
        exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"');
      } else if (platform === 'darwin') {
        exec('osascript -e "tell application \\"System Events\\" to key code 18"');
      } else {
        exec('xdotool key XF86AudioPrev');
      }
      break;
  }
}

// ============ Screen Reading Functions ============

// Get the display where the mouse cursor is located
function getActiveDisplay() {
  const cursorPos = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(cursorPos);
}

// Get the display index for the active display
function getActiveDisplayIndex() {
  const activeDisplay = getActiveDisplay();
  const allDisplays = screen.getAllDisplays();

  for (let i = 0; i < allDisplays.length; i++) {
    if (allDisplays[i].id === activeDisplay.id) {
      return i;
    }
  }
  return 0;
}

async function captureScreen(focusMode = false) {
  // Use the display where the mouse cursor is (not always primary)
  const activeDisplay = getActiveDisplay();
  const { width, height } = activeDisplay.size;
  const displayIndex = getActiveDisplayIndex();

  console.log(`Capturing from display ${displayIndex + 1}, size: ${width}x${height}, focusMode: ${focusMode}`);

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.max(1920, width), height: Math.max(1080, height) }
    });

    if (sources.length === 0) {
      throw new Error('Keine Bildschirmquelle gefunden');
    }

    console.log(`Found ${sources.length} screen sources`);

    // Find the correct source for the active display
    // Sources are usually named "Screen 1", "Screen 2", etc. or contain display info
    let targetSource = sources[displayIndex] || sources[0];

    // Log all sources for debugging
    sources.forEach((s, i) => {
      console.log(`Source ${i}: ${s.name} (id: ${s.display_id})`);
    });

    // Try to match by display_id if available
    const matchedSource = sources.find(s => s.display_id === String(activeDisplay.id));
    if (matchedSource) {
      targetSource = matchedSource;
      console.log(`Matched source by display_id: ${matchedSource.name}`);
    }

    let thumbnail = targetSource.thumbnail;
    const imgSize = thumbnail.getSize();

    // Im Focus-Mode: Screenshot auf Dokument-Bereich zuschneiden
    // Fokus-Bereich: Links/Rechts 15%, Oben 12%, Unten 8%
    if (focusMode) {
      const cropX = Math.floor(imgSize.width * 0.15);
      const cropY = Math.floor(imgSize.height * 0.12);
      const cropWidth = Math.floor(imgSize.width * 0.70);  // 100% - 15% - 15%
      const cropHeight = Math.floor(imgSize.height * 0.80); // 100% - 12% - 8%

      console.log(`Cropping to focus area: x=${cropX}, y=${cropY}, w=${cropWidth}, h=${cropHeight}`);

      thumbnail = thumbnail.crop({
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight
      });

      console.log(`Cropped screenshot size: ${thumbnail.getSize().width}x${thumbnail.getSize().height}`);
    }

    // Convert to PNG buffer
    const pngBuffer = thumbnail.toPNG();

    // Convert to base64
    const base64Image = pngBuffer.toString('base64');

    const finalSize = thumbnail.getSize();
    console.log(`Screenshot captured from "${targetSource.name}": ${finalSize.width}x${finalSize.height}, size: ${pngBuffer.length} bytes`);

    return {
      success: true,
      image: base64Image,
      width: finalSize.width,
      height: finalSize.height,
      displayIndex,
      focused: focusMode
    };
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Compare two base64 images to check if they are similar (same page)
function areScreenshotsSimilar(base64A, base64B) {
  // Quick check: if identical, they're the same
  if (base64A === base64B) return true;

  // Compare a sample of the middle part (not start/end which may have headers)
  const sampleSize = 5000;
  const startA = Math.floor(base64A.length / 2) - sampleSize / 2;
  const startB = Math.floor(base64B.length / 2) - sampleSize / 2;

  if (startA < 0 || startB < 0) {
    // Too small, compare full
    return base64A === base64B;
  }

  const sampleA = base64A.substring(startA, startA + sampleSize);
  const sampleB = base64B.substring(startB, startB + sampleSize);

  // Count matching characters
  let matches = 0;
  for (let i = 0; i < sampleSize; i++) {
    if (sampleA[i] === sampleB[i]) matches++;
  }

  const similarity = matches / sampleSize;
  console.log(`Screenshot similarity: ${(similarity * 100).toFixed(1)}%`);

  // If more than 95% similar, consider them the same
  return similarity > 0.95;
}

// Scroll and capture multiple screenshots
async function captureWithScroll(maxScrolls = 3) {
  const screenshots = [];

  console.log(`Starting scroll capture, max ${maxScrolls} scrolls`);

  // IMPORTANT: First activate the previous window so Page Down works there
  console.log('Activating previous window...');
  await activatePreviousWindow();
  await new Promise(resolve => setTimeout(resolve, 400));

  // First screenshot without scrolling - this is the most important one!
  const firstCapture = await captureScreen();
  if (firstCapture.success) {
    screenshots.push(firstCapture.image);
    console.log(`Screenshot 1 captured (primary)`);
  }

  // Now scroll and capture more - but be smarter about it
  let consecutiveSimilar = 0;

  for (let i = 1; i < maxScrolls; i++) {
    // Scroll down
    console.log(`Scrolling... (${i})`);
    await simulateScroll();

    // Wait for scroll animation and page render
    await new Promise(resolve => setTimeout(resolve, 600));

    // Capture
    const capture = await captureScreen();
    if (!capture.success) {
      console.error(`Screenshot ${i + 1} failed`);
      break;
    }

    // Check if page actually scrolled (compare with previous)
    const prev = screenshots[screenshots.length - 1];
    const curr = capture.image;

    // Better comparison using sample comparison
    if (areScreenshotsSimilar(prev, curr)) {
      consecutiveSimilar++;
      console.log(`Page end detected - screenshot ${i + 1} similar to previous (${consecutiveSimilar})`);

      // If we get 2 similar screenshots in a row, stop
      if (consecutiveSimilar >= 1) {
        console.log('Stopping scroll - reached end of content');
        break;
      }
    } else {
      consecutiveSimilar = 0;
      screenshots.push(curr);
      console.log(`Screenshot ${i + 1} captured (new content)`);
    }
  }

  console.log(`Scroll capture complete: ${screenshots.length} screenshots`);

  // Scroll back to top
  if (screenshots.length > 1) {
    console.log('Scrolling back to top...');
    await scrollToTop();
  }

  return {
    success: true,
    images: screenshots,
    count: screenshots.length
  };
}

// Activate the previous window (Alt+Tab) using VBScript - much faster than PowerShell
async function activatePreviousWindow() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Write a temporary VBScript file and execute it
      const vbsPath = path.join(require('os').tmpdir(), 'smartklick_alttab.vbs');
      const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.SendKeys "%{TAB}"`;

      fs.writeFileSync(vbsPath, vbsContent);
      exec(`cscript //nologo "${vbsPath}"`, { windowsHide: true }, (err) => {
        if (err) console.error('Alt+Tab error:', err.message);
        resolve();
      });
    } else if (process.platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to keystroke tab using command down'`, () => resolve());
    } else {
      exec('xdotool key alt+Tab', () => resolve());
    }
  });
}

// Simulate scrolling using VBScript - much faster and more reliable
async function simulateScroll() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Write a temporary VBScript file and execute it
      const vbsPath = path.join(require('os').tmpdir(), 'smartklick_scroll.vbs');
      // {PGDN} sends Page Down key
      const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.SendKeys "{PGDN}{PGDN}{PGDN}"`;

      fs.writeFileSync(vbsPath, vbsContent);
      exec(`cscript //nologo "${vbsPath}"`, { windowsHide: true }, (err) => {
        if (err) console.error('Scroll error:', err.message);
        resolve();
      });
    } else if (process.platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to key code 121' -e 'tell application "System Events" to key code 121'`, () => resolve());
    } else {
      exec('xdotool key Page_Down Page_Down Page_Down', () => resolve());
    }
  });
}

// Scroll back to top using Ctrl+Home
async function scrollToTop() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const vbsPath = path.join(require('os').tmpdir(), 'smartklick_top.vbs');
      // ^{HOME} sends Ctrl+Home to go to top of document
      const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.SendKeys "^{HOME}"`;

      fs.writeFileSync(vbsPath, vbsContent);
      exec(`cscript //nologo "${vbsPath}"`, { windowsHide: true }, (err) => {
        if (err) console.error('Scroll to top error:', err.message);
        resolve();
      });
    } else if (process.platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to key code 115 using command down'`, () => resolve());
    } else {
      exec('xdotool key ctrl+Home', () => resolve());
    }
  });
}

function createOverlayWindow() {
  // Use the display where the mouse cursor is (for multi-monitor setups)
  const activeDisplay = getActiveDisplay();
  const { width, height } = activeDisplay.size;
  const { x, y } = activeDisplay.bounds;

  console.log(`Creating overlay on display at position (${x}, ${y}), size: ${width}x${height}`);

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load overlay HTML - content stays visible, only frame around it
  const overlayHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          width: 100vw;
          height: 100vh;
          background: transparent;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        /* Frame borders - content stays visible */
        .frame-top {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 50px;
          background: #1a1a1a;
        }
        .frame-bottom {
          position: absolute;
          bottom: 5px;
          left: 0;
          right: 0;
          height: 70px;
          background: #1a1a1a;
        }
        .frame-left {
          position: absolute;
          top: 50px;
          left: 0;
          width: 20px;
          bottom: 75px;
          background: #1a1a1a;
        }
        .frame-right {
          position: absolute;
          top: 50px;
          right: 0;
          width: 20px;
          bottom: 75px;
          background: #1a1a1a;
        }

        /* Cyan border around visible content */
        .content-border {
          position: absolute;
          top: 50px;
          left: 20px;
          right: 20px;
          bottom: 75px;
          border: 3px solid #06b6d4;
          border-radius: 4px;
          pointer-events: none;
          box-shadow: 0 0 20px rgba(6, 182, 212, 0.4), inset 0 0 20px rgba(6, 182, 212, 0.1);
        }

        /* Scan line - bounces up and down */
        .scan-line {
          position: absolute;
          left: 20px;
          right: 20px;
          height: 4px;
          background: linear-gradient(90deg,
            transparent 0%,
            #06b6d4 10%,
            #22d3ee 50%,
            #06b6d4 90%,
            transparent 100%);
          box-shadow: 0 0 15px #06b6d4, 0 0 30px #22d3ee;
          animation: scan-bounce 2s ease-in-out infinite;
          z-index: 10;
        }

        @keyframes scan-bounce {
          0%, 100% { top: 50px; }
          50% { top: calc(100% - 80px); }
        }

        /* Header in top frame */
        .header {
          position: absolute;
          top: 12px;
          left: 0;
          right: 0;
          text-align: center;
          color: #06b6d4;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 2px;
          z-index: 5;
        }

        /* Status bar in bottom frame */
        .status-bar {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #1a1a1a;
          color: #06b6d4;
          padding: 10px 25px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
          border: 2px solid #06b6d4;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 5;
        }

        .status-bar .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid #06b6d4;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Corner accents */
        .corner {
          position: absolute;
          width: 25px;
          height: 25px;
          border: 3px solid #22d3ee;
          z-index: 10;
        }
        .corner-tl { top: 47px; left: 17px; border-right: none; border-bottom: none; }
        .corner-tr { top: 47px; right: 17px; border-left: none; border-bottom: none; }
        .corner-bl { bottom: 72px; left: 17px; border-right: none; border-top: none; }
        .corner-br { bottom: 72px; right: 17px; border-left: none; border-top: none; }
      </style>
    </head>
    <body>
      <div class="frame-top"></div>
      <div class="frame-bottom"></div>
      <div class="frame-left"></div>
      <div class="frame-right"></div>
      <div class="content-border"></div>
      <div class="scan-line"></div>
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>
      <div class="header">SMARTKLICK BILDSCHIRM-ANALYSE</div>
      <div class="status-bar">
        <div class="spinner"></div>
        <span>Analysiere mit Smartklick...</span>
      </div>
    </body>
    </html>
  `;

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`);
  overlayWindow.setIgnoreMouseEvents(true);

  return overlayWindow;
}

function closeOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

// Analyze screen for summary (standard mode)
async function analyzeScreenWithGPT4Vision(images) {
  // Accept single image or array of images
  const imageArray = Array.isArray(images) ? images : [images];

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      images: imageArray,
      prompt: imageArray.length > 1
        ? 'Diese Screenshots zeigen eine scrollbare Seite. Analysiere den gesamten Inhalt aller Screenshots zusammen. Beschreibe den Hauptinhalt kurz und prägnant auf Deutsch. Was ist das Wichtigste?'
        : 'Analysiere diesen Bildschirminhalt. Beschreibe den Hauptinhalt kurz und prägnant auf Deutsch. Was ist das Wichtigste, was der Benutzer wissen sollte?'
    });

    const options = {
      hostname: '188.40.97.126',
      port: 8080,
      path: '/analyze-screen',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// Analyze screen for spelling/grammar corrections (Learning mode - violet)
async function analyzeScreenForCorrections(images) {
  const imageArray = Array.isArray(images) ? images : [images];

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      images: imageArray,
      language: 'de'
    });

    const options = {
      hostname: '188.40.97.126',
      port: 8080,
      path: '/analyze-corrections',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(180000, () => {  // 3 minutes for correction analysis (2 API calls)
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// Create overlay for Learning mode (violet theme)
function createLearningOverlayWindow() {
  const activeDisplay = getActiveDisplay();
  const { width, height } = activeDisplay.size;
  const { x, y } = activeDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Fokus-Bereich: Nur der mittlere Dokumentbereich wird gescannt
  // Links/Rechts: 15% Rand (für Seitenleisten)
  // Oben: 12% (für Menüs/Ribbons)
  // Unten: 8% (für Taskleiste/Statusleiste)
  const overlayHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          width: 100vw;
          height: 100vh;
          background: transparent;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        /* Dunkle Bereiche außerhalb des Fokus */
        .dim-overlay {
          position: absolute;
          background: rgba(0, 0, 0, 0.75);
        }
        .dim-top { top: 0; left: 0; right: 0; height: 12%; }
        .dim-bottom { bottom: 0; left: 0; right: 0; height: 8%; }
        .dim-left { top: 12%; left: 0; width: 15%; bottom: 8%; }
        .dim-right { top: 12%; right: 0; width: 15%; bottom: 8%; }

        /* Fokus-Bereich (transparent mit Rahmen) */
        .focus-area {
          position: absolute;
          top: 12%;
          left: 15%;
          right: 15%;
          bottom: 8%;
          border: 3px solid #8b5cf6;
          border-radius: 8px;
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.6),
                      0 0 60px rgba(139, 92, 246, 0.3),
                      inset 0 0 30px rgba(139, 92, 246, 0.1);
        }

        /* Scan-Linie NUR im Fokus-Bereich */
        .scan-line {
          position: absolute;
          left: 15%;
          right: 15%;
          height: 4px;
          background: linear-gradient(90deg,
            transparent 0%,
            #8b5cf6 5%,
            #a78bfa 50%,
            #8b5cf6 95%,
            transparent 100%);
          box-shadow: 0 0 20px #8b5cf6, 0 0 40px #a78bfa, 0 0 60px #8b5cf6;
          animation: scan-focus 1.8s ease-in-out infinite;
          z-index: 10;
        }

        @keyframes scan-focus {
          0%, 100% { top: 12%; }
          50% { top: calc(92% - 4px); }
        }

        /* Ecken-Markierungen */
        .corner {
          position: absolute;
          width: 30px;
          height: 30px;
          border: 4px solid #a78bfa;
          z-index: 15;
        }
        .corner-tl { top: calc(12% - 4px); left: calc(15% - 4px); border-right: none; border-bottom: none; border-radius: 8px 0 0 0; }
        .corner-tr { top: calc(12% - 4px); right: calc(15% - 4px); border-left: none; border-bottom: none; border-radius: 0 8px 0 0; }
        .corner-bl { bottom: calc(8% - 4px); left: calc(15% - 4px); border-right: none; border-top: none; border-radius: 0 0 0 8px; }
        .corner-br { bottom: calc(8% - 4px); right: calc(15% - 4px); border-left: none; border-top: none; border-radius: 0 0 8px 0; }

        /* Label oben */
        .header {
          position: absolute;
          top: calc(12% - 35px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(139, 92, 246, 0.9);
          color: white;
          padding: 8px 20px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 1px;
          z-index: 20;
          white-space: nowrap;
        }

        /* Status unten */
        .status-bar {
          position: absolute;
          bottom: calc(8% - 45px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(26, 26, 26, 0.95);
          color: #8b5cf6;
          padding: 12px 25px;
          border-radius: 25px;
          font-size: 14px;
          font-weight: 500;
          border: 2px solid #8b5cf6;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 20;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }

        .status-bar .spinner {
          width: 16px;
          height: 16px;
          border: 3px solid #8b5cf6;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Hinweis-Text */
        .hint {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: rgba(255, 255, 255, 0.15);
          font-size: 24px;
          font-weight: 300;
          letter-spacing: 3px;
          pointer-events: none;
          z-index: 5;
        }
      </style>
    </head>
    <body>
      <!-- Dunkle Bereiche -->
      <div class="dim-overlay dim-top"></div>
      <div class="dim-overlay dim-bottom"></div>
      <div class="dim-overlay dim-left"></div>
      <div class="dim-overlay dim-right"></div>

      <!-- Fokus-Bereich -->
      <div class="focus-area"></div>
      <div class="scan-line"></div>

      <!-- Ecken -->
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>

      <!-- Labels -->
      <div class="header">DOKUMENT-ANALYSE</div>
      <div class="hint">SCAN-BEREICH</div>
      <div class="status-bar">
        <div class="spinner"></div>
        <span>Analysiere Dokumentinhalt...</span>
      </div>
    </body>
    </html>
  `;

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`);
  overlayWindow.setIgnoreMouseEvents(true);

  return overlayWindow;
}

// Start screen reading - mode determines if summary or correction analysis
// mode: 'summary' (default) or 'learning' (violet - correction analysis)
async function startScreenReading(withScroll = true, mode = 'summary') {
  if (screenReadingActive) {
    console.log('Screen reading already active');
    return { success: false, error: 'Bereits aktiv' };
  }

  const isLearningMode = mode === 'learning';
  console.log(`Starting screen reading in ${isLearningMode ? 'LEARNING' : 'SUMMARY'} mode`);

  screenReadingActive = true;
  mainWindow?.webContents.send('screen-reading-started', { mode });

  try {
    // 1. Zuerst Overlay anzeigen (für visuelles Feedback)
    if (isLearningMode) {
      createLearningOverlayWindow();
    } else {
      createOverlayWindow();
    }

    // Kurz warten damit User das Overlay sieht
    await new Promise(resolve => setTimeout(resolve, 300));

    let images = [];

    if (isLearningMode) {
      // Learning Mode: Nur den Fokus-Bereich capturen (kein Scrollen)
      // Das Overlay zeigt genau den Bereich der gescannt wird
      console.log('Learning mode: Capturing focused document area only');
      const capture = await captureScreen(true);  // focusMode = true
      if (capture.success) {
        images = [capture.image];
        console.log(`Captured focused area: ${capture.width}x${capture.height}`);
      }
    } else if (withScroll) {
      // Summary Mode mit Scroll: Ganzer Bildschirm mit Scrollen
      const scrollCapture = await captureWithScroll(5);
      if (scrollCapture.success) {
        images = scrollCapture.images;
        console.log(`Captured ${images.length} screenshots with scroll`);
      }
    } else {
      // Summary Mode ohne Scroll: Ganzer Bildschirm einmalig
      const capture = await captureScreen(false);
      if (capture.success) {
        images = [capture.image];
      }
    }

    if (images.length === 0) {
      closeOverlayWindow();
      throw new Error('Keine Screenshots erfasst');
    }

    // 4. Send to API
    mainWindow?.webContents.send('screen-reading-analyzing', { mode });

    let result;
    if (isLearningMode) {
      // Learning mode: Correction analysis
      result = await analyzeScreenForCorrections(images);

      closeOverlayWindow();
      screenReadingActive = false;

      mainWindow?.webContents.send('screen-reading-corrections', {
        success: result.success,
        extracted_text: result.extracted_text,
        total_errors: result.total_errors || 0,
        errors_by_category: result.errors_by_category || {},
        errors: result.errors || [],
        processingTime: result.processingTime,
        screenshotCount: images.length
      });

      return {
        success: true,
        mode: 'learning',
        total_errors: result.total_errors,
        errors: result.errors,
        screenshotCount: images.length
      };
    } else {
      // Standard mode: Summary
      result = await analyzeScreenWithGPT4Vision(images);

      closeOverlayWindow();
      screenReadingActive = false;

      mainWindow?.webContents.send('screen-reading-complete', {
        success: true,
        summary: result.summary || result.text || 'Keine Analyse verfügbar',
        details: result.details || null,
        screenshotCount: images.length
      });

      return {
        success: true,
        mode: 'summary',
        summary: result.summary || result.text,
        details: result.details,
        screenshotCount: images.length
      };
    }

  } catch (error) {
    closeOverlayWindow();
    screenReadingActive = false;
    console.error('Screen reading failed:', error);

    mainWindow?.webContents.send('screen-reading-error', {
      error: error.message
    });

    return {
      success: false,
      error: error.message
    };
  }
}

// ============ IPC Handlers ============
ipcMain.handle('get-settings', () => store.store);
ipcMain.handle('set-setting', (_, key, value) => store.set(key, value));
ipcMain.handle('get-view-mode', () => store.get('view_mode'));

// Docking IPC handlers
ipcMain.handle('docking:getStatus', () => getDockingStatus());
ipcMain.handle('docking:dock', (_, edge) => dockToEdge(edge));
ipcMain.handle('docking:undock', () => undockWindow());
ipcMain.handle('docking:setSnapThreshold', (_, threshold) => {
  snapThreshold = threshold;
  store.set('dockSnapThreshold', threshold);
});

// Multi-Monitor IPC Handler: Store Setting speichern (zusätzlich zu multiMonitorDocking.js)
// Note: Die anderen IPC Handler werden von multiMonitorDocking.setupIpcHandlers() registriert
ipcMain.on('multimonitor:save-setting', (_, enabled) => {
  store.set('multi_monitor_enabled', enabled);
  console.log('[MultiMonitor] Setting saved:', enabled);
});

// Cursor Feedback IPC handlers - fügt Text an Cursor-Position in Ziel-App ein
ipcMain.handle('cursor-feedback:show-recording', async () => {
  return await cursorFeedback.showRecording();
});

ipcMain.handle('cursor-feedback:show-processing', async () => {
  return await cursorFeedback.showProcessing();
});

ipcMain.handle('cursor-feedback:insert-final', async (_, text) => {
  return await cursorFeedback.insertFinalText(text);
});

ipcMain.handle('cursor-feedback:cancel', async () => {
  return await cursorFeedback.cancel();
});

ipcMain.handle('cursor-feedback:get-status', () => {
  return cursorFeedback.getStatus();
});

// Screen Reading IPC handlers
// mode can be 'summary' (default) or 'learning' (violet - correction analysis)
ipcMain.handle('start-screen-reading', async (_, options = {}) => {
  const { withScroll = true, mode = 'summary' } = options;
  return await startScreenReading(withScroll, mode);
});

ipcMain.on('cancel-screen-reading', () => {
  closeOverlayWindow();
  screenReadingActive = false;
  mainWindow?.webContents.send('screen-reading-cancelled', {});
});

// Wake Word Service IPC handlers - DISABLED (Wake Word removed)
ipcMain.on('wake-word-start', () => { /* Wake Word disabled */ });
ipcMain.on('wake-word-stop', () => { /* Wake Word disabled */ });
ipcMain.on('wake-word-send', (_, message) => { /* Wake Word disabled */ });
ipcMain.handle('wake-word-status', () => ({ running: false }));
ipcMain.on('wake-word-set-threshold', (_, threshold) => { /* Wake Word disabled */ });

ipcMain.on('change-view-mode', (_, mode) => changeViewMode(mode));

ipcMain.on('resize-window', (_, width, height) => {
  mainWindow?.setSize(width, height);
});

ipcMain.on('show-panel', (_, panelType) => {
  // Always expand window to show panel, regardless of current mode
  mainWindow?.setSize(500, 420);
  mainWindow?.webContents.send('view-mode-changed', 'normal_with_panel');
});

ipcMain.on('hide-panel', () => {
  const currentMode = store.get('view_mode');
  // Restore to previous mode size
  const sizes = {
    mini: { width: 80, height: 190 },
    compact: { width: 200, height: 340 },
    normal: { width: 220, height: 420 }
  };
  const size = sizes[currentMode] || sizes.normal;
  mainWindow?.setSize(size.width, size.height);
  mainWindow?.webContents.send('view-mode-changed', currentMode);
});

// Click-through for transparent areas
ipcMain.on('set-ignore-mouse-events', (_, ignore, options) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, options || {});
  }
});

// Paste text into active application (like pyautogui in Python version)
ipcMain.handle('paste-text', async (_, text) => {
  console.log('=== PASTE TEXT HANDLER ===');
  console.log('Received text:', text);
  console.log('Platform:', process.platform);

  // 1. Copy to clipboard
  clipboard.writeText(text);
  console.log('Text copied to clipboard');

  // Verify clipboard content
  const clipboardContent = clipboard.readText();
  console.log('Clipboard verification:', clipboardContent === text ? 'OK' : 'MISMATCH');

  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows: Alt+Tab to switch window, then Ctrl+V to paste
      // Same approach as Python pyautogui version
      const cmd = `powershell -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{TAB}'); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('^v')"`;
      console.log('Executing Windows paste command...');

      exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          console.error('Paste error:', err.message);
          console.error('stderr:', stderr);
        } else {
          console.log('Paste command executed successfully');
        }
        resolve(!err);
      });
    } else if (process.platform === 'darwin') {
      // macOS: Cmd+Tab then Cmd+V
      console.log('Executing macOS paste command...');
      exec('osascript -e \'tell application "System Events" to keystroke tab using command down\' -e \'delay 0.3\' -e \'tell application "System Events" to keystroke "v" using command down\'', (err, stdout, stderr) => {
        if (err) {
          console.error('Paste error:', err.message);
          console.error('stderr:', stderr);
        }
        resolve(!err);
      });
    } else {
      // Linux: Alt+Tab then Ctrl+V
      console.log('Executing Linux paste command...');
      exec('xdotool key alt+Tab && sleep 0.3 && xdotool key ctrl+v', (err, stdout, stderr) => {
        if (err) {
          console.error('Paste error:', err.message);
          console.error('stderr:', stderr);
        } else {
          console.log('Paste command executed successfully');
        }
        resolve(!err);
      });
    }
  });
});

// === Text-Analyse für Chrome Extension ===
async function analyzeTextForCorrections(text, elements) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: text,
      language: 'de'
    });

    const options = {
      hostname: '188.40.97.126',
      port: 8080,
      path: '/analyze-text-corrections',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (result.success && result.errors) {
            // Fehler in das Format für die Extension konvertieren
            // UND Positionen aus den extrahierten Elementen hinzufügen
            const extensionErrors = [];

            result.errors.forEach((err, index) => {
              const errorWord = err.original || err.word || '';
              if (!errorWord) return;

              // Finde das Element, das dieses Wort enthält
              for (const element of elements) {
                if (element.text.includes(errorWord)) {
                  // Suche die Wort-Position in den extrahierten Wörtern
                  let wordPosition = null;

                  if (element.words && element.words.length > 0) {
                    // Exakte Übereinstimmung in Wort-Array suchen
                    const wordData = element.words.find(w =>
                      w.word === errorWord ||
                      w.word.toLowerCase() === errorWord.toLowerCase()
                    );
                    if (wordData && wordData.rect) {
                      wordPosition = {
                        x: wordData.rect.x,
                        y: wordData.rect.y,
                        width: wordData.rect.width,
                        height: wordData.rect.height
                      };
                    }
                  }

                  // Fallback: Element-Position verwenden
                  if (!wordPosition && element.position) {
                    wordPosition = {
                      x: element.position.x,
                      y: element.position.y,
                      width: Math.min(errorWord.length * 10, element.position.width),
                      height: element.position.height
                    };
                  }

                  if (wordPosition) {
                    // Fehlertyp-Styling
                    const categoryStyles = {
                      spelling: { color: '#ef4444', icon: '📝', name: 'Rechtschreibung' },
                      grammar: { color: '#f97316', icon: '🔄', name: 'Grammatik' },
                      capitalization: { color: '#eab308', icon: '🔠', name: 'Großschreibung' },
                      punctuation: { color: '#8b5cf6', icon: '✏️', name: 'Zeichensetzung' },
                      word_order: { color: '#3b82f6', icon: '↔️', name: 'Wortstellung' },
                      article: { color: '#22c55e', icon: '📖', name: 'Artikel' }
                    };

                    const category = err.category || 'spelling';
                    const style = categoryStyles[category] || categoryStyles.spelling;

                    extensionErrors.push({
                      id: `error-${index}-${Date.now()}`,
                      original: errorWord,
                      correction: err.correction || err.corrected || '',
                      category: category,
                      categoryName: style.name,
                      icon: style.icon,
                      color: style.color,
                      severity: err.severity || 'medium',
                      context: err.context || '',
                      explanation: err.explanation || err.reason || `"${errorWord}" → "${err.correction || err.corrected}"`,
                      rule: err.rule || '',
                      elementId: element.id,
                      position: wordPosition
                    });

                    break; // Nur einmal pro Fehler
                  }
                }
              }
            });

            console.log(`${extensionErrors.length} Fehler mit Positionen gefunden`);
            resolve(extensionErrors);
          } else {
            resolve([]);
          }
        } catch (e) {
          console.error('JSON Parse Error:', e);
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// === WebSocket Server für Chrome Extension ===
function initWebSocketServer() {
  console.log('=== INITIALIZING WEBSOCKET SERVER ===');

  try {
    // Prüfen ob ws Modul verfügbar ist
    let WebSocket;
    try {
      WebSocket = require('ws');
      console.log('ws Modul gefunden, Version:', require('ws/package.json').version);
    } catch (wsErr) {
      console.error('ws Modul NICHT gefunden:', wsErr.message);
      return;
    }

    wsServer = new SmartklickWebSocketServer(9876);

    // Server-Error Event vor start() registrieren
    wsServer.on('server-error', (error) => {
      console.error('WebSocket Server Error Event:', error.message);
      if (error.code === 'EADDRINUSE') {
        console.error('Port 9876 ist bereits in Verwendung!');
      }
    });

    wsServer.start();

    // Prüfen ob Server wirklich läuft
    setTimeout(() => {
      const status = wsServer.getStatus();
      console.log('WebSocket Server Status nach 1s:', status);
      if (!status.running) {
        console.error('WebSocket Server ist NICHT gestartet!');
      }
    }, 1000);

    // Extension verbunden
    wsServer.on('extension-connected', (info) => {
      console.log('Chrome Extension verbunden:', info);
      if (mainWindow) {
        mainWindow.webContents.send('extension-status', { connected: true, version: info.version });
      }
    });

    // Extension getrennt
    wsServer.on('extension-disconnected', () => {
      console.log('Chrome Extension getrennt');
      if (mainWindow) {
        mainWindow.webContents.send('extension-status', { connected: false });
      }
    });

    // Seiteninhalt von Extension empfangen
    wsServer.on('page-content', async (content) => {
      console.log(`Seite analysieren: ${content.url}`);
      console.log(`${content.elements.length} Text-Elemente`);

      if (mainWindow) {
        mainWindow.webContents.send('extension-analyzing', { url: content.url });
      }

      // Alle Texte für Analyse sammeln
      const allText = content.elements.map(el => el.text).join('\n\n');
      console.log('Text für Analyse:', allText.substring(0, 200) + '...');

      // Text an Server senden für Korrektur-Analyse
      try {
        const errors = await analyzeTextForCorrections(allText, content.elements);
        console.log(`${errors.length} Fehler gefunden`);

        // Fehler an Extension senden
        if (errors.length > 0) {
          wsServer.showErrors(errors);
        }

        if (mainWindow) {
          mainWindow.webContents.send('extension-content', {
            url: content.url,
            errors: errors,
            totalErrors: errors.length
          });
        }
      } catch (error) {
        console.error('Analyse-Fehler:', error);
        if (mainWindow) {
          mainWindow.webContents.send('extension-content', {
            url: content.url,
            error: error.message
          });
        }
      }
    });

    // Fehler angeklickt
    wsServer.on('error-clicked', (errorId) => {
      console.log('Fehler angeklickt:', errorId);
      if (mainWindow) {
        mainWindow.webContents.send('extension-error-clicked', errorId);
      }
    });

    // Korrektur angewendet
    wsServer.on('correction-applied', (errorId) => {
      console.log('Korrektur angewendet:', errorId);
      if (mainWindow) {
        mainWindow.webContents.send('extension-correction-applied', errorId);
      }
    });

    // Analyse angefordert
    wsServer.on('analysis-requested', () => {
      console.log('Analyse von Extension angefordert');
      wsServer.analyzePage();
    });

    console.log('WebSocket Server für Chrome Extension initialisiert auf Port 9876');
  } catch (error) {
    console.error('=== WEBSOCKET SERVER FEHLER ===');
    console.error('Fehler:', error.message);
    console.error('Stack:', error.stack);
  }
}

// IPC Handler für Extension
ipcMain.handle('get-extension-status', () => {
  if (wsServer) {
    return wsServer.getStatus();
  }
  return { running: false, extensionConnected: false };
});

ipcMain.handle('extension-analyze-page', () => {
  if (wsServer) {
    return wsServer.analyzePage();
  }
  return false;
});

ipcMain.handle('extension-show-errors', (event, errors) => {
  if (wsServer) {
    return wsServer.showErrors(errors);
  }
  return false;
});

ipcMain.handle('extension-apply-correction', (event, errorId, correction) => {
  if (wsServer) {
    return wsServer.applyCorrection(errorId, correction);
  }
  return false;
});

ipcMain.handle('extension-clear-all', () => {
  if (wsServer) {
    return wsServer.clearAll();
  }
  return false;
});

// ============ Google Services IPC Handlers ============

// Auth
ipcMain.handle('google-auth-status', () => {
  return {
    connected: googleAuth.isConnected(),
    configured: googleAuth.isConfigured(),
    user: googleAuth.getUserInfo()
  };
});

ipcMain.handle('google-auth-connect', async () => {
  try {
    const result = await googleAuth.startAuthFlow();
    if (mainWindow) {
      mainWindow.webContents.send('google-auth-changed', {
        connected: true,
        user: result.user
      });
    }
    return result;
  } catch (error) {
    console.error('Google Auth Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-auth-disconnect', async () => {
  try {
    const result = await googleAuth.disconnect();
    if (mainWindow) {
      mainWindow.webContents.send('google-auth-changed', {
        connected: false,
        user: null
      });
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Calendar
ipcMain.handle('google-calendar-today', async () => {
  try {
    const events = await calendarService.getTodayEvents();
    const speech = calendarService.generateSpeechResponse(events, 'today');
    return { success: true, events, speech };
  } catch (error) {
    console.error('Calendar Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-calendar-week', async () => {
  try {
    const events = await calendarService.getWeekEvents();
    const speech = calendarService.generateSpeechResponse(events, 'week');
    return { success: true, events, speech };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-calendar-upcoming', async (_, days = 7) => {
  try {
    const events = await calendarService.getUpcomingEvents(days);
    return { success: true, events };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-calendar-month', async () => {
  try {
    const events = await calendarService.getMonthEvents();
    const speech = `Dieser Monat hat ${events.length} Termine.`;
    return { success: true, events, speech };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-calendar-create', async (_, eventData) => {
  try {
    const result = await calendarService.createEvent(eventData);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-calendar-quick-add', async (_, text) => {
  try {
    const result = await calendarService.quickAddEvent(text);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Gmail
ipcMain.handle('google-gmail-unread', async () => {
  try {
    const emails = await gmailService.getUnreadEmails();
    const speech = gmailService.generateSpeechResponse(emails, 'unread');
    const count = await gmailService.getUnreadCount();
    return { success: true, emails, speech, count };
  } catch (error) {
    console.error('Gmail Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-gmail-recent', async (_, maxResults = 10) => {
  try {
    const emails = await gmailService.getRecentEmails(maxResults);
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-gmail-search', async (_, query) => {
  try {
    const emails = await gmailService.searchEmails(query);
    const speech = gmailService.generateSpeechResponse(emails, 'search');
    return { success: true, emails, speech };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-gmail-read', async (_, messageId) => {
  try {
    const email = await gmailService.getEmail(messageId);
    if (email) {
      await gmailService.markAsRead(messageId);
      const speech = gmailService.generateReadEmailSpeech(email);
      return { success: true, email, speech };
    }
    return { success: false, error: 'E-Mail nicht gefunden' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-gmail-send', async (_, { to, subject, body }) => {
  try {
    const result = await gmailService.sendEmail(to, subject, body);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-gmail-reply', async (_, { messageId, body }) => {
  try {
    const result = await gmailService.replyToEmail(messageId, body);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-gmail-delete', async (_, messageId) => {
  try {
    const result = await gmailService.deleteEmail(messageId);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ NOTES SERVICE (JTBT System) ============
ipcMain.handle('notes-get-all', async (_, filter, searchQuery) => {
  try {
    const notes = await notesService.getNotesForUI(filter, searchQuery);
    return { success: true, notes };
  } catch (error) {
    console.error('notes-get-all error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('notes-get-stats', async () => {
  try {
    const stats = await notesService.getStats();
    return { success: true, stats };
  } catch (error) {
    console.error('notes-get-stats error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('notes-delete', async (_, noteId) => {
  try {
    const result = await notesService.deleteNote(noteId);
    return { success: result };
  } catch (error) {
    console.error('notes-delete error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('notes-get-content', async (_, noteId) => {
  try {
    const note = await notesService.getNoteContent(noteId);
    return { success: true, note };
  } catch (error) {
    console.error('notes-get-content error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('notes-open-folder', () => {
  try {
    const { shell } = require('electron');
    shell.openExternal('https://voice.smartklick.de/notes');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Notiz speichern (per Sprachbefehl)
ipcMain.handle('notes-save', async (_, content, color = 'default') => {
  try {
    const result = await notesService.saveNote(content, color);
    return result;
  } catch (error) {
    console.error('notes-save error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('notes-invalidate-cache', async () => {
  try {
    notesService.invalidateCache();
    return { success: true };
  } catch (error) {
    console.error('notes-invalidate-cache error:', error);
    return { success: false, error: error.message };
  }
});

// Screenshot als Notiz speichern
ipcMain.handle('capture-screenshot-note', async () => {
  try {
    console.log('Capturing screenshot for note...');

    // Capture the screen using existing function
    const screenshot = await captureScreen();

    if (!screenshot || !screenshot.success || !screenshot.image) {
      return { success: false, error: screenshot?.error || 'Screenshot konnte nicht erstellt werden' };
    }

    // screenshot.image is already base64 encoded, add data URL prefix
    const base64Image = `data:image/png;base64,${screenshot.image}`;

    // Create note content with embedded image
    const timestamp = new Date().toLocaleString('de-DE');
    const content = `📸 Screenshot vom ${timestamp}\n\n[Screenshot als Bild gespeichert]`;

    // Save note with screenshot reference
    const result = await notesService.saveNote(content, 'default');

    if (result.success && result.note) {
      // Save screenshot image to notes server
      const https = require('https');
      const imageData = {
        noteId: result.note.id,
        image: base64Image,
        user_id: notesService.getUserId()  // Include user ID
      };

      // POST image to server
      const postData = JSON.stringify(imageData);
      const options = {
        hostname: 'voice.smartklick.de',
        port: 443,
        path: '/notes/screenshot',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log('Screenshot uploaded:', data);
            resolve(data);
          });
        });
        req.on('error', (e) => {
          console.error('Screenshot upload error:', e);
          resolve(); // Don't fail the whole operation
        });
        req.setTimeout(10000, () => {
          req.destroy();
          resolve();
        });
        req.write(postData);
        req.end();
      });

      console.log('Screenshot note saved:', result.note.id);
      return { success: true, note: result.note };
    }

    return result;
  } catch (error) {
    console.error('capture-screenshot-note error:', error);
    return { success: false, error: error.message };
  }
});

// Seite analysieren und als Text-Notiz speichern
ipcMain.handle('analyze-page-note', async () => {
  try {
    console.log('[ANALYZE] Starting page analysis...');

    // Capture the screen
    const screenshot = await captureScreen();
    console.log('[ANALYZE] Screenshot captured:', screenshot?.success);

    if (!screenshot || !screenshot.success || !screenshot.image) {
      console.error('[ANALYZE] Screenshot failed:', screenshot?.error);
      return { success: false, error: screenshot?.error || 'Screenshot konnte nicht erstellt werden' };
    }

    // Analyze with GPT-4 Vision
    console.log('[ANALYZE] Sending to GPT-4 Vision...');

    let analysis;
    try {
      analysis = await analyzeScreenWithGPT4Vision(screenshot.image);
      console.log('[ANALYZE] GPT-4 Response:', JSON.stringify(analysis).substring(0, 200));
    } catch (analysisError) {
      console.error('[ANALYZE] GPT-4 Error:', analysisError);
      return { success: false, error: 'GPT-4 Analyse Fehler: ' + analysisError.message };
    }

    if (!analysis) {
      console.error('[ANALYZE] No analysis result');
      return { success: false, error: 'Keine Analyse-Antwort erhalten' };
    }

    if (!analysis.success) {
      console.error('[ANALYZE] Analysis not successful:', analysis.error);
      return { success: false, error: analysis.error || 'Analyse nicht erfolgreich' };
    }

    if (!analysis.summary) {
      console.error('[ANALYZE] No summary in response');
      return { success: false, error: 'Keine Zusammenfassung in Antwort' };
    }

    // Create note content with analysis
    const timestamp = new Date().toLocaleString('de-DE');
    const content = `📝 Seitenanalyse vom ${timestamp}\n\n${analysis.summary}`;
    console.log('[ANALYZE] Content created, length:', content.length);

    // Save as note
    const result = await notesService.saveNote(content, 'default');
    console.log('[ANALYZE] Save result:', result?.success);

    if (result.success) {
      console.log('[ANALYZE] Page analysis note saved:', result.note?.id);
    }

    return result;
  } catch (error) {
    console.error('[ANALYZE] Error:', error);
    return { success: false, error: error.message };
  }
});

// Toggle pin status
ipcMain.handle('notes-toggle-pin', async (_, noteId) => {
  try {
    const result = await notesService.togglePin(noteId);
    return result;
  } catch (error) {
    console.error('notes-toggle-pin error:', error);
    return { success: false, error: error.message };
  }
});

// Archive note
ipcMain.handle('notes-archive', async (_, noteId) => {
  try {
    const result = await notesService.archiveNote(noteId);
    return result;
  } catch (error) {
    console.error('notes-archive error:', error);
    return { success: false, error: error.message };
  }
});

// Restore note from archive/trash
ipcMain.handle('notes-restore', async (_, noteId) => {
  try {
    const result = await notesService.restoreNote(noteId);
    return result;
  } catch (error) {
    console.error('notes-restore error:', error);
    return { success: false, error: error.message };
  }
});

// Permanently delete note
ipcMain.handle('notes-delete-permanent', async (_, noteId) => {
  try {
    const result = await notesService.deleteNotePermanent(noteId);
    return result;
  } catch (error) {
    console.error('notes-delete-permanent error:', error);
    return { success: false, error: error.message };
  }
});

// Set note color
ipcMain.handle('notes-set-color', async (_, noteId, color) => {
  try {
    const result = await notesService.setNoteColor(noteId, color);
    return result;
  } catch (error) {
    console.error('notes-set-color error:', error);
    return { success: false, error: error.message };
  }
});

// Set note category
ipcMain.handle('notes-set-category', async (_, noteId, category) => {
  try {
    const result = await notesService.setNoteCategory(noteId, category);
    return result;
  } catch (error) {
    console.error('notes-set-category error:', error);
    return { success: false, error: error.message };
  }
});

// Notes Webview Window
ipcMain.handle('notes-open-webview', () => {
  try {
    openNotesWebview();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Notes Toggle (open/close)
ipcMain.handle('notes-toggle-window', () => {
  if (isNotesWindowOpen()) {
    closeNotesWebview();
    return { success: true, isOpen: false };
  } else {
    openNotesWebview();
    return { success: true, isOpen: true };
  }
});

// Check if notes window is open
ipcMain.handle('notes-is-open', () => {
  return { isOpen: isNotesWindowOpen() };
});

// Close notes window
ipcMain.handle('notes-close-window', () => {
  closeNotesWebview();
  return { success: true };
});

function openNotesWebview() {
  // If window exists, just show, maximize and focus it
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.show();
    notesWindow.maximize();
    notesWindow.focus();
    return;
  }

  // Get display where mainWindow is (same monitor as dock bar)
  let targetDisplay = screen.getPrimaryDisplay();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const winBounds = mainWindow.getBounds();
    const centerPoint = {
      x: winBounds.x + winBounds.width / 2,
      y: winBounds.y + winBounds.height / 2
    };
    targetDisplay = screen.getDisplayNearestPoint(centerPoint);
  }

  const { width, height } = targetDisplay.workAreaSize;
  const { x, y } = targetDisplay.workArea;

  // Create new window on the same monitor as the dock
  notesWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    minWidth: 800,
    minHeight: 600,
    title: 'Smartklick Notizen',
    icon: path.join(__dirname, 'src/assets/icons/icon.png'),
    show: false,  // Show after maximize
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  notesWindow.loadFile('src/notes-webview.html');

  // Remove menu bar on Windows
  notesWindow.setMenuBarVisibility(false);

  // Show maximized (fullscreen)
  notesWindow.once('ready-to-show', () => {
    notesWindow.maximize();
    notesWindow.show();
  });

  notesWindow.on('closed', () => {
    notesWindow = null;
    // Notify renderer that notes window was closed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notes-window-closed');
    }
  });
}

function closeNotesWebview() {
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.close();
  }
}

function isNotesWindowOpen() {
  return notesWindow && !notesWindow.isDestroyed() && notesWindow.isVisible();
}

// =============================================================================
// ANALYSIS VIEWER WINDOW
// =============================================================================

function openAnalysisViewer(data) {
  // Store data to send when window is ready
  pendingAnalysisData = data;

  // If window exists, just send new data and show it
  if (analysisWindow && !analysisWindow.isDestroyed()) {
    analysisWindow.webContents.send('analysis-data', data);
    analysisWindow.show();
    analysisWindow.focus();
    return;
  }

  // Get display where mainWindow is (same monitor as dock bar)
  let targetDisplay = screen.getPrimaryDisplay();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const winBounds = mainWindow.getBounds();
    const centerPoint = {
      x: winBounds.x + winBounds.width / 2,
      y: winBounds.y + winBounds.height / 2
    };
    targetDisplay = screen.getDisplayNearestPoint(centerPoint);
  }

  const { width, height } = targetDisplay.workAreaSize;
  const { x, y } = targetDisplay.workArea;

  // Create new window on the same monitor as the dock
  analysisWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    minWidth: 600,
    minHeight: 500,
    title: 'Seitenanalyse',
    icon: path.join(__dirname, 'src/assets/icons/icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  analysisWindow.loadFile('src/analysis-viewer.html');

  // Remove menu bar on Windows
  analysisWindow.setMenuBarVisibility(false);

  // Show maximized (fullscreen)
  analysisWindow.once('ready-to-show', () => {
    analysisWindow.maximize();
    analysisWindow.show();
  });

  analysisWindow.on('closed', () => {
    analysisWindow = null;
    pendingAnalysisData = null;
  });
}

// IPC: Analysis viewer is ready, send pending data
ipcMain.on('analysis-viewer-ready', (event) => {
  if (pendingAnalysisData && analysisWindow && !analysisWindow.isDestroyed()) {
    analysisWindow.webContents.send('analysis-data', pendingAnalysisData);
  }
});

// IPC: Open analysis viewer with data
ipcMain.handle('analysis:open', (event, data) => {
  openAnalysisViewer(data);
  return { success: true };
});

// =============================================================================
// DOCK SETTINGS WINDOW
// =============================================================================

ipcMain.handle('docking:openSettings', () => {
  try {
    openDockSettingsWindow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function openDockSettingsWindow() {
  // If window exists, just show and focus it
  if (dockSettingsWindow && !dockSettingsWindow.isDestroyed()) {
    dockSettingsWindow.show();
    dockSettingsWindow.focus();
    return dockSettingsWindow;
  }

  // Calculate position next to dock bar
  let windowX, windowY;
  const settingsWidth = 300;
  const settingsHeight = 400;
  const currentScreen = screen.getPrimaryDisplay();
  const { workArea } = currentScreen;

  if (isDocked && dockPosition) {
    switch (dockPosition) {
      case 'top':
        windowX = workArea.x + Math.floor((workArea.width - settingsWidth) / 2);
        windowY = workArea.y + DOCK_SIZES.horizontal.height + 10;
        break;
      case 'bottom':
        windowX = workArea.x + Math.floor((workArea.width - settingsWidth) / 2);
        windowY = workArea.y + workArea.height - DOCK_SIZES.horizontal.height - settingsHeight - 10;
        break;
      case 'left':
        windowX = workArea.x + DOCK_SIZES.vertical.width + 10;
        windowY = workArea.y + Math.floor((workArea.height - settingsHeight) / 2);
        break;
      case 'right':
        windowX = workArea.x + workArea.width - DOCK_SIZES.vertical.width - settingsWidth - 10;
        windowY = workArea.y + Math.floor((workArea.height - settingsHeight) / 2);
        break;
    }
  } else {
    // Center on screen if not docked
    windowX = workArea.x + Math.floor((workArea.width - settingsWidth) / 2);
    windowY = workArea.y + Math.floor((workArea.height - settingsHeight) / 2);
  }

  // Create new window
  dockSettingsWindow = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    x: windowX,
    y: windowY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    title: 'Smartklick Einstellungen',
    icon: path.join(__dirname, 'src/assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dockSettingsWindow.loadFile('src/dock-settings.html');

  // Remove menu bar on Windows
  dockSettingsWindow.setMenuBarVisibility(false);

  dockSettingsWindow.on('closed', () => {
    dockSettingsWindow = null;
  });

  // Close when clicking outside
  dockSettingsWindow.on('blur', () => {
    if (dockSettingsWindow && !dockSettingsWindow.isDestroyed()) {
      dockSettingsWindow.close();
    }
  });

  return dockSettingsWindow;
}

// =============================================================================
// EMAIL WINDOW AND HANDLERS
// =============================================================================

ipcMain.handle('email:openWindow', () => {
  try {
    openEmailWindow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function openEmailWindow() {
  // If window exists, just show, maximize and focus it
  if (emailWindow && !emailWindow.isDestroyed()) {
    emailWindow.show();
    emailWindow.maximize();
    emailWindow.focus();
    return emailWindow;
  }

  // Get display where mainWindow is (same monitor as dock bar)
  let targetDisplay = screen.getPrimaryDisplay();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const winBounds = mainWindow.getBounds();
    const centerPoint = {
      x: winBounds.x + winBounds.width / 2,
      y: winBounds.y + winBounds.height / 2
    };
    targetDisplay = screen.getDisplayNearestPoint(centerPoint);
  }

  const { width, height } = targetDisplay.workAreaSize;
  const { x, y } = targetDisplay.workArea;

  // Create new window on the same monitor as the dock
  emailWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    minWidth: 900,
    minHeight: 500,
    title: 'Smartklick E-Mail',
    icon: path.join(__dirname, 'src/assets/icons/icon.png'),
    show: false,  // Show after maximize
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  emailWindow.loadFile('src/email-window.html');

  // Remove menu bar on Windows
  emailWindow.setMenuBarVisibility(false);

  // Show maximized (fullscreen)
  emailWindow.once('ready-to-show', () => {
    emailWindow.maximize();
    emailWindow.show();
  });

  emailWindow.on('closed', () => {
    emailWindow = null;
  });

  return emailWindow;
}

// Email IPC Handlers
ipcMain.handle('email:getRecent', async (_, count = 20) => {
  try {
    const emails = await gmailService.getRecentEmails(count);
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:getUnread', async () => {
  try {
    const emails = await gmailService.getUnreadEmails();
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:getFromSender', async (_, senderName) => {
  try {
    const emails = await gmailService.getEmailsFromSender(senderName);
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:getThread', async (_, threadId) => {
  try {
    const emails = await gmailService.getThread(threadId);
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:markAsRead', async (_, messageId) => {
  try {
    await gmailService.markAsRead(messageId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:star', async (_, messageId) => {
  try {
    await gmailService.markAsStarred(messageId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:unstar', async (_, messageId) => {
  try {
    await gmailService.unstar(messageId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:archive', async (_, messageId) => {
  try {
    await gmailService.archiveEmail(messageId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:delete', async (_, messageId) => {
  try {
    await gmailService.deleteEmail(messageId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Alle als gelesen markieren
ipcMain.handle('email:markAllAsRead', async () => {
  try {
    // Get unread emails and mark them as read
    const unread = await gmailService.getUnreadEmails();
    if (unread && unread.length > 0) {
      for (const email of unread) {
        await gmailService.markAsRead(email.id);
      }
    }
    return { success: true, count: unread?.length || 0 };
  } catch (error) {
    console.error('Error marking all as read:', error);
    return { success: false, error: error.message };
  }
});

// Spam-Ordner leeren
ipcMain.handle('email:emptySpam', async () => {
  try {
    // TODO: Implement when spam folder access is available
    return { success: true, message: 'Spam geleert' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Newsletter archivieren
ipcMain.handle('email:archiveNewsletters', async () => {
  try {
    // TODO: Implement newsletter archiving
    return { success: true, message: 'Newsletter archiviert' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Anhang herunterladen
ipcMain.handle('email:downloadAttachment', async (_, attachmentId) => {
  try {
    // TODO: Implement attachment download
    return { success: false, error: 'Nicht implementiert' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:getForBriefing', async (_, maxResults = 20) => {
  try {
    const emails = await gmailService.getEmailsForBriefing(maxResults);
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Email KI-Analyse (via Server)
ipcMain.handle('email:analyze', async (_, emailData) => {
  try {
    const response = await fetch('http://188.40.97.126:8080/email-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: emailData.text,
        subject: emailData.subject,
        sender: emailData.sender,
        language: 'de'
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// =====================================================
// INTELLIGENTES E-MAIL-KLASSIFIZIERUNGSSYSTEM
// Mehrstufig, selbstlernend, kostenoptimiert
// =====================================================

// Einzelne E-Mail klassifizieren
ipcMain.handle('email:classify', async (_, emailData) => {
  return await emailClassifier.classifyEmail(emailData);
});

// Mehrere E-Mails klassifizieren (Batch)
ipcMain.handle('email:classifyBatch', async (_, emails) => {
  return await emailClassifier.classifyEmails(emails);
});

// Essenz extrahieren (nur wichtige E-Mails)
ipcMain.handle('email:getEssenz', async (_, emails) => {
  return await emailClassifier.getEssenz(emails);
});

// Kategorie manuell korrigieren (Lernsystem)
ipcMain.handle('email:correctCategory', (_, email, oldCategory, newCategory) => {
  return emailClassifier.correctCategory(email, oldCategory, newCategory);
});

// Tracking: E-Mail geöffnet
ipcMain.handle('email:trackOpened', (_, email) => {
  return emailClassifier.trackOpened(email);
});

// Tracking: E-Mail beantwortet
ipcMain.handle('email:trackReplied', (_, email) => {
  return emailClassifier.trackReplied(email);
});

// Tracking: E-Mail gelöscht ohne lesen
ipcMain.handle('email:trackDeletedUnread', (_, email) => {
  return emailClassifier.trackDeletedUnread(email);
});

// === FEEDBACK SYSTEM ===

// Feedback speichern
ipcMain.handle('feedback:save', async (_, feedbackData) => {
  try {
    const Store = require('electron-store');
    const feedbackStore = new Store({ name: 'ki-feedback' });

    const all = feedbackStore.get('feedbackList', []);
    all.push(feedbackData);

    // Nur letzte 500 Feedbacks behalten
    if (all.length > 500) {
      all.splice(0, all.length - 500);
    }

    feedbackStore.set('feedbackList', all);
    console.log('[FEEDBACK] Gespeichert:', feedbackData.feedbackType, feedbackData.absenderDomain);
    return { success: true };
  } catch (error) {
    console.error('[FEEDBACK] Fehler beim Speichern:', error);
    return { success: false, error: error.message };
  }
});

// KI-Analyse auf Klick (mit Gedanken)
ipcMain.handle('email:getKIAnalyse', async (_, email) => {
  try {
    // Verwende Stufe 2 Classifier für detaillierte Analyse
    const Stufe2Classifier = require('./src/services/email/classifier/stufe2.js');
    const classifier = new Stufe2Classifier();

    const result = await classifier.klassifiziere(email);

    return {
      kategorie: result.kategorie || 'normal',
      gedanken: result.gedanken || 'Keine detaillierte Analyse verfügbar.',
      sicherheit: result.confidence || 70,
      stufe: result.stufe || 1
    };
  } catch (error) {
    console.error('[KI-ANALYSE] Fehler:', error);
    return {
      kategorie: 'normal',
      gedanken: 'Fehler bei der Analyse: ' + error.message,
      sicherheit: 0
    };
  }
});

// Absender zu Liste hinzufügen (vip, family, customer, whitelist, blacklist)
ipcMain.handle('email:addSenderToList', (_, email, listType) => {
  return emailClassifier.addSenderToList(email, listType);
});

// Classifier-Statistiken abrufen
ipcMain.handle('email:classifierStats', () => {
  return emailClassifier.getStats();
});

// Kategorien und Tags für UI
ipcMain.handle('email:getCategories', () => {
  return emailClassifier.getCategories();
});

// OpenAI API Key für GPT-Klassifizierung setzen
ipcMain.handle('email:setClassifierApiKey', (_, apiKey) => {
  return emailClassifier.setOpenAIKey(apiKey);
});

// Eigene E-Mail-Adressen setzen
ipcMain.handle('email:setMyEmails', (_, emails) => {
  return emailClassifier.setMyEmails(emails);
});

// Lerndaten exportieren
ipcMain.handle('email:exportLearningData', () => {
  return emailClassifier.exportLearningData();
});

// Lerndaten importieren
ipcMain.handle('email:importLearningData', (_, data) => {
  return emailClassifier.importLearningData(data);
});

// Lerndaten zurücksetzen
ipcMain.handle('email:resetLearning', () => {
  return emailClassifier.resetLearning();
});

// Alle E-Mail-Daten löschen (für sauberen Neustart)
ipcMain.handle('email:clearAllData', () => {
  try {
    const Store = require('electron-store');
    const fs = require('fs');
    const path = require('path');

    // Clear classifier data
    const classifierStore = new Store({ name: 'email-classifier-config' });
    classifierStore.clear();

    // Clear learning data
    const learningStore = new Store({ name: 'email-learning' });
    learningStore.clear();

    // Clear email accounts (benannter Store)
    const accountsStore = new Store({ name: 'email-accounts' });
    accountsStore.clear();

    // Clear IMAP settings (benannter Store)
    const imapStore = new Store({ name: 'imap-accounts' });
    imapStore.clear();

    // Clear Gmail tokens
    const gmailStore = new Store({ name: 'gmail-tokens' });
    gmailStore.clear();

    // WICHTIG: Clear Google OAuth tokens (das ist der eigentliche Token-Store!)
    const googleTokenStore = new Store({
      name: 'google-tokens',
      encryptionKey: 'smartklick-secure-key-2024'
    });
    googleTokenStore.clear();
    console.log('[EMAIL] Google OAuth tokens cleared');

    // Reset Google Auth Service
    if (googleAuth) {
      googleAuth.isAuthenticated = false;
      googleAuth.userInfo = null;
      if (googleAuth.oauth2Client) {
        googleAuth.oauth2Client.setCredentials({});
      }
    }

    // Reset Gmail Service
    if (gmailService) {
      gmailService.gmail = null;
    }

    // WICHTIG: Clear IMAP accounts im Haupt-Store (wo imapAccountManager speichert!)
    store.delete('imap_accounts');
    store.delete('emailAccounts');
    store.delete('imapAccounts');
    store.delete('gmailTokens');

    // Reset in-memory managers RICHTIG
    if (imapAccountManager) {
      // Clear the Map, not set to array
      if (imapAccountManager.accounts instanceof Map) {
        imapAccountManager.accounts.clear();
      } else {
        imapAccountManager.accounts = new Map();
      }
      // Close all connections
      if (imapAccountManager.connections instanceof Map) {
        imapAccountManager.connections.forEach((conn, id) => {
          try { conn.end(); } catch(e) {}
        });
        imapAccountManager.connections.clear();
      }
      // Save empty state
      imapAccountManager.saveAccounts();
    }

    if (emailProviderManager) {
      emailProviderManager.accounts = [];
      if (emailProviderManager.store) {
        emailProviderManager.store.clear();
      }
    }

    // Try to delete Gmail token file if exists
    try {
      const tokenPath = path.join(app.getPath('userData'), 'gmail-token.json');
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
        console.log('[EMAIL] Gmail token file deleted');
      }
    } catch (e) {
      console.warn('[EMAIL] Could not delete token file:', e.message);
    }

    console.log('[EMAIL] All email data cleared successfully');
    return { success: true, message: 'Alle E-Mail-Daten gelöscht. Bitte App neu starten.' };
  } catch (error) {
    console.error('[EMAIL] Clear data error:', error);
    return { success: false, error: error.message };
  }
});

// App neu starten
ipcMain.handle('app:restart', () => {
  console.log('[APP] Restarting application...');
  app.relaunch();
  app.exit(0);
});

// Email Briefing (via Server)
ipcMain.handle('email:briefing', async (_, emails) => {
  try {
    const response = await fetch('http://188.40.97.126:8080/email-briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails: emails,
        language: 'de'
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Email Reply - Generate KI Reply (via Server)
ipcMain.handle('email:generateReply', async (_, data) => {
  try {
    const response = await fetch('http://188.40.97.126:8080/email-reply-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original_text: data.originalText,
        original_subject: data.originalSubject,
        original_sender: data.originalSender,
        reply_type: data.replyType || 'professional',
        context: data.context || '',
        language: 'de'
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Email Reply - Get Quick Replies (via Server)
ipcMain.handle('email:getQuickReplies', async (_, data) => {
  try {
    const response = await fetch('http://188.40.97.126:8080/email-quick-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original_text: data.originalText,
        original_subject: data.originalSubject,
        original_sender: data.originalSender,
        language: 'de'
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Email Reply - Send Reply
ipcMain.handle('email:sendReply', async (_, messageId, body) => {
  try {
    const result = await gmailService.replyToEmail(messageId, body);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Send new email via IMAP account
ipcMain.handle('email:sendNew', async (_, { accountId, to, cc, subject, body, attachments }) => {
  const debugInfo = [];
  try {
    debugInfo.push(`To: ${to}, Subject: ${subject}`);
    debugInfo.push(`Attachments in IPC: ${attachments ? attachments.length : 0}`);

    if (attachments && attachments.length > 0) {
      attachments.forEach((att, i) => {
        debugInfo.push(`Att ${i+1}: ${att.filename}, contentLen: ${att.content?.length || 0}, type: ${att.contentType}`);
      });
    }

    const result = await imapAccountManager.sendEmail(accountId, { to, cc, subject, body, attachments });
    debugInfo.push(`SMTP result: messageId=${result.messageId}`);

    return { success: true, messageId: result.messageId, debug: debugInfo };
  } catch (error) {
    debugInfo.push(`ERROR: ${error.message}`);
    return { success: false, error: error.message, debug: debugInfo };
  }
});

// AI Compose - Generate email from prompt
ipcMain.handle('email:aiCompose', async (_, { prompt, subject }) => {
  try {
    console.log('[EMAIL] AI Composing email:', prompt);

    const response = await fetch('http://188.40.97.126:8080/email-compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        subject: subject || '',
        language: 'de'
      })
    });

    if (!response.ok) {
      throw new Error('Server-Fehler bei KI-Generierung');
    }

    const result = await response.json();
    return {
      success: true,
      text: result.body || result.text || '',
      subject: result.subject || ''
    };
  } catch (error) {
    console.error('[EMAIL] AI Compose error:', error);
    return { success: false, error: error.message };
  }
});

// AI Improve - Improve existing email text
ipcMain.handle('email:aiImprove', async (_, { text }) => {
  try {
    console.log('[EMAIL] AI Improving text');

    const response = await fetch('http://188.40.97.126:8080/email-improve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language: 'de'
      })
    });

    if (!response.ok) {
      throw new Error('Server-Fehler bei KI-Verbesserung');
    }

    const result = await response.json();
    return {
      success: true,
      text: result.improved || result.text || text
    };
  } catch (error) {
    console.error('[EMAIL] AI Improve error:', error);
    return { success: false, error: error.message };
  }
});

// Select attachment for compose
ipcMain.handle('email:selectAttachment', async () => {
  const { dialog } = require('electron');
  const fs = require('fs');
  const path = require('path');

  try {
    const result = await dialog.showOpenDialog({
      title: 'Anhang auswählen',
      properties: ['openFile'],
      filters: [
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false };
    }

    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);

    // Determine MIME type
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    console.log(`[EMAIL] Attachment selected: ${filename} (${stats.size} bytes)`);

    return {
      success: true,
      attachment: {
        filename,
        content: content.toString('base64'),
        contentType,
        size: stats.size
      }
    };
  } catch (error) {
    console.error('[EMAIL] Select attachment error:', error);
    return { success: false, error: error.message };
  }
});

// Save attachment to file
ipcMain.handle('email:saveAttachment', async (_, { filename, content, contentType }) => {
  const { dialog } = require('electron');
  const fs = require('fs');
  const path = require('path');

  try {
    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Anhang speichern',
      defaultPath: filename,
      filters: [
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Abgebrochen' };
    }

    // Decode base64 and save
    const buffer = Buffer.from(content, 'base64');
    fs.writeFileSync(result.filePath, buffer);

    console.log(`[EMAIL] Attachment saved: ${result.filePath}`);
    return { success: true, path: result.filePath };
  } catch (error) {
    console.error('[EMAIL] Save attachment error:', error);
    return { success: false, error: error.message };
  }
});

// Helper function to send commands to email window
function sendToEmailWindow(channel, ...args) {
  if (emailWindow && !emailWindow.isDestroyed()) {
    emailWindow.webContents.send(channel, ...args);
  }
}

// Listen for email commands from main window
ipcMain.on('email-command', (_, command) => {
  console.log('[EMAIL] Received command:', command);
  if (emailWindow && !emailWindow.isDestroyed()) {
    emailWindow.webContents.send('email-command', command);
  }
});

// =============================================================================
// CALENDAR WINDOW AND HANDLERS
// =============================================================================

ipcMain.handle('calendar:openWindow', () => {
  console.log('[CALENDAR] Opening calendar window');
  openCalendarWindow();
  return { success: true };
});

function openCalendarWindow() {
  // If window exists, just show it
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    calendarWindow.show();
    calendarWindow.maximize();
    calendarWindow.focus();
    return calendarWindow;
  }

  const { screen } = require('electron');

  // Get the display where the main window is
  let targetDisplay = screen.getPrimaryDisplay();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const winBounds = mainWindow.getBounds();
    const centerPoint = {
      x: winBounds.x + winBounds.width / 2,
      y: winBounds.y + winBounds.height / 2
    };
    targetDisplay = screen.getDisplayNearestPoint(centerPoint);
  }

  const { width, height } = targetDisplay.workAreaSize;
  const { x, y } = targetDisplay.workArea;

  calendarWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    minWidth: 900,
    minHeight: 500,
    title: 'Smartklick Kalender',
    icon: path.join(__dirname, 'src/assets/icons/icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  calendarWindow.loadFile('src/calendar-window.html');
  calendarWindow.setMenuBarVisibility(false);

  calendarWindow.once('ready-to-show', () => {
    calendarWindow.maximize();
    calendarWindow.show();
  });

  calendarWindow.on('closed', () => {
    calendarWindow = null;
  });

  return calendarWindow;
}

// Calendar IPC Handlers
ipcMain.handle('calendar:getEvents', async (_, startDate, endDate) => {
  try {
    const events = await calendarService.getEvents(startDate, endDate);
    return events;
  } catch (error) {
    console.error('[CALENDAR] Error loading events:', error);
    return [];
  }
});

ipcMain.handle('calendar:getTodayEvents', async () => {
  try {
    return await calendarService.getTodayEvents();
  } catch (error) {
    console.error('[CALENDAR] Error loading today events:', error);
    return [];
  }
});

ipcMain.handle('calendar:getWeekEvents', async () => {
  try {
    return await calendarService.getWeekEvents();
  } catch (error) {
    console.error('[CALENDAR] Error loading week events:', error);
    return [];
  }
});

// =============================================================================
// OUTLOOK OAUTH AND MULTI-ACCOUNT HANDLERS
// =============================================================================

// Outlook OAuth Server (temporary for OAuth callback)
let outlookOAuthServer = null;

ipcMain.handle('outlook:startAuth', async () => {
  const { shell } = require('electron');

  const clientId = store.get('outlook_client_id') || OUTLOOK_CONFIG.clientId;

  if (clientId === '5c7ce6e5-5d5d-4c0c-b0c0-5e5e5e5e5e5e') {
    return {
      success: false,
      error: 'Bitte zuerst Outlook Client ID in den Einstellungen konfigurieren'
    };
  }

  // Start local server for OAuth callback
  return new Promise((resolve) => {
    if (outlookOAuthServer) {
      outlookOAuthServer.close();
    }

    outlookOAuthServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:5678');

      if (url.pathname === '/outlook/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Fehler</h1><p>Outlook-Anmeldung abgebrochen.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>');
          outlookOAuthServer.close();
          resolve({ success: false, error });
          return;
        }

        if (code) {
          try {
            // Exchange code for tokens
            const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                code,
                redirect_uri: OUTLOOK_CONFIG.redirectUri,
                grant_type: 'authorization_code',
                scope: OUTLOOK_CONFIG.scopes.join(' ')
              })
            });

            const tokens = await tokenResponse.json();

            if (tokens.error) {
              throw new Error(tokens.error_description || tokens.error);
            }

            // Get user info
            const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
              headers: { 'Authorization': `Bearer ${tokens.access_token}` }
            });
            const userInfo = await userResponse.json();

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Erfolgreich!</h1><p>Outlook-Konto ${userInfo.mail || userInfo.userPrincipalName} verbunden.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>`);

            outlookOAuthServer.close();

            // Add account to provider manager
            const credentials = {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            };

            const result = await emailProviderManager.addOutlookAccount(
              'Outlook',
              userInfo.mail || userInfo.userPrincipalName,
              credentials
            );

            resolve(result);
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Fehler</h1><p>${err.message}</p></body></html>`);
            outlookOAuthServer.close();
            resolve({ success: false, error: err.message });
          }
        }
      }
    });

    outlookOAuthServer.listen(5678, () => {
      console.log('[OUTLOOK] OAuth callback server started on port 5678');

      // Open Microsoft login page
      const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
        `client_id=${clientId}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(OUTLOOK_CONFIG.redirectUri)}` +
        `&scope=${encodeURIComponent(OUTLOOK_CONFIG.scopes.join(' '))}` +
        `&response_mode=query`;

      shell.openExternal(authUrl);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (outlookOAuthServer) {
        outlookOAuthServer.close();
        resolve({ success: false, error: 'Timeout' });
      }
    }, 5 * 60 * 1000);
  });
});

ipcMain.handle('outlook:setClientId', (_, clientId) => {
  store.set('outlook_client_id', clientId);
  return { success: true };
});

ipcMain.handle('outlook:getClientId', () => {
  return store.get('outlook_client_id') || '';
});

// Multi-Account Email Handlers
ipcMain.handle('email:getAccounts', () => {
  const accounts = [];

  // Email Provider Manager Accounts (Gmail, Outlook)
  if (emailProviderManager) {
    const providerAccounts = emailProviderManager.getAccounts() || [];
    accounts.push(...providerAccounts.map(a => ({
      ...a,
      connected: true
    })));
  }

  // IMAP Accounts
  if (imapAccountManager) {
    const imapAccounts = imapAccountManager.getAccounts() || [];
    accounts.push(...imapAccounts.map(a => ({
      id: `imap-${a.email}`,
      name: a.provider || 'IMAP',
      email: a.email,
      provider: 'imap',
      host: a.host,
      connected: true
    })));
  }

  return { success: true, accounts };
});

ipcMain.handle('email:removeAccount', async (_, accountId) => {
  console.log('[EMAIL] Removing account:', accountId);

  // Check if it's an IMAP account (starts with 'imap-')
  if (accountId && accountId.startsWith('imap-')) {
    if (imapAccountManager) {
      const email = accountId.replace('imap-', '');
      // Find and remove by email
      const accounts = imapAccountManager.getAccounts();
      const account = accounts.find(a => a.email === email);
      if (account) {
        imapAccountManager.accounts.delete(account.id);
        imapAccountManager.saveAccounts();
        console.log('[EMAIL] IMAP account removed:', email);
        return { success: true };
      }
    }
    return { success: false, error: 'IMAP account not found' };
  }

  // Otherwise use emailProviderManager
  if (!emailProviderManager) {
    return { success: false, error: 'Provider manager not initialized' };
  }
  return await emailProviderManager.removeAccount(accountId);
});

ipcMain.handle('email:setDefaultAccount', (_, accountId) => {
  if (!emailProviderManager) {
    return { success: false, error: 'Provider manager not initialized' };
  }
  emailProviderManager.setDefaultAccount(accountId);
  return { success: true };
});

ipcMain.handle('email:getUnreadCounts', async () => {
  if (!emailProviderManager) {
    return { success: false, error: 'Provider manager not initialized' };
  }
  try {
    const counts = await emailProviderManager.getUnreadCounts();
    return { success: true, counts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:getEmailsFromAccount', async (_, accountId, maxResults = 20) => {
  if (!emailProviderManager) {
    return { success: false, error: 'Provider manager not initialized' };
  }
  try {
    const emails = await emailProviderManager.getEmails({ accountId, maxResults });
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('email:getUnifiedInbox', async (_, maxResults = 20) => {
  if (!emailProviderManager) {
    return { success: false, error: 'Provider manager not initialized' };
  }
  try {
    const emails = await emailProviderManager.getEmails({ unified: true, maxResults });
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// =============================================================================
// IMAP EMAIL HANDLERS
// =============================================================================

// =============================================================================
// IMAP MULTI-ACCOUNT HANDLERS
// =============================================================================

// Get IMAP presets (for provider selection)
ipcMain.handle('imap:getPresets', () => {
  return imapAccountManager.getPresets();
});

// Get all accounts
ipcMain.handle('imap:getAccounts', () => {
  try {
    const accounts = imapAccountManager.getAccounts();
    return { success: true, accounts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add new account
ipcMain.handle('imap:addAccount', async (_, accountConfig) => {
  try {
    const account = await imapAccountManager.addAccount(accountConfig);
    return { success: true, account };
  } catch (error) {
    console.error('[IMAP] Add account error:', error);
    return { success: false, error: error.message };
  }
});

// Remove account
ipcMain.handle('imap:removeAccount', async (_, accountId) => {
  try {
    await imapAccountManager.removeAccount(accountId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Update account (rename, color change)
ipcMain.handle('imap:updateAccount', async (_, accountId, updates) => {
  try {
    const account = await imapAccountManager.updateAccount(accountId, updates);
    return { success: true, account };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Test connection with settings (before adding account)
ipcMain.handle('imap:testConnection', async (_, settings) => {
  try {
    const result = await imapAccountManager.testConnection(settings);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get emails for specific account and folder
ipcMain.handle('imap:getAccountEmails', async (_, accountId, folder = 'INBOX', count = 50) => {
  try {
    const emails = await imapAccountManager.getEmails(accountId, folder, count);
    return { success: true, emails };
  } catch (error) {
    console.error('[IMAP] Get emails error:', error);
    return { success: false, error: error.message };
  }
});

// Get full email content
ipcMain.handle('imap:getEmailContent', async (_, accountId, uid, folder = 'INBOX') => {
  try {
    console.log(`[IMAP] Getting email content: account=${accountId}, uid=${uid}, folder=${folder}`);
    const email = await imapAccountManager.getEmailContent(accountId, uid, folder);
    return { success: true, email };
  } catch (error) {
    console.error(`[IMAP] getEmailContent error:`, error);
    return { success: false, error: error.message };
  }
});

// Mark as read
ipcMain.handle('imap:markAsRead', async (_, accountId, uid, folder = 'INBOX') => {
  try {
    const result = await imapAccountManager.markAsRead(accountId, uid, folder);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Toggle star
ipcMain.handle('imap:toggleStar', async (_, accountId, uid, folder = 'INBOX') => {
  try {
    const result = await imapAccountManager.toggleStar(accountId, uid, folder);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Delete email
ipcMain.handle('imap:deleteEmail', async (_, accountId, uid, folder = 'INBOX') => {
  try {
    const result = await imapAccountManager.deleteEmail(accountId, uid, folder);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get folders for account
ipcMain.handle('imap:getFolders', async (_, accountId) => {
  try {
    const result = await imapAccountManager.getFolders(accountId);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get standard folders (mapped to actual server names)
ipcMain.handle('imap:getStandardFolders', async (_, accountId) => {
  try {
    const folders = await imapAccountManager.getStandardFolders(accountId);
    return { success: true, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get overall status
ipcMain.handle('imap:getStatus', () => {
  return {
    accountCount: imapAccountManager.getAccounts().length,
    accounts: imapAccountManager.getAccounts().map(a => ({
      id: a.id,
      name: a.name,
      email: a.email
    }))
  };
});

// Disconnect all
ipcMain.handle('imap:disconnect', async () => {
  try {
    await imapAccountManager.disconnectAll();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Legacy single-account support (backwards compatibility)
ipcMain.handle('imap:configure', async (_, settings) => {
  try {
    console.log('[IMAP] Configure called with:', { ...settings, password: '***' });

    // Add as new account if not exists
    const existing = imapAccountManager.getAccounts().find(a => a.email === settings.user);
    if (!existing) {
      await imapAccountManager.addAccount({
        provider: settings.provider,
        host: settings.host,
        port: settings.port,
        tls: settings.tls,
        user: settings.user,  // WICHTIG: 'user' nicht 'email'!
        password: settings.password
      });
      console.log('[IMAP] New account added:', settings.user);
    } else {
      console.log('[IMAP] Account already exists:', settings.user);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('imap:getSettings', () => {
  // Return first account for backwards compatibility
  const accounts = imapAccountManager.getAccounts();
  if (accounts.length > 0) {
    return {
      provider: accounts[0].provider,
      host: accounts[0].host,
      port: accounts[0].port,
      tls: accounts[0].tls,
      user: accounts[0].email
    };
  }
  return null;
});

ipcMain.handle('imap:test', async (_, settings) => {
  return imapAccountManager.testConnection(settings);
});

ipcMain.handle('imap:getEmails', async (_, count = 20) => {
  try {
    const accounts = imapAccountManager.getAccounts();
    if (accounts.length === 0) {
      return { success: false, error: 'Keine IMAP-Konten konfiguriert' };
    }
    const emails = await imapAccountManager.getEmails(accounts[0].id, 'INBOX', count);
    return { success: true, emails };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('imap:getUnread', async () => {
  try {
    const accounts = imapAccountManager.getAccounts();
    if (accounts.length === 0) {
      return { success: false, error: 'Keine IMAP-Konten konfiguriert' };
    }
    // Get unread from all accounts
    const allUnread = [];
    for (const account of accounts) {
      const emails = await imapAccountManager.getEmails(account.id, 'INBOX', 50);
      const unread = emails.filter(e => !e.seen);
      allUnread.push(...unread.map(e => ({ ...e, accountId: account.id, accountName: account.name })));
    }
    return { success: true, emails: allUnread };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// App Events
app.whenReady().then(() => {
  // Initialize user ID (generate on first launch)
  let userId = store.get('user_id');
  if (!userId) {
    userId = generateUserId();
    store.set('user_id', userId);
    console.log('[USER] New user ID generated:', userId);
  } else {
    console.log('[USER] Existing user ID:', userId);
  }

  // Set user ID in notesService
  notesService.setUserId(userId);

  // Initialize Email Provider Manager
  emailProviderManager = new EmailProviderManager({
    outlook: {
      clientId: store.get('outlook_client_id') || OUTLOOK_CONFIG.clientId
    }
  });
  emailProviderManager.initialize(gmailService).catch(err => {
    console.error('[EMAIL] Provider manager init error:', err);
  });

  // Initialize IMAP Account Manager
  imapAccountManager.initialize(store);
  console.log('[IMAP] Account manager initialized');

  createWindow();
  createTray();
  registerHotkey();
  initWebSocketServer();

  // Snap Overlay Window fuer Dock-Indikatoren vorbereiten
  createSnapOverlayWindow();

  // Windows AppBar APIs initialisieren (fuer reservierten Bildschirmbereich)
  if (isWindowsAppBar) {
    const initResult = initAppBarAPIs();
    console.log('[AppBar] Init Ergebnis:', initResult, '- Fehler:', getInitError() || 'keiner');
  }

  // Multi-Monitor Docking System initialisieren
  multiMonitorDocking.init({
    mainWindow: mainWindow,
    appBarManager: appBarManager,
    enabled: store.get('multi_monitor_enabled')
  });
  console.log('[MultiMonitor] Initialisiert - Enabled:', store.get('multi_monitor_enabled'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, just hide to tray
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopWakeWordService();
  if (wsServer) {
    wsServer.stop();
  }
  // Multi-Monitor Docking aufräumen
  multiMonitorDocking.removeAllDockWindows();

  // Windows AppBar deregistrieren - WICHTIG!
  if (isWindowsAppBar && appBarManager.getIsRegistered()) {
    appBarManager.unregisterAll(); // unregisterAll statt unregister für Multi-Monitor
  }
});
