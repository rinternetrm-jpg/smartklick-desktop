/**
 * Windows AppBar API für Smartklick
 *
 * Reserviert permanent einen Bildschirmbereich.
 * Andere Fenster (Chrome etc.) maximieren sich NUR in den freien Bereich.
 *
 * WICHTIG: Immer unregister() aufrufen beim:
 * - Undocking
 * - App beenden
 * - Dock-Position wechseln
 */

const { screen } = require('electron');

// Nur auf Windows
const isWindows = process.platform === 'win32';

let ffi, ref, StructType;
let shell32 = null;
let RECT = null;
let APPBARDATA = null;
let initError = null;  // Speichert Fehler bei Initialisierung
let initDone = false;  // Wurde init aufgerufen?

// AppBar Konstanten
const ABM_NEW = 0x00000000;        // Registrieren
const ABM_REMOVE = 0x00000001;     // Entfernen
const ABM_QUERYPOS = 0x00000002;   // Position abfragen
const ABM_SETPOS = 0x00000003;     // Position setzen
const ABM_ACTIVATE = 0x00000006;
const ABM_WINDOWPOSCHANGED = 0x00000009;

// Kanten-Konstanten
const ABE_LEFT = 0;
const ABE_TOP = 1;
const ABE_RIGHT = 2;
const ABE_BOTTOM = 3;

// Mapping für einfachere Nutzung
const EDGE_MAP = {
  'left': ABE_LEFT,
  'top': ABE_TOP,
  'right': ABE_RIGHT,
  'bottom': ABE_BOTTOM
};

/**
 * Initialisiert die nativen APIs
 */
function initNativeAPIs() {
  initDone = true;
  initError = null;

  if (!isWindows) {
    initError = 'Nicht auf Windows';
    return false;
  }

  try {
    ffi = require('ffi-napi');
  } catch (e) {
    initError = 'ffi-napi laden fehlgeschlagen: ' + e.message;
    return false;
  }

  try {
    ref = require('ref-napi');
  } catch (e) {
    initError = 'ref-napi laden fehlgeschlagen: ' + e.message;
    return false;
  }

  try {
    StructType = require('ref-struct-di')(ref);
  } catch (e) {
    initError = 'ref-struct-di laden fehlgeschlagen: ' + e.message;
    return false;
  }

  try {

    // RECT Struktur
    RECT = StructType({
      left: ref.types.int32,
      top: ref.types.int32,
      right: ref.types.int32,
      bottom: ref.types.int32
    });

    // APPBARDATA Struktur
    APPBARDATA = StructType({
      cbSize: ref.types.uint32,
      hWnd: ref.types.uint64,
      uCallbackMessage: ref.types.uint32,
      uEdge: ref.types.uint32,
      rc: RECT,
      lParam: ref.types.int32
    });

    console.log('[AppBar] APPBARDATA size:', APPBARDATA.size);

    // Shell32 laden
    shell32 = ffi.Library('shell32', {
      'SHAppBarMessage': ['uint32', ['uint32', ref.refType(APPBARDATA)]]
    });

    return true;

  } catch (error) {
    initError = 'Struktur/Shell32 Fehler: ' + error.message;
    return false;
  }
}

/**
 * Gibt den Init-Fehler zurück
 */
function getInitError() {
  return initError;
}

/**
 * Prüft ob init aufgerufen wurde
 */
function wasInitCalled() {
  return initDone;
}

class AppBarManager {
  constructor() {
    this.isRegistered = false;
    this.currentEdge = null;
    this.hwnd = null;
    this.currentSize = 0;

    // Multi-Monitor Support: Map displayId → { hwnd, edge, size }
    this.displayRegistrations = new Map();
  }

  /**
   * Registriert das Fenster als AppBar
   * @param {Buffer} hwndBuffer - Native Window Handle (mainWindow.getNativeWindowHandle())
   * @param {string} edge - 'top', 'bottom', 'left', 'right'
   * @param {number} size - Größe in Pixel (Höhe für top/bottom, Breite für left/right)
   */
  register(hwndBuffer, edge, size) {
    // Detaillierter Status für Debugging
    this.lastError = null;

    if (!isWindows) {
      this.lastError = 'Nicht auf Windows';
      return false;
    }

    if (!shell32) {
      this.lastError = 'shell32 nicht geladen - initNativeAPIs() aufrufen!';
      return false;
    }

    if (!APPBARDATA) {
      this.lastError = 'APPBARDATA Struktur nicht definiert';
      return false;
    }

    // Wenn bereits registriert, erst entfernen
    if (this.isRegistered) {
      this.unregister();
    }

    try {
      // HWND als 64-bit Integer lesen
      let hwndValue;
      if (hwndBuffer.length >= 8) {
        hwndValue = hwndBuffer.readBigUInt64LE(0);
      } else {
        hwndValue = BigInt(hwndBuffer.readUInt32LE(0));
      }

      console.log('[AppBar] HWND:', hwndValue.toString(16));

      this.hwnd = hwndBuffer;
      this.currentEdge = edge;
      this.currentSize = size;

      const display = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = display.size;
      const edgeConstant = EDGE_MAP[edge];

      // APPBARDATA erstellen
      const abd = new APPBARDATA();
      abd.cbSize = APPBARDATA.size;
      abd.hWnd = hwndValue;
      abd.uCallbackMessage = 0;
      abd.uEdge = edgeConstant;

      // Rechteck basierend auf Kante setzen
      switch (edge) {
        case 'top':
          abd.rc.left = 0;
          abd.rc.top = 0;
          abd.rc.right = screenWidth;
          abd.rc.bottom = size;
          break;
        case 'bottom':
          abd.rc.left = 0;
          abd.rc.top = screenHeight - size;
          abd.rc.right = screenWidth;
          abd.rc.bottom = screenHeight;
          break;
        case 'left':
          abd.rc.left = 0;
          abd.rc.top = 0;
          abd.rc.right = size;
          abd.rc.bottom = screenHeight;
          break;
        case 'right':
          abd.rc.left = screenWidth - size;
          abd.rc.top = 0;
          abd.rc.right = screenWidth;
          abd.rc.bottom = screenHeight;
          break;
      }

      console.log('[AppBar] Registriere:', {
        edge,
        size,
        rect: { left: abd.rc.left, top: abd.rc.top, right: abd.rc.right, bottom: abd.rc.bottom }
      });

      // 1. AppBar registrieren (ABM_NEW)
      const newResult = shell32.SHAppBarMessage(ABM_NEW, abd.ref());
      console.log('[AppBar] ABM_NEW Ergebnis:', newResult);

      if (newResult === 0) {
        this.lastError = 'ABM_NEW fehlgeschlagen (result=0)';
        return false;
      }

      // 2. Position abfragen (ABM_QUERYPOS) - Windows kann sie anpassen
      shell32.SHAppBarMessage(ABM_QUERYPOS, abd.ref());
      console.log('[AppBar] ABM_QUERYPOS - Rect nach Query:', {
        left: abd.rc.left, top: abd.rc.top, right: abd.rc.right, bottom: abd.rc.bottom
      });

      // 3. Position setzen (ABM_SETPOS)
      shell32.SHAppBarMessage(ABM_SETPOS, abd.ref());
      console.log('[AppBar] ABM_SETPOS - Finales Rect:', {
        left: abd.rc.left, top: abd.rc.top, right: abd.rc.right, bottom: abd.rc.bottom
      });

      this.isRegistered = true;
      console.log('[AppBar] Erfolgreich registriert!');

      return true;

    } catch (error) {
      this.lastError = 'Exception: ' + error.message;
      console.error('[AppBar] Fehler bei Registrierung:', error.message);
      return false;
    }
  }

  /**
   * Gibt den letzten Fehler zurück
   */
  getLastError() {
    return this.lastError;
  }

  /**
   * Entfernt die AppBar-Registrierung
   */
  unregister() {
    if (!isWindows || !shell32 || !APPBARDATA || !this.isRegistered || !this.hwnd) {
      return false;
    }

    try {
      // HWND lesen
      let hwndValue;
      if (this.hwnd.length >= 8) {
        hwndValue = this.hwnd.readBigUInt64LE(0);
      } else {
        hwndValue = BigInt(this.hwnd.readUInt32LE(0));
      }

      const abd = new APPBARDATA();
      abd.cbSize = APPBARDATA.size;
      abd.hWnd = hwndValue;

      const result = shell32.SHAppBarMessage(ABM_REMOVE, abd.ref());
      console.log('[AppBar] ABM_REMOVE Ergebnis:', result);

      this.isRegistered = false;
      this.currentEdge = null;
      this.hwnd = null;
      this.currentSize = 0;

      console.log('[AppBar] Deregistriert');
      return true;

    } catch (error) {
      console.error('[AppBar] Fehler beim Deregistrieren:', error.message);
      return false;
    }
  }

  /**
   * Aktualisiert die AppBar-Position (z.B. bei Größenänderung)
   */
  updatePosition(size) {
    if (!this.isRegistered || !this.hwnd) {
      return false;
    }

    return this.register(this.hwnd, this.currentEdge, size);
  }

  /**
   * Prüft ob als AppBar registriert
   */
  getIsRegistered() {
    return this.isRegistered;
  }

  /**
   * Gibt aktuelle Kante zurück
   */
  getCurrentEdge() {
    return this.currentEdge;
  }

  // =============================================================================
  // MULTI-MONITOR SUPPORT
  // =============================================================================

  /**
   * Registriert AppBar für einen bestimmten Monitor
   * @param {BrowserWindow} browserWindow - Das Dock-Fenster
   * @param {string} edge - 'top', 'bottom', 'left', 'right'
   * @param {number} size - Größe in Pixel
   * @param {Display} display - Electron Display Objekt
   */
  registerForDisplay(browserWindow, edge, size, display) {
    if (!isWindows || !shell32 || !APPBARDATA) {
      console.log('[AppBar] Überspringe registerForDisplay - nicht auf Windows oder nicht initialisiert');
      return false;
    }

    const displayId = display.id;
    const { bounds } = display;

    // Erst alte Registrierung für diesen Monitor entfernen
    if (this.displayRegistrations.has(displayId)) {
      this.unregisterForDisplay(displayId);
    }

    try {
      const hwndBuffer = browserWindow.getNativeWindowHandle();
      let hwndValue;
      if (hwndBuffer.length >= 8) {
        hwndValue = hwndBuffer.readBigUInt64LE(0);
      } else {
        hwndValue = BigInt(hwndBuffer.readUInt32LE(0));
      }

      const abd = new APPBARDATA();
      abd.cbSize = APPBARDATA.size;
      abd.hWnd = hwndValue;
      abd.uCallbackMessage = 0;
      abd.uEdge = EDGE_MAP[edge];

      // Rechteck für diesen spezifischen Monitor berechnen
      switch (edge) {
        case 'top':
          abd.rc.left = bounds.x;
          abd.rc.top = bounds.y;
          abd.rc.right = bounds.x + bounds.width;
          abd.rc.bottom = bounds.y + size;
          break;
        case 'bottom':
          abd.rc.left = bounds.x;
          abd.rc.top = bounds.y + bounds.height - size;
          abd.rc.right = bounds.x + bounds.width;
          abd.rc.bottom = bounds.y + bounds.height;
          break;
        case 'left':
          abd.rc.left = bounds.x;
          abd.rc.top = bounds.y;
          abd.rc.right = bounds.x + size;
          abd.rc.bottom = bounds.y + bounds.height;
          break;
        case 'right':
          abd.rc.left = bounds.x + bounds.width - size;
          abd.rc.top = bounds.y;
          abd.rc.right = bounds.x + bounds.width;
          abd.rc.bottom = bounds.y + bounds.height;
          break;
      }

      console.log(`[AppBar] Registriere für Display ${displayId}:`, {
        edge, size,
        rect: { left: abd.rc.left, top: abd.rc.top, right: abd.rc.right, bottom: abd.rc.bottom }
      });

      // Registrieren
      const newResult = shell32.SHAppBarMessage(ABM_NEW, abd.ref());
      if (newResult === 0) {
        console.error(`[AppBar] ABM_NEW fehlgeschlagen für Display ${displayId}`);
        return false;
      }

      shell32.SHAppBarMessage(ABM_QUERYPOS, abd.ref());
      shell32.SHAppBarMessage(ABM_SETPOS, abd.ref());

      // In Map speichern
      this.displayRegistrations.set(displayId, {
        hwndBuffer,
        hwndValue,
        edge,
        size,
        abd
      });

      console.log(`[AppBar] Erfolgreich registriert für Display ${displayId}`);
      return true;

    } catch (error) {
      console.error(`[AppBar] Fehler bei registerForDisplay (${displayId}):`, error.message);
      return false;
    }
  }

  /**
   * Entfernt AppBar für einen bestimmten Monitor
   * @param {number} displayId - Die Display-ID
   */
  unregisterForDisplay(displayId) {
    if (!isWindows || !shell32 || !APPBARDATA) {
      return false;
    }

    const reg = this.displayRegistrations.get(displayId);
    if (!reg) {
      return false;
    }

    try {
      const abd = new APPBARDATA();
      abd.cbSize = APPBARDATA.size;
      abd.hWnd = reg.hwndValue;

      shell32.SHAppBarMessage(ABM_REMOVE, abd.ref());

      this.displayRegistrations.delete(displayId);
      console.log(`[AppBar] Entfernt für Display ${displayId}`);
      return true;

    } catch (error) {
      console.error(`[AppBar] Fehler bei unregisterForDisplay (${displayId}):`, error.message);
      return false;
    }
  }

  /**
   * Entfernt alle AppBar-Registrierungen (Multi-Monitor)
   */
  unregisterAll() {
    // Erst die Multi-Monitor Registrierungen
    this.displayRegistrations.forEach((reg, displayId) => {
      this.unregisterForDisplay(displayId);
    });

    // Dann die Standard-Registrierung
    if (this.isRegistered) {
      this.unregister();
    }
  }
}

// Singleton
const appBarManager = new AppBarManager();

module.exports = {
  initNativeAPIs,
  getInitError,
  wasInitCalled,
  appBarManager,
  AppBarManager,
  isWindows,
  // Konstanten
  ABE_LEFT,
  ABE_TOP,
  ABE_RIGHT,
  ABE_BOTTOM
};
