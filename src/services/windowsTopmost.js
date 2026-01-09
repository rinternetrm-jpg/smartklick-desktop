/**
 * Windows Topmost - Forciert Fenster IMMER im Vordergrund
 *
 * Verwendet SetWindowPos mit HWND_TOPMOST fuer echte Topmost-Funktionalitaet
 */

const isWindows = process.platform === 'win32';

let koffi = null;
let user32 = null;
let SetWindowPos = null;

// SetWindowPos Flags
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

/**
 * Initialisiert die Windows APIs
 */
function init() {
  if (!isWindows) {
    console.log('[Topmost] Nicht auf Windows');
    return false;
  }

  try {
    koffi = require('koffi');
    user32 = koffi.load('user32.dll');

    // SetWindowPos: Setzt Fensterposition und Z-Order
    SetWindowPos = user32.func('int SetWindowPos(uintptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)');

    console.log('[Topmost] Initialisiert');
    return true;
  } catch (error) {
    console.error('[Topmost] Fehler:', error.message);
    return false;
  }
}

/**
 * Setzt Fenster als TOPMOST (ueber allen anderen Fenstern)
 */
function setTopmost(window) {
  if (!isWindows || !SetWindowPos) {
    return false;
  }

  try {
    const hwndBuffer = window.getNativeWindowHandle();
    let hwnd;
    if (hwndBuffer.length >= 8) {
      hwnd = Number(hwndBuffer.readBigUInt64LE(0));
    } else {
      hwnd = hwndBuffer.readUInt32LE(0);
    }

    // HWND_TOPMOST (-1) = Immer ueber allen nicht-topmost Fenstern
    const result = SetWindowPos(
      hwnd,
      HWND_TOPMOST,
      0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    );

    console.log('[Topmost] SetWindowPos TOPMOST:', result ? 'OK' : 'FEHLER');
    return result !== 0;
  } catch (error) {
    console.error('[Topmost] Fehler:', error.message);
    return false;
  }
}

/**
 * Entfernt TOPMOST Status
 */
function removeTopmost(window) {
  if (!isWindows || !SetWindowPos) {
    return false;
  }

  try {
    const hwndBuffer = window.getNativeWindowHandle();
    let hwnd;
    if (hwndBuffer.length >= 8) {
      hwnd = Number(hwndBuffer.readBigUInt64LE(0));
    } else {
      hwnd = hwndBuffer.readUInt32LE(0);
    }

    const result = SetWindowPos(
      hwnd,
      HWND_NOTOPMOST,
      0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
    );

    console.log('[Topmost] SetWindowPos NOTOPMOST:', result ? 'OK' : 'FEHLER');
    return result !== 0;
  } catch (error) {
    console.error('[Topmost] Fehler:', error.message);
    return false;
  }
}

/**
 * Bringt Fenster nach vorne und setzt TOPMOST erneut
 * Sollte periodisch aufgerufen werden wenn angedockt
 */
function forceToFront(window) {
  if (!isWindows || !SetWindowPos) {
    return false;
  }

  try {
    const hwndBuffer = window.getNativeWindowHandle();
    let hwnd;
    if (hwndBuffer.length >= 8) {
      hwnd = Number(hwndBuffer.readBigUInt64LE(0));
    } else {
      hwnd = hwndBuffer.readUInt32LE(0);
    }

    // Erst NOTOPMOST, dann TOPMOST - das "resettet" die Z-Order
    SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    const result = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);

    return result !== 0;
  } catch (error) {
    return false;
  }
}

module.exports = {
  init,
  setTopmost,
  removeTopmost,
  forceToFront,
  isWindows
};
