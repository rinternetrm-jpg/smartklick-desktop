/**
 * Windows AppBar - Reserviert Bildschirmbereich wie die Windows-Taskleiste
 *
 * Version 2: Korrigierte Implementierung mit besserer Fehlerbehandlung
 */

const { screen } = require('electron');

// Nur auf Windows
const isWindows = process.platform === 'win32';

let ffi, ref, StructType;
let shell32 = null;
let APPBARDATA = null;
let appBarInstance = null;
let isRegistered = false;
let currentEdge = null;
let lastBounds = null;

// AppBar Message Constants
const ABM_NEW = 0x00000000;
const ABM_REMOVE = 0x00000001;
const ABM_QUERYPOS = 0x00000002;
const ABM_SETPOS = 0x00000003;
const ABM_ACTIVATE = 0x00000006;
const ABM_WINDOWPOSCHANGED = 0x00000009;

// AppBar Edge Constants
const ABE_LEFT = 0;
const ABE_TOP = 1;
const ABE_RIGHT = 2;
const ABE_BOTTOM = 3;

/**
 * Initialisiert die nativen Windows APIs
 */
function initNativeAPIs() {
  if (!isWindows) {
    console.log('[AppBar] Nicht auf Windows - AppBar deaktiviert');
    return false;
  }

  try {
    ffi = require('ffi-napi');
    ref = require('ref-napi');
    StructType = require('ref-struct-napi');

    console.log('[AppBar] Module geladen');

    // RECT Struktur (16 bytes)
    const RECT = StructType({
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32'
    });

    // APPBARDATA Struktur fuer 64-bit Windows
    // Groesse: 48 bytes auf x64
    APPBARDATA = StructType({
      cbSize: 'uint32',      // 4 bytes
      hWnd: 'uint64',        // 8 bytes (HWND ist pointer auf x64)
      uCallbackMessage: 'uint32',  // 4 bytes
      uEdge: 'uint32',       // 4 bytes
      rc: RECT,              // 16 bytes
      lParam: 'int64'        // 8 bytes
    });

    console.log('[AppBar] APPBARDATA size:', APPBARDATA.size);

    // Shell32.dll fuer SHAppBarMessage
    shell32 = ffi.Library('shell32.dll', {
      'SHAppBarMessage': ['uint', ['uint', 'pointer']]
    });

    console.log('[AppBar] Shell32 geladen');
    return true;

  } catch (error) {
    console.error('[AppBar] Fehler beim Initialisieren:', error.message);
    console.error('[AppBar] Stack:', error.stack);
    return false;
  }
}

/**
 * Registriert das Fenster als AppBar
 */
function registerAppBar(window) {
  if (!isWindows || !shell32 || !APPBARDATA) {
    console.log('[AppBar] APIs nicht verfuegbar');
    return false;
  }

  if (isRegistered) {
    console.log('[AppBar] Bereits registriert');
    return true;
  }

  try {
    // Native Window Handle holen
    const hwndBuffer = window.getNativeWindowHandle();
    console.log('[AppBar] HWND Buffer Laenge:', hwndBuffer.length);

    // HWND als 64-bit Integer lesen
    let hwnd;
    if (hwndBuffer.length >= 8) {
      hwnd = hwndBuffer.readBigUInt64LE(0);
    } else {
      hwnd = BigInt(hwndBuffer.readUInt32LE(0));
    }
    console.log('[AppBar] HWND:', hwnd.toString(16));

    // AppBarData Instanz erstellen
    appBarInstance = new APPBARDATA();
    appBarInstance.cbSize = APPBARDATA.size;
    appBarInstance.hWnd = hwnd;
    appBarInstance.uCallbackMessage = 0; // Kein Callback noetig
    appBarInstance.uEdge = 0;
    appBarInstance.rc.left = 0;
    appBarInstance.rc.top = 0;
    appBarInstance.rc.right = 0;
    appBarInstance.rc.bottom = 0;
    appBarInstance.lParam = 0;

    console.log('[AppBar] Registriere mit cbSize:', appBarInstance.cbSize);

    // AppBar registrieren (ABM_NEW)
    const result = shell32.SHAppBarMessage(ABM_NEW, appBarInstance.ref());
    console.log('[AppBar] ABM_NEW Ergebnis:', result);

    if (result !== 0) {
      isRegistered = true;
      console.log('[AppBar] Erfolgreich registriert!');
      return true;
    } else {
      console.error('[AppBar] Registrierung fehlgeschlagen (result=0)');
      return false;
    }

  } catch (error) {
    console.error('[AppBar] Fehler bei Registrierung:', error.message);
    console.error('[AppBar] Stack:', error.stack);
    return false;
  }
}

/**
 * Entfernt die AppBar-Registrierung
 */
function unregisterAppBar() {
  if (!isWindows || !shell32 || !appBarInstance || !isRegistered) {
    return false;
  }

  try {
    const result = shell32.SHAppBarMessage(ABM_REMOVE, appBarInstance.ref());
    console.log('[AppBar] ABM_REMOVE Ergebnis:', result);

    isRegistered = false;
    currentEdge = null;
    lastBounds = null;
    appBarInstance = null;

    console.log('[AppBar] Deregistriert');
    return true;
  } catch (error) {
    console.error('[AppBar] Fehler beim Deregistrieren:', error.message);
    return false;
  }
}

/**
 * Setzt die Position der AppBar und reserviert den Bildschirmbereich
 */
function setAppBarPosition(edge, x, y, width, height) {
  if (!isWindows || !shell32 || !appBarInstance || !isRegistered) {
    console.log('[AppBar] Kann Position nicht setzen - Status:', {
      isWindows,
      shell32: !!shell32,
      appBarInstance: !!appBarInstance,
      isRegistered
    });
    return false;
  }

  try {
    // Edge-Konstante bestimmen
    let uEdge;
    switch (edge) {
      case 'left': uEdge = ABE_LEFT; break;
      case 'top': uEdge = ABE_TOP; break;
      case 'right': uEdge = ABE_RIGHT; break;
      case 'bottom': uEdge = ABE_BOTTOM; break;
      default:
        console.error('[AppBar] Ungueltiger Edge:', edge);
        return false;
    }

    // Bounds setzen
    appBarInstance.uEdge = uEdge;
    appBarInstance.rc.left = x;
    appBarInstance.rc.top = y;
    appBarInstance.rc.right = x + width;
    appBarInstance.rc.bottom = y + height;

    console.log('[AppBar] Setze Position:', {
      edge,
      uEdge,
      rect: { left: x, top: y, right: x + width, bottom: y + height }
    });

    // Erst Position abfragen (ABM_QUERYPOS)
    const queryResult = shell32.SHAppBarMessage(ABM_QUERYPOS, appBarInstance.ref());
    console.log('[AppBar] ABM_QUERYPOS Ergebnis:', queryResult);

    // Nach QUERYPOS die angepassten Werte erneut setzen
    // Windows kann die Position anpassen wenn Konflikte bestehen

    // Position setzen (ABM_SETPOS)
    const setResult = shell32.SHAppBarMessage(ABM_SETPOS, appBarInstance.ref());
    console.log('[AppBar] ABM_SETPOS Ergebnis:', setResult);

    currentEdge = edge;
    lastBounds = { x, y, width, height };

    console.log('[AppBar] Position erfolgreich gesetzt');
    return true;

  } catch (error) {
    console.error('[AppBar] Fehler beim Setzen der Position:', error.message);
    console.error('[AppBar] Stack:', error.stack);
    return false;
  }
}

/**
 * Aktiviert die AppBar
 */
function activateAppBar() {
  if (!isWindows || !shell32 || !appBarInstance || !isRegistered) {
    return false;
  }

  try {
    shell32.SHAppBarMessage(ABM_ACTIVATE, appBarInstance.ref());
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Benachrichtigt ueber Positionsaenderung
 */
function notifyPositionChanged() {
  if (!isWindows || !shell32 || !appBarInstance || !isRegistered) {
    return false;
  }

  try {
    shell32.SHAppBarMessage(ABM_WINDOWPOSCHANGED, appBarInstance.ref());
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Prueft ob AppBar registriert ist
 */
function isAppBarRegistered() {
  return isRegistered;
}

/**
 * Gibt aktuellen Edge zurueck
 */
function getCurrentEdge() {
  return currentEdge;
}

/**
 * Gibt letzte Bounds zurueck
 */
function getLastBounds() {
  return lastBounds;
}

module.exports = {
  initNativeAPIs,
  registerAppBar,
  unregisterAppBar,
  setAppBarPosition,
  activateAppBar,
  notifyPositionChanged,
  isAppBarRegistered,
  getCurrentEdge,
  getLastBounds,
  isWindows
};
