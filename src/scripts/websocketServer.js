// Smartklick Desktop - WebSocket Server für Chrome Extension
// Kommuniziert mit der Chrome Extension für Browser-Rechtschreibkorrektur

const WebSocket = require('ws');
const EventEmitter = require('events');

class SmartklickWebSocketServer extends EventEmitter {
  constructor(port = 9876) {
    super();
    this.port = port;
    this.wss = null;
    this.extensionClient = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('WebSocket Server läuft bereits');
      return;
    }

    try {
      this.wss = new WebSocket.Server({ port: this.port });
      this.isRunning = true;

      console.log(`WebSocket Server gestartet auf Port ${this.port}`);

      this.wss.on('connection', (ws, req) => {
        console.log('Neue WebSocket Verbindung');

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(ws, message);
          } catch (e) {
            console.error('Ungültige Nachricht:', e);
          }
        });

        ws.on('close', () => {
          if (ws === this.extensionClient) {
            this.extensionClient = null;
            this.emit('extension-disconnected');
            console.log('Chrome Extension getrennt');
          }
        });

        ws.on('error', (error) => {
          console.error('WebSocket Client Fehler:', error);
        });

        // Heartbeat
        ws.isAlive = true;
        ws.on('pong', () => {
          ws.isAlive = true;
        });
      });

      // Heartbeat Interval
      this.heartbeatInterval = setInterval(() => {
        this.wss.clients.forEach((ws) => {
          if (ws.isAlive === false) {
            return ws.terminate();
          }
          ws.isAlive = false;
          ws.ping();
        });
      }, 30000);

      this.wss.on('error', (error) => {
        console.error('WebSocket Server Fehler:', error);
        this.emit('server-error', error);
      });

    } catch (error) {
      console.error('Fehler beim Starten des WebSocket Servers:', error);
      this.isRunning = false;
    }
  }

  handleMessage(ws, message) {
    console.log('Nachricht empfangen:', message.type);

    switch (message.type) {

      case 'register':
        if (message.client === 'chrome-extension') {
          this.extensionClient = ws;
          this.emit('extension-connected', { version: message.version });
          console.log(`Chrome Extension v${message.version} verbunden`);

          // Bestätigung senden
          ws.send(JSON.stringify({
            type: 'registered',
            success: true
          }));
        }
        break;

      case 'page_content':
        // Text von Extension empfangen
        this.emit('page-content', message.content);
        break;

      case 'error_clicked':
        // User hat auf Fehler geklickt
        this.emit('error-clicked', message.errorId);
        break;

      case 'correction_applied':
        // Korrektur wurde angewendet
        this.emit('correction-applied', message.errorId);
        break;

      case 'request_analysis':
        // Extension fordert Analyse an
        this.emit('analysis-requested');
        break;

      case 'pong':
        // Heartbeat Antwort
        ws.isAlive = true;
        break;
    }
  }

  // === Befehle an Extension senden ===

  analyzePage() {
    if (!this.extensionClient) {
      console.warn('Keine Extension verbunden');
      return false;
    }

    this.extensionClient.send(JSON.stringify({
      type: 'analyze_page'
    }));

    return true;
  }

  showErrors(errors) {
    if (!this.extensionClient) {
      console.warn('Keine Extension verbunden');
      return false;
    }

    this.extensionClient.send(JSON.stringify({
      type: 'show_errors',
      errors: errors
    }));

    console.log(`${errors.length} Fehler an Extension gesendet`);
    return true;
  }

  applyCorrection(errorId, correction) {
    if (!this.extensionClient) return false;

    this.extensionClient.send(JSON.stringify({
      type: 'apply_correction',
      errorId: errorId,
      correction: correction
    }));

    return true;
  }

  clearAll() {
    if (!this.extensionClient) return false;

    this.extensionClient.send(JSON.stringify({
      type: 'clear_all'
    }));

    return true;
  }

  isExtensionConnected() {
    return this.extensionClient !== null && this.extensionClient.readyState === WebSocket.OPEN;
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.wss) {
      this.wss.close(() => {
        console.log('WebSocket Server gestoppt');
      });
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      extensionConnected: this.isExtensionConnected()
    };
  }
}

module.exports = SmartklickWebSocketServer;
