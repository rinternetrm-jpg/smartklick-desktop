/**
 * Windows AppBar API mit Koffi
 *
 * Koffi braucht keine native Compilation - funktioniert out of the box!
 */

const { screen } = require('electron');

const isWindows = process.platform === 'win32';

let koffi = null;
let SHAppBarMessage = null;
let SetWindowPos = null;
let SendNotifyMessageW = null;
let APPBARDATA = null;
let appBarDataSize = 0;
let initError = null;
let initDone = false;

// SetWindowPos Flags
const SWP_NOACTIVATE = 0x0010;
const SWP_NOZORDER = 0x0004;
const HWND_TOPMOST = -1;

// Broadcast Konstanten
const HWND_BROADCAST = 0xFFFF;
const WM_SETTINGCHANGE = 0x001A;
const SPI_SETWORKAREA = 0x002F;

// AppBar Konstanten
const ABM_NEW = 0x00000000;
const ABM_REMOVE = 0x00000001;
const ABM_QUERYPOS = 0x00000002;
const ABM_SETPOS = 0x00000003;
const ABM_ACTIVATE = 0x00000006;
const ABM_GETAUTOHIDEBAR = 0x00000007;
const ABM_SETAUTOHIDEBAR = 0x00000008;
const ABM_WINDOWPOSCHANGED = 0x00000009;

// Kanten-Konstanten
const ABE_LEFT = 0;
const ABE_TOP = 1;
const ABE_RIGHT = 2;
const ABE_BOTTOM = 3;

const EDGE_MAP = {
  'left': ABE_LEFT,
  'top': ABE_TOP,
  'right': ABE_RIGHT,
  'bottom': ABE_BOTTOM
};

/**
 * Initialisiert Koffi und die Windows APIs
 */
function initNativeAPIs() {
  initDone = true;
  initError = null;

  if (!isWindows) {
    initError = 'Nicht auf Windows';
    return false;
  }

  try {
    koffi = require('koffi');
  } catch (e) {
    initError = 'koffi laden fehlgeschlagen: ' + e.message;
    return false;
  }

  try {
    // RECT und APPBARDATA als Koffi Structs definieren
    const RECT = koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long'
    });

    // APPBARDATA für 64-bit Windows
    // lParam ist LPARAM = LONG_PTR = 64-bit auf x64
    APPBARDATA = koffi.struct('APPBARDATA', {
      cbSize: 'uint32',
      hWnd: 'void*',
      uCallbackMessage: 'uint32',
      uEdge: 'uint32',
      rc: RECT,
      lParam: 'int64'  // LPARAM ist 64-bit auf x64
    });

    // Struct-Größe berechnen
    appBarDataSize = koffi.sizeof(APPBARDATA);
    console.log('[AppBar] APPBARDATA size:', appBarDataSize);

    // Shell32.dll laden
    const shell32 = koffi.load('shell32.dll');
    SHAppBarMessage = shell32.func('uint __stdcall SHAppBarMessage(uint dwMessage, _Inout_ APPBARDATA* pData)');

    // User32.dll für SetWindowPos und SendNotifyMessageW
    const user32 = koffi.load('user32.dll');
    SetWindowPos = user32.func('int __stdcall SetWindowPos(void* hWnd, void* hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)');
    SendNotifyMessageW = user32.func('int __stdcall SendNotifyMessageW(void* hWnd, uint Msg, uintptr_t wParam, intptr_t lParam)');

    return true;

  } catch (e) {
    initError = 'Koffi Setup fehlgeschlagen: ' + e.message;
    return false;
  }
}

function getInitError() {
  return initError;
}

function wasInitCalled() {
  return initDone;
}

class AppBarManager {
  constructor() {
    this.isRegistered = false;
    this.currentEdge = null;
    this.hwndBuffer = null;
    this.lastError = null;
    this.debugLogs = [];

    // Multi-Monitor Support: Map displayId → { hwndBuffer, edge, size }
    this.displayRegistrations = new Map();
  }

  log(msg) {
    console.log('[AppBar] ' + msg);
    this.debugLogs.push(msg);
  }

  getDebugLogs() {
    return this.debugLogs;
  }

  clearDebugLogs() {
    this.debugLogs = [];
  }

  register(hwndBuffer, edge, size, displayBounds = null, workArea = null) {
    this.lastError = null;

    if (!isWindows) {
      this.lastError = 'Nicht auf Windows';
      return false;
    }

    if (!SHAppBarMessage) {
      this.lastError = 'SHAppBarMessage nicht geladen - initNativeAPIs() aufrufen!';
      return false;
    }

    if (this.isRegistered) {
      this.unregister();
    }

    try {
      this.clearDebugLogs();

      // HWND direkt als Buffer behalten - Koffi kann damit arbeiten
      this.hwndBuffer = hwndBuffer;
      this.currentEdge = edge;

      // Display Bounds: entweder übergeben oder vom Primary Display
      let screenX, screenY, screenWidth, screenHeight;
      if (displayBounds) {
        screenX = displayBounds.x;
        screenY = displayBounds.y;
        screenWidth = displayBounds.width;
        screenHeight = displayBounds.height;
      } else {
        const display = screen.getPrimaryDisplay();
        screenX = display.bounds.x;
        screenY = display.bounds.y;
        screenWidth = display.size.width;
        screenHeight = display.size.height;
      }
      const edgeConstant = EDGE_MAP[edge];

      this.log('Screen: ' + screenWidth + ' x ' + screenHeight + ' at (' + screenX + ',' + screenY + ')');
      this.log('cbSize: ' + appBarDataSize);

      // APPBARDATA erstellen
      // hWnd als koffi.pointer aus dem Buffer
      const abd = {
        cbSize: appBarDataSize,
        hWnd: koffi.decode(hwndBuffer, 'void*'),
        uCallbackMessage: 0,
        uEdge: edgeConstant,
        rc: { left: 0, top: 0, right: 0, bottom: 0 },
        lParam: 0n  // BigInt für int64
      };

      // Rechteck basierend auf Kante setzen (absolute Koordinaten!)
      // Für bottom: workArea verwenden um Taskleiste nicht zu überschreiben
      const workAreaHeight = workArea ? workArea.height : screenHeight;
      const workAreaY = workArea ? workArea.y : screenY;

      this.log('WorkArea: y=' + workAreaY + ' height=' + workAreaHeight);

      switch (edge) {
        case 'top':
          abd.rc.left = screenX;
          abd.rc.top = screenY;
          abd.rc.right = screenX + screenWidth;
          abd.rc.bottom = screenY + size;
          break;
        case 'bottom':
          // WICHTIG: workArea verwenden, nicht screenHeight!
          // So überschreiben wir nicht die Windows-Taskleiste
          abd.rc.left = screenX;
          abd.rc.top = workAreaY + workAreaHeight - size;
          abd.rc.right = screenX + screenWidth;
          abd.rc.bottom = workAreaY + workAreaHeight;
          break;
        case 'left':
          abd.rc.left = screenX;
          abd.rc.top = screenY;
          abd.rc.right = screenX + size;
          abd.rc.bottom = screenY + screenHeight;
          break;
        case 'right':
          abd.rc.left = screenX + screenWidth - size;
          abd.rc.top = screenY;
          abd.rc.right = screenX + screenWidth;
          abd.rc.bottom = screenY + screenHeight;
          break;
      }

      this.log('Rect vor ABM_NEW: ' + JSON.stringify(abd.rc));

      // 0. Erst alte AppBar entfernen (falls vorhanden von früherem Versuch)
      const removeFirst = SHAppBarMessage(ABM_REMOVE, abd);
      this.log('ABM_REMOVE (cleanup) result: ' + removeFirst);

      // 1. AppBar registrieren
      const newResult = SHAppBarMessage(ABM_NEW, abd);
      this.log('ABM_NEW result: ' + newResult);

      if (newResult === 0) {
        this.lastError = 'ABM_NEW fehlgeschlagen (result=0) - evtl. AppBar schon registriert';
        return false;
      }

      // 2. Position abfragen - Windows kann sie anpassen
      const queryResult = SHAppBarMessage(ABM_QUERYPOS, abd);
      this.log('ABM_QUERYPOS result: ' + queryResult);
      this.log('Rect nach QUERYPOS: ' + JSON.stringify(abd.rc));

      // 3. Position setzen
      const setResult = SHAppBarMessage(ABM_SETPOS, abd);
      this.log('ABM_SETPOS result: ' + setResult);
      this.log('Rect nach SETPOS: ' + JSON.stringify(abd.rc));

      // 4. Fenster tatsächlich an die Position setzen
      const x = abd.rc.left;
      const y = abd.rc.top;
      const width = abd.rc.right - abd.rc.left;
      const height = abd.rc.bottom - abd.rc.top;

      this.log('SetWindowPos: x=' + x + ' y=' + y + ' w=' + width + ' h=' + height);

      const hwndPtr = koffi.decode(hwndBuffer, 'void*');

      // SetWindowPos ohne Z-Order Änderung (Electron managed das)
      const posResult = SetWindowPos(
        hwndPtr,
        null,  // hWndInsertAfter - null für keine Z-Order Änderung
        x, y, width, height,
        SWP_NOZORDER | SWP_NOACTIVATE
      );
      this.log('SetWindowPos result: ' + posResult);

      // 5. AppBar aktivieren - wichtig damit andere Fenster reagieren
      const activateResult = SHAppBarMessage(ABM_ACTIVATE, abd);
      this.log('ABM_ACTIVATE result: ' + activateResult);

      // 6. WindowPosChanged senden
      const posChangedResult = SHAppBarMessage(ABM_WINDOWPOSCHANGED, abd);
      this.log('ABM_WINDOWPOSCHANGED result: ' + posChangedResult);

      // 7. Broadcast WM_SETTINGCHANGE - optional, zwingt alle Fenster ihre Größe neu zu berechnen
      try {
        // HWND_BROADCAST (0xFFFF) als Buffer
        const hwndBroadcastBuf = Buffer.alloc(8);
        hwndBroadcastBuf.writeUInt32LE(HWND_BROADCAST, 0);
        const hwndBroadcastPtr = koffi.decode(hwndBroadcastBuf, 'void*');
        const broadcastResult = SendNotifyMessageW(hwndBroadcastPtr, WM_SETTINGCHANGE, SPI_SETWORKAREA, 0);
        this.log('WM_SETTINGCHANGE broadcast result: ' + broadcastResult);
      } catch (broadcastErr) {
        this.log('WM_SETTINGCHANGE broadcast fehlgeschlagen (optional): ' + broadcastErr.message);
      }

      this.isRegistered = true;
      this.reservedRect = { ...abd.rc };
      return true;

    } catch (error) {
      this.lastError = 'Exception: ' + error.message;
      return false;
    }
  }

  unregister() {
    if (!isWindows || !SHAppBarMessage || !this.isRegistered || !this.hwndBuffer) {
      return false;
    }

    try {
      const abd = {
        cbSize: appBarDataSize,
        hWnd: koffi.decode(this.hwndBuffer, 'void*'),
        uCallbackMessage: 0,
        uEdge: 0,
        rc: { left: 0, top: 0, right: 0, bottom: 0 },
        lParam: 0n
      };

      const result = SHAppBarMessage(ABM_REMOVE, abd);
      console.log('[AppBar] ABM_REMOVE result:', result);

      this.isRegistered = false;
      this.currentEdge = null;
      this.hwndBuffer = null;

      return true;

    } catch (error) {
      return false;
    }
  }

  getLastError() {
    return this.lastError;
  }

  getIsRegistered() {
    return this.isRegistered;
  }

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
    if (!isWindows || !SHAppBarMessage) {
      console.log('[AppBar] Überspringe registerForDisplay - nicht auf Windows oder nicht initialisiert');
      return false;
    }

    const displayId = display.id;
    const { bounds, workArea } = display;

    // Erst alte Registrierung für diesen Monitor entfernen
    if (this.displayRegistrations.has(displayId)) {
      this.unregisterForDisplay(displayId);
    }

    try {
      const hwndBuffer = browserWindow.getNativeWindowHandle();
      const hwndPtr = koffi.decode(hwndBuffer, 'void*');

      const abd = {
        cbSize: appBarDataSize,
        hWnd: hwndPtr,
        uCallbackMessage: 0,
        uEdge: EDGE_MAP[edge],
        rc: { left: 0, top: 0, right: 0, bottom: 0 },
        lParam: 0n
      };

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
          abd.rc.top = workArea.y + workArea.height - size;
          abd.rc.right = bounds.x + bounds.width;
          abd.rc.bottom = workArea.y + workArea.height;
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
        rect: abd.rc
      });

      // Registrieren
      SHAppBarMessage(ABM_REMOVE, abd); // Cleanup
      const newResult = SHAppBarMessage(ABM_NEW, abd);
      if (newResult === 0) {
        console.error(`[AppBar] ABM_NEW fehlgeschlagen für Display ${displayId}`);
        return false;
      }

      SHAppBarMessage(ABM_QUERYPOS, abd);
      SHAppBarMessage(ABM_SETPOS, abd);
      SHAppBarMessage(ABM_ACTIVATE, abd);

      // In Map speichern
      this.displayRegistrations.set(displayId, {
        hwndBuffer,
        hwndPtr,
        edge,
        size
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
   */
  unregisterForDisplay(displayId) {
    if (!isWindows || !SHAppBarMessage) {
      return false;
    }

    const reg = this.displayRegistrations.get(displayId);
    if (!reg) {
      return false;
    }

    try {
      const abd = {
        cbSize: appBarDataSize,
        hWnd: reg.hwndPtr,
        uCallbackMessage: 0,
        uEdge: 0,
        rc: { left: 0, top: 0, right: 0, bottom: 0 },
        lParam: 0n
      };

      SHAppBarMessage(ABM_REMOVE, abd);

      this.displayRegistrations.delete(displayId);
      console.log(`[AppBar] Entfernt für Display ${displayId}`);
      return true;

    } catch (error) {
      console.error(`[AppBar] Fehler bei unregisterForDisplay (${displayId}):`, error.message);
      return false;
    }
  }

  /**
   * Entfernt alle AppBar-Registrierungen
   */
  unregisterAll() {
    this.displayRegistrations.forEach((reg, displayId) => {
      this.unregisterForDisplay(displayId);
    });

    if (this.isRegistered) {
      this.unregister();
    }
  }
}

const appBarManager = new AppBarManager();

module.exports = {
  initNativeAPIs,
  getInitError,
  wasInitCalled,
  appBarManager,
  isWindows,
  ABE_LEFT,
  ABE_TOP,
  ABE_RIGHT,
  ABE_BOTTOM
};
