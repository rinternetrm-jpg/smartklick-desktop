/**
 * Smartklick Multi-Monitor - Monitor Detection & Events
 * Erkennt alle Monitore und reagiert auf Änderungen (Hotplug)
 */

const { screen } = require('electron');

// Callbacks für Monitor-Änderungen
let onDisplayAddedCallback = null;
let onDisplayRemovedCallback = null;

/**
 * Gibt alle verbundenen Displays zurück
 */
function getAllDisplays() {
  return screen.getAllDisplays();
}

/**
 * Gibt das primäre Display zurück
 */
function getPrimaryDisplay() {
  return screen.getPrimaryDisplay();
}

/**
 * Gibt das Display zurück, das einen bestimmten Punkt enthält
 */
function getDisplayAtPoint(x, y) {
  return screen.getDisplayNearestPoint({ x, y });
}

/**
 * Gibt das Display zurück, auf dem ein Fenster ist
 */
function getDisplayForWindow(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return getPrimaryDisplay();
  }

  const bounds = browserWindow.getBounds();
  const centerPoint = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };

  return screen.getDisplayNearestPoint(centerPoint);
}

/**
 * Initialisiert Monitor-Event-Listener
 */
function initMonitorEvents(onAdded, onRemoved) {
  onDisplayAddedCallback = onAdded;
  onDisplayRemovedCallback = onRemoved;

  screen.on('display-added', (event, newDisplay) => {
    console.log(`[Monitors] Display hinzugefügt: ${newDisplay.id} (${newDisplay.bounds.width}x${newDisplay.bounds.height})`);
    if (onDisplayAddedCallback) {
      onDisplayAddedCallback(newDisplay);
    }
  });

  screen.on('display-removed', (event, oldDisplay) => {
    console.log(`[Monitors] Display entfernt: ${oldDisplay.id}`);
    if (onDisplayRemovedCallback) {
      onDisplayRemovedCallback(oldDisplay);
    }
  });

  // Auch auf Größenänderungen reagieren (z.B. Auflösungswechsel)
  screen.on('display-metrics-changed', (event, display, changedMetrics) => {
    console.log(`[Monitors] Display ${display.id} geändert:`, changedMetrics);
  });

  console.log(`[Monitors] Event-Listener initialisiert. ${getAllDisplays().length} Display(s) erkannt.`);
}

/**
 * Gibt Informationen über alle Displays als String zurück (für Debugging)
 */
function getDisplayInfo() {
  const displays = getAllDisplays();
  const primary = getPrimaryDisplay();

  return displays.map(d => {
    const isPrimary = d.id === primary.id;
    return `Display ${d.id}${isPrimary ? ' (Primary)' : ''}: ${d.bounds.width}x${d.bounds.height} @ (${d.bounds.x}, ${d.bounds.y})`;
  }).join('\n');
}

module.exports = {
  getAllDisplays,
  getPrimaryDisplay,
  getDisplayAtPoint,
  getDisplayForWindow,
  initMonitorEvents,
  getDisplayInfo
};
