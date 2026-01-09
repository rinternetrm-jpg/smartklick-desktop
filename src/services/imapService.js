// IMAP Email Service for Smartklick Desktop
// Supports any IMAP provider (1&1, GMX, Web.de, T-Online, Outlook, etc.)

const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Common IMAP presets
const IMAP_PRESETS = {
  '1und1': {
    name: '1&1',
    host: 'imap.1und1.de',
    port: 993,
    tls: true
  },
  'gmx': {
    name: 'GMX',
    host: 'imap.gmx.net',
    port: 993,
    tls: true
  },
  'webde': {
    name: 'Web.de',
    host: 'imap.web.de',
    port: 993,
    tls: true
  },
  'tonline': {
    name: 'T-Online',
    host: 'secureimap.t-online.de',
    port: 993,
    tls: true
  },
  'outlook': {
    name: 'Outlook/Hotmail',
    host: 'outlook.office365.com',
    port: 993,
    tls: true
  },
  'yahoo': {
    name: 'Yahoo',
    host: 'imap.mail.yahoo.com',
    port: 993,
    tls: true
  },
  'ionos': {
    name: 'IONOS',
    host: 'imap.ionos.de',
    port: 993,
    tls: true
  },
  'custom': {
    name: 'Benutzerdefiniert',
    host: '',
    port: 993,
    tls: true
  }
};

class ImapService {
  constructor() {
    this.connection = null;
    this.config = null;
    this.isConnected = false;
    this.cache = {
      emails: [],
      lastFetch: null
    };
  }

  // Get available presets
  getPresets() {
    return IMAP_PRESETS;
  }

  // Configure IMAP connection
  configure(settings) {
    // settings: { provider, host, port, tls, user, password }
    const preset = IMAP_PRESETS[settings.provider] || IMAP_PRESETS.custom;

    this.config = {
      user: settings.user,
      password: settings.password,
      host: settings.host || preset.host,
      port: settings.port || preset.port,
      tls: settings.tls !== undefined ? settings.tls : preset.tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 10000
    };

    console.log('[IMAP] Configured for:', this.config.host);
    return true;
  }

  // Test connection
  async testConnection() {
    return new Promise((resolve, reject) => {
      if (!this.config) {
        reject(new Error('IMAP nicht konfiguriert'));
        return;
      }

      const imap = new Imap(this.config);

      imap.once('ready', () => {
        console.log('[IMAP] Connection test successful');
        imap.end();
        resolve({ success: true, message: 'Verbindung erfolgreich!' });
      });

      imap.once('error', (err) => {
        console.error('[IMAP] Connection test failed:', err.message);
        reject(new Error(this.translateError(err.message)));
      });

      imap.connect();
    });
  }

  // Connect to IMAP server
  async connect() {
    return new Promise((resolve, reject) => {
      if (!this.config) {
        reject(new Error('IMAP nicht konfiguriert'));
        return;
      }

      if (this.isConnected && this.connection) {
        resolve(true);
        return;
      }

      this.connection = new Imap(this.config);

      this.connection.once('ready', () => {
        console.log('[IMAP] Connected');
        this.isConnected = true;
        resolve(true);
      });

      this.connection.once('error', (err) => {
        console.error('[IMAP] Connection error:', err.message);
        this.isConnected = false;
        reject(new Error(this.translateError(err.message)));
      });

      this.connection.once('end', () => {
        console.log('[IMAP] Connection ended');
        this.isConnected = false;
      });

      this.connection.connect();
    });
  }

  // Disconnect
  disconnect() {
    if (this.connection) {
      this.connection.end();
      this.connection = null;
      this.isConnected = false;
    }
  }

  // Get recent emails
  async getEmails(folder = 'INBOX', count = 20) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.openBox(folder, true, (err, box) => {
          if (err) {
            reject(new Error('Ordner konnte nicht geöffnet werden: ' + folder));
            return;
          }

          const total = box.messages.total;
          if (total === 0) {
            resolve([]);
            return;
          }

          const start = Math.max(1, total - count + 1);
          const range = `${start}:${total}`;
          const emails = [];

          const fetch = this.connection.seq.fetch(range, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            const email = { seqno, uid: null };

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', chunk => buffer += chunk.toString('utf8'));
              stream.once('end', () => {
                if (info.which.includes('HEADER')) {
                  const headers = Imap.parseHeader(buffer);
                  email.from = headers.from ? headers.from[0] : 'Unbekannt';
                  email.to = headers.to ? headers.to[0] : '';
                  email.subject = headers.subject ? headers.subject[0] : '(Kein Betreff)';
                  email.date = headers.date ? new Date(headers.date[0]) : new Date();
                }
              });
            });

            msg.once('attributes', (attrs) => {
              email.uid = attrs.uid;
              email.flags = attrs.flags;
              email.isRead = attrs.flags.includes('\\Seen');
              email.isStarred = attrs.flags.includes('\\Flagged');
            });

            msg.once('end', () => {
              emails.push(email);
            });
          });

          fetch.once('error', (err) => {
            reject(new Error('Fehler beim Abrufen: ' + err.message));
          });

          fetch.once('end', () => {
            // Sort by date descending (newest first)
            emails.sort((a, b) => b.date - a.date);
            this.cache.emails = emails;
            this.cache.lastFetch = Date.now();
            resolve(emails);
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Get full email content by UID
  async getEmailContent(uid, folder = 'INBOX') {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.openBox(folder, true, (err, box) => {
          if (err) {
            reject(new Error('Ordner konnte nicht geöffnet werden'));
            return;
          }

          const fetch = this.connection.fetch(uid, {
            bodies: '',
            struct: true
          });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve({
                  uid: uid,
                  from: parsed.from?.text || 'Unbekannt',
                  to: parsed.to?.text || '',
                  subject: parsed.subject || '(Kein Betreff)',
                  date: parsed.date || new Date(),
                  text: parsed.text || '',
                  html: parsed.html || '',
                  attachments: (parsed.attachments || []).map(a => ({
                    filename: a.filename,
                    contentType: a.contentType,
                    size: a.size
                  }))
                });
              });
            });
          });

          fetch.once('error', (err) => {
            reject(new Error('Fehler beim Laden: ' + err.message));
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Get unread emails
  async getUnreadEmails(folder = 'INBOX') {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.openBox(folder, true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          this.connection.search(['UNSEEN'], (err, results) => {
            if (err) {
              reject(err);
              return;
            }

            if (results.length === 0) {
              resolve([]);
              return;
            }

            const emails = [];
            const fetch = this.connection.fetch(results, {
              bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
              struct: true
            });

            fetch.on('message', (msg, seqno) => {
              const email = { seqno };

              msg.on('body', (stream) => {
                let buffer = '';
                stream.on('data', chunk => buffer += chunk.toString('utf8'));
                stream.once('end', () => {
                  const headers = Imap.parseHeader(buffer);
                  email.from = headers.from ? headers.from[0] : 'Unbekannt';
                  email.subject = headers.subject ? headers.subject[0] : '(Kein Betreff)';
                  email.date = headers.date ? new Date(headers.date[0]) : new Date();
                });
              });

              msg.once('attributes', (attrs) => {
                email.uid = attrs.uid;
                email.flags = attrs.flags;
                email.isRead = false;
              });

              msg.once('end', () => emails.push(email));
            });

            fetch.once('end', () => {
              emails.sort((a, b) => b.date - a.date);
              resolve(emails);
            });

            fetch.once('error', reject);
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Mark email as read
  async markAsRead(uid, folder = 'INBOX') {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.openBox(folder, false, (err) => {
          if (err) {
            reject(err);
            return;
          }

          this.connection.addFlags(uid, ['\\Seen'], (err) => {
            if (err) reject(err);
            else resolve({ success: true });
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Mark email as starred/flagged
  async toggleStar(uid, folder = 'INBOX') {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.openBox(folder, false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          // First get current flags
          const fetch = this.connection.fetch(uid, { struct: true });

          fetch.on('message', (msg) => {
            msg.once('attributes', (attrs) => {
              const isStarred = attrs.flags.includes('\\Flagged');

              if (isStarred) {
                this.connection.delFlags(uid, ['\\Flagged'], (err) => {
                  if (err) reject(err);
                  else resolve({ success: true, starred: false });
                });
              } else {
                this.connection.addFlags(uid, ['\\Flagged'], (err) => {
                  if (err) reject(err);
                  else resolve({ success: true, starred: true });
                });
              }
            });
          });

          fetch.once('error', reject);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Delete email (move to trash)
  async deleteEmail(uid, folder = 'INBOX') {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.openBox(folder, false, (err) => {
          if (err) {
            reject(err);
            return;
          }

          this.connection.addFlags(uid, ['\\Deleted'], (err) => {
            if (err) {
              reject(err);
              return;
            }

            this.connection.expunge((err) => {
              if (err) reject(err);
              else resolve({ success: true });
            });
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Get folder list
  async getFolders() {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        this.connection.getBoxes((err, boxes) => {
          if (err) {
            reject(err);
            return;
          }

          const folders = this.flattenFolders(boxes);
          resolve(folders);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Helper: Flatten folder structure
  flattenFolders(boxes, prefix = '') {
    const folders = [];

    for (const [name, box] of Object.entries(boxes)) {
      const fullName = prefix ? `${prefix}${box.delimiter}${name}` : name;
      folders.push({
        name: name,
        path: fullName,
        delimiter: box.delimiter
      });

      if (box.children) {
        folders.push(...this.flattenFolders(box.children, fullName));
      }
    }

    return folders;
  }

  // Helper: Translate error messages to German
  translateError(message) {
    if (message.includes('Invalid credentials') || message.includes('authentication failed')) {
      return 'Ungültige Anmeldedaten. Bitte E-Mail und Passwort prüfen.';
    }
    if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      return 'Server nicht erreichbar. Bitte Serveradresse prüfen.';
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      return 'Zeitüberschreitung. Server antwortet nicht.';
    }
    if (message.includes('certificate')) {
      return 'SSL-Zertifikatsfehler. Bitte TLS-Einstellungen prüfen.';
    }
    return message;
  }

  // Get connection status
  getStatus() {
    return {
      isConnected: this.isConnected,
      isConfigured: !!this.config,
      host: this.config?.host || null,
      user: this.config?.user || null
    };
  }
}

module.exports = new ImapService();
