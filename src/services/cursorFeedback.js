/**
 * Cursor Feedback - Fügt Status-Text an Cursor-Position ein
 *
 * Der Text wird direkt in die Ziel-Anwendung (Word, Browser, etc.) eingefügt:
 * - Aufnahme: "Aufnahme" wird eingefügt
 * - Verarbeitung: "Aufnahme" wird durch "Verarbeitung" ersetzt
 * - Fertig: "Verarbeitung" wird durch den diktierten Text ersetzt
 */

const { clipboard } = require('electron');
const { exec } = require('child_process');

// Status-Texte
const STATUS_RECORDING = 'Aufnahme';
const STATUS_PROCESSING = 'Verarbeitung';

// Aktueller Status und gespeicherter Clipboard-Inhalt
let currentStatus = null;
let savedClipboard = '';
let currentTextLength = 0;

/**
 * Führt Keyboard-Befehle aus (Windows PowerShell)
 */
function sendKeys(keys) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      console.log('[CursorFeedback] Nur Windows unterstützt');
      resolve(false);
      return;
    }

    const cmd = `powershell -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; ${keys}"`;

    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        console.error('[CursorFeedback] SendKeys Fehler:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Zeigt "Aufnahme" an der Cursor-Position in der Ziel-App
 */
async function showRecording() {
  console.log('[CursorFeedback] showRecording');

  // Clipboard sichern
  savedClipboard = clipboard.readText();

  // "Aufnahme" in Clipboard
  clipboard.writeText(STATUS_RECORDING);
  currentTextLength = STATUS_RECORDING.length;
  currentStatus = 'recording';

  // Alt+Tab zur vorherigen App, dann Ctrl+V zum Einfügen
  // Dann Shift+Home um Text zu selektieren (für späteres Ersetzen)
  await sendKeys(`
    [System.Windows.Forms.SendKeys]::SendWait('%{TAB}');
    Start-Sleep -Milliseconds 150;
    [System.Windows.Forms.SendKeys]::SendWait('^v');
    Start-Sleep -Milliseconds 100;
  `);

  // Text selektieren: Shift+Left für jedes Zeichen
  const selectKeys = '+{LEFT}'.repeat(currentTextLength);
  await sendKeys(`
    [System.Windows.Forms.SendKeys]::SendWait('${selectKeys}');
  `);

  console.log('[CursorFeedback] "Aufnahme" eingefügt und selektiert');
  return true;
}

/**
 * Ersetzt "Aufnahme" durch "Verarbeitung"
 */
async function showProcessing() {
  console.log('[CursorFeedback] showProcessing');

  if (currentStatus !== 'recording') {
    console.log('[CursorFeedback] Nicht im Recording-Status, überspringe');
    return false;
  }

  // "Verarbeitung" in Clipboard
  clipboard.writeText(STATUS_PROCESSING);
  currentTextLength = STATUS_PROCESSING.length;
  currentStatus = 'processing';

  // Zur Ziel-App wechseln und einfügen (ersetzt selektierten Text)
  await sendKeys(`
    [System.Windows.Forms.SendKeys]::SendWait('%{TAB}');
    Start-Sleep -Milliseconds 150;
    [System.Windows.Forms.SendKeys]::SendWait('^v');
    Start-Sleep -Milliseconds 100;
  `);

  // Text selektieren für späteres Ersetzen
  const selectKeys = '+{LEFT}'.repeat(currentTextLength);
  await sendKeys(`
    [System.Windows.Forms.SendKeys]::SendWait('${selectKeys}');
  `);

  console.log('[CursorFeedback] "Verarbeitung" eingefügt und selektiert');
  return true;
}

/**
 * Ersetzt den Status-Text durch den finalen diktierten Text
 */
async function insertFinalText(text) {
  console.log('[CursorFeedback] insertFinalText:', text?.substring(0, 50) + '...');

  if (!currentStatus) {
    console.log('[CursorFeedback] Kein aktiver Status, normales Paste');
    return false;
  }

  // Finalen Text in Clipboard
  clipboard.writeText(text);
  currentStatus = null;
  currentTextLength = 0;

  // Zur Ziel-App wechseln und einfügen (ersetzt selektierten Text)
  await sendKeys(`
    [System.Windows.Forms.SendKeys]::SendWait('%{TAB}');
    Start-Sleep -Milliseconds 150;
    [System.Windows.Forms.SendKeys]::SendWait('^v');
  `);

  // Original-Clipboard nach kurzer Verzögerung wiederherstellen
  setTimeout(() => {
    clipboard.writeText(savedClipboard);
    savedClipboard = '';
    console.log('[CursorFeedback] Clipboard wiederhergestellt');
  }, 500);

  console.log('[CursorFeedback] Finaler Text eingefügt');
  return true;
}

/**
 * Bricht ab und entfernt den Status-Text
 */
async function cancel() {
  console.log('[CursorFeedback] cancel');

  if (!currentStatus) {
    return false;
  }

  // Zur Ziel-App wechseln und selektierten Text löschen
  await sendKeys(`
    [System.Windows.Forms.SendKeys]::SendWait('%{TAB}');
    Start-Sleep -Milliseconds 150;
    [System.Windows.Forms.SendKeys]::SendWait('{DELETE}');
  `);

  // Clipboard wiederherstellen
  clipboard.writeText(savedClipboard);
  savedClipboard = '';
  currentStatus = null;
  currentTextLength = 0;

  console.log('[CursorFeedback] Abgebrochen, Text gelöscht');
  return true;
}

/**
 * Versteckt/beendet das Feedback (Alias für cancel bei Fehler)
 */
async function hide() {
  if (currentStatus) {
    return await cancel();
  }
  return false;
}

/**
 * Gibt aktuellen Status zurück
 */
function getStatus() {
  return currentStatus;
}

module.exports = {
  showRecording,
  showProcessing,
  insertFinalText,
  cancel,
  hide,
  getStatus
};
