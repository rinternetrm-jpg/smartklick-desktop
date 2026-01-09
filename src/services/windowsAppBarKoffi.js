/**
 * Windows AppBar mit Koffi - Reserviert Bildschirmbereich wie die Windows-Taskleiste
 *
 * Koffi ist moderner und hat bessere Type-Handling als ffi-napi
 */

const { screen } = require('electron');

// Nur auf Windows
const isWindows = process.platform === 'win32';

let koffi = null;
let shell32 = null;
let user32 = null;
let isRegistered = false;
let currentEdge = null;
let lastBounds = null;
let registeredHwnd = null;

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

// Window Styles fuer ToolWindow
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;

// APPBARDATA Struktur Layout (48 bytes auf x64)
let APPBARDATA = null;
let appBarBuffer = null;

/**
 * Initialisiert die nativen Windows APIs mit Koffi
 */
function initNativeAPIs() {
  if (!isWindows) {
    console.log('[AppBar-Koffi] Nicht auf Windows - AppBar deaktiviert');
    return false;
  }

  try {
    koffi = require('koffi');
    console.log('[AppBar-Koffi] Koffi geladen');

    // RECT Struktur definieren
    const RECT = koffi.struct('RECT', {
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32'
    });

    // APPBARDATA Struktur definieren (48 bytes auf x64)
    APPBARDATA = koffi.struct('APPBARDATA', {
      cbSize: 'uint32',       // 0: 4 bytes
      hWnd: 'uintptr',        // 8: 8 bytes (aligned)
      uCallbackMessage: 'uint32', // 16: 4 bytes
      uEdge: 'uint32',        // 20: 4 bytes
      rc: RECT,               // 24: 16 bytes
      lParam: 'intptr'        // 40: 8 bytes
    });

    console.log('[AppBar-Koffi] APPBARDATA Groesse:', koffi.sizeof(APPBARDATA));

    // Shell32.dll laden
    shell32 = koffi.load('shell32.dll');

    // SHAppBarMessage Funktion
    const SHAppBarMessage = shell32.func('uint32 SHAppBarMessage(uint32 dwMessage, APPBARDATA* pData)');

    // Als Methode speichern
    shell32.SHAppBarMessage = SHAppBarMessage;

    // User32.dll fuer GetWindowLong/SetWindowLong
    user32 = koffi.load('user32.dll');

    const GetWindowLongPtrW = user32.func('intptr GetWindowLongPtrW(uintptr hWnd, int nIndex)');
    const SetWindowLongPtrW = user32.func('intptr SetWindowLongPtrW(uintptr hWnd, int nIndex, intptr dwNewLong)');

    user32.GetWindowLongPtrW = GetWindowLongPtrW;
    user32.SetWindowLongPtrW = SetWindowLongPtrW;

    console.log('[AppBar-Koffi] Shell32 und User32 geladen');
    return true;

  } catch (error) {
    console.error('[AppBar-Koffi] Fehler beim Initialisieren:', error.message);
    console.error('[AppBar-Koffi] Stack:', error.stack);
    return false;
  }
}

/**
 * Registriert das Fenster als AppBar
 */
function registerAppBar(window) {
  if (!isWindows || !shell32 || !APPBARDATA) {
    console.log('[AppBar-Koffi] APIs nicht verfuegbar');
    return false;
  }

  if (isRegistered) {
    console.log('[AppBar-Koffi] Bereits registriert');
    return true;
  }

  try {
    // Native Window Handle holen
    const hwndBuffer = window.getNativeWindowHandle();
    console.log('[AppBar-Koffi] HWND Buffer Laenge:', hwndBuffer.length);

    // HWND als Number lesen (fuer koffi uintptr)
    let hwnd;
    if (hwndBuffer.length >= 8) {
      // 64-bit: Lese als BigInt, dann zu Number konvertieren
      const bigHwnd = hwndBuffer.readBigUInt64LE(0);
      hwnd = Number(bigHwnd);
    } else {
      hwnd = hwndBuffer.readUInt32LE(0);
    }
    console.log('[AppBar-Koffi] HWND:', hwnd.toString(16));

    registeredHwnd = hwnd;

    // Optional: Fenster als ToolWindow markieren (erscheint nicht in Taskleiste)
    // Dies kann helfen, dass Windows es als System-UI behandelt
    try {
      const currentStyle = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
      console.log('[AppBar-Koffi] Aktuelle ExStyle:', currentStyle.toString(16));
      // Wir setzen NICHT WS_EX_TOOLWINDOW, da wir in Taskleiste bleiben wollen
    } catch (e) {
      console.log('[AppBar-Koffi] GetWindowLongPtrW Fehler:', e.message);
    }

    // APPBARDATA Struktur erstellen
    const appBarData = {
      cbSize: koffi.sizeof(APPBARDATA),
      hWnd: hwnd,
      uCallbackMessage: 0,
      uEdge: 0,
      rc: { left: 0, top: 0, right: 0, bottom: 0 },
      lParam: 0
    };

    console.log('[AppBar-Koffi] Registriere mit cbSize:', appBarData.cbSize);

    // AppBar registrieren (ABM_NEW)
    const result = shell32.SHAppBarMessage(ABM_NEW, appBarData);
    console.log('[AppBar-Koffi] ABM_NEW Ergebnis:', result);

    if (result !== 0) {
      isRegistered = true;
      appBarBuffer = appBarData; // Speichern fuer spaetere Aufrufe
      console.log('[AppBar-Koffi] Erfolgreich registriert!');
      return true;
    } else {
      console.error('[AppBar-Koffi] Registrierung fehlgeschlagen (result=0)');
      return false;
    }

  } catch (error) {
    console.error('[AppBar-Koffi] Fehler bei Registrierung:', error.message);
    console.error('[AppBar-Koffi] Stack:', error.stack);
    return false;
  }
}

/**
 * Entfernt die AppBar-Registrierung
 */
function unregisterAppBar() {
  if (!isWindows || !shell32 || !isRegistered || !registeredHwnd) {
    return false;
  }

  try {
    const appBarData = {
      cbSize: koffi.sizeof(APPBARDATA),
      hWnd: registeredHwnd,
      uCallbackMessage: 0,
      uEdge: 0,
      rc: { left: 0, top: 0, right: 0, bottom: 0 },
      lParam: 0
    };

    const result = shell32.SHAppBarMessage(ABM_REMOVE, appBarData);
    console.log('[AppBar-Koffi] ABM_REMOVE Ergebnis:', result);

    isRegistered = false;
    currentEdge = null;
    lastBounds = null;
    registeredHwnd = null;
    appBarBuffer = null;

    console.log('[AppBar-Koffi] Deregistriert');
    return true;
  } catch (error) {
    console.error('[AppBar-Koffi] Fehler beim Deregistrieren:', error.message);
    return false;
  }
}

/**
 * Setzt die Position der AppBar und reserviert den Bildschirmbereich
 */
function setAppBarPosition(edge, x, y, width, height) {
  if (!isWindows || !shell32 || !isRegistered || !registeredHwnd) {
    console.log('[AppBar-Koffi] Kann Position nicht setzen - Status:', {
      isWindows,
      shell32: !!shell32,
      isRegistered,
      registeredHwnd: !!registeredHwnd
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
        console.error('[AppBar-Koffi] Ungueltiger Edge:', edge);
        return false;
    }

    // APPBARDATA mit Position erstellen
    const appBarData = {
      cbSize: koffi.sizeof(APPBARDATA),
      hWnd: registeredHwnd,
      uCallbackMessage: 0,
      uEdge: uEdge,
      rc: {
        left: Math.round(x),
        top: Math.round(y),
        right: Math.round(x + width),
        bottom: Math.round(y + height)
      },
      lParam: 0
    };

    console.log('[AppBar-Koffi] Setze Position:', {
      edge,
      uEdge,
      rect: appBarData.rc
    });

    // Erst Position abfragen (ABM_QUERYPOS)
    const queryResult = shell32.SHAppBarMessage(ABM_QUERYPOS, appBarData);
    console.log('[AppBar-Koffi] ABM_QUERYPOS Ergebnis:', queryResult);
    console.log('[AppBar-Koffi] Nach QUERYPOS rect:', appBarData.rc);

    // Position setzen (ABM_SETPOS)
    const setResult = shell32.SHAppBarMessage(ABM_SETPOS, appBarData);
    console.log('[AppBar-Koffi] ABM_SETPOS Ergebnis:', setResult);
    console.log('[AppBar-Koffi] Nach SETPOS rect:', appBarData.rc);

    currentEdge = edge;
    lastBounds = { x, y, width, height };

    console.log('[AppBar-Koffi] Position erfolgreich gesetzt');
    return true;

  } catch (error) {
    console.error('[AppBar-Koffi] Fehler beim Setzen der Position:', error.message);
    console.error('[AppBar-Koffi] Stack:', error.stack);
    return false;
  }
}

/**
 * Aktiviert die AppBar
 */
function activateAppBar() {
  if (!isWindows || !shell32 || !isRegistered || !registeredHwnd) {
    return false;
  }

  try {
    const appBarData = {
      cbSize: koffi.sizeof(APPBARDATA),
      hWnd: registeredHwnd,
      uCallbackMessage: 0,
      uEdge: 0,
      rc: { left: 0, top: 0, right: 0, bottom: 0 },
      lParam: 0
    };

    shell32.SHAppBarMessage(ABM_ACTIVATE, appBarData);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Benachrichtigt ueber Positionsaenderung
 */
function notifyPositionChanged() {
  if (!isWindows || !shell32 || !isRegistered || !registeredHwnd) {
    return false;
  }

  try {
    const appBarData = {
      cbSize: koffi.sizeof(APPBARDATA),
      hWnd: registeredHwnd,
      uCallbackMessage: 0,
      uEdge: 0,
      rc: { left: 0, top: 0, right: 0, bottom: 0 },
      lParam: 0
    };

    shell32.SHAppBarMessage(ABM_WINDOWPOSCHANGED, appBarData);
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
