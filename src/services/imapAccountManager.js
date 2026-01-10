// IMAP Multi-Account Manager for Smartklick Desktop
// Manages multiple IMAP email accounts with SMTP support

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

// Common IMAP presets (with SMTP info)
const IMAP_PRESETS = {
  'gmail': { name: 'Gmail', host: 'imap.gmail.com', port: 993, tls: true, oauth: true, smtp: { host: 'smtp.gmail.com', port: 587, secure: false } },
  '1und1': { name: '1&1', host: 'imap.1und1.de', port: 993, tls: true, smtp: { host: 'smtp.1und1.de', port: 587, secure: false } },
  'gmx': { name: 'GMX', host: 'imap.gmx.net', port: 993, tls: true, smtp: { host: 'mail.gmx.net', port: 587, secure: false } },
  'webde': { name: 'Web.de', host: 'imap.web.de', port: 993, tls: true, smtp: { host: 'smtp.web.de', port: 587, secure: false } },
  'tonline': { name: 'T-Online', host: 'secureimap.t-online.de', port: 993, tls: true, smtp: { host: 'securesmtp.t-online.de', port: 587, secure: false } },
  'outlook': { name: 'Outlook', host: 'outlook.office365.com', port: 993, tls: true, smtp: { host: 'smtp.office365.com', port: 587, secure: false } },
  'yahoo': { name: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993, tls: true, smtp: { host: 'smtp.mail.yahoo.com', port: 587, secure: false } },
  'ionos': { name: 'IONOS', host: 'imap.ionos.de', port: 993, tls: true, smtp: { host: 'smtp.ionos.de', port: 587, secure: false } },
  'custom': { name: 'Benutzerdefiniert', host: '', port: 993, tls: true, smtp: { host: '', port: 587, secure: false } }
};

class ImapAccountManager {
  constructor() {
    this.accounts = new Map(); // accountId -> account config
    this.connections = new Map(); // accountId -> imap connection
    this.store = null; // Will be set from main.js
  }

  // Initialize with electron-store instance
  initialize(store) {
    this.store = store;
    this.loadAccounts();
  }

  // Alias for backwards compatibility
  setStore(store) {
    this.initialize(store);
  }

  // Get presets
  getPresets() {
    return IMAP_PRESETS;
  }

  // Load accounts from store
  loadAccounts() {
    if (!this.store) return;
    const saved = this.store.get('imap_accounts') || [];
    saved.forEach(acc => {
      this.accounts.set(acc.id, acc);
    });
    console.log(`[IMAP] Loaded ${this.accounts.size} accounts`);
  }

  // Save accounts to store
  saveAccounts() {
    if (!this.store) return;
    const accounts = Array.from(this.accounts.values());
    this.store.set('imap_accounts', accounts);
  }

  // Generate unique account ID
  generateId() {
    return 'imap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Add a new account
  async addAccount(settings) {
    // Validate required fields
    if (!settings.user) {
      throw new Error('E-Mail-Adresse ist erforderlich');
    }
    if (!settings.password) {
      throw new Error('Passwort ist erforderlich');
    }

    const preset = IMAP_PRESETS[settings.provider] || IMAP_PRESETS.custom;

    const account = {
      id: this.generateId(),
      name: settings.name || (settings.user ? settings.user.split('@')[0] : 'Unbekannt'),
      email: settings.user,
      provider: settings.provider,
      host: settings.host || preset.host,
      port: settings.port || preset.port,
      tls: settings.tls !== undefined ? settings.tls : preset.tls,
      user: settings.user,
      password: settings.password,
      color: settings.color || this.getNextColor(),
      createdAt: Date.now()
    };

    // Test connection first
    try {
      await this.testConnection(account);
    } catch (error) {
      throw new Error('Verbindung fehlgeschlagen: ' + error.message);
    }

    this.accounts.set(account.id, account);
    this.saveAccounts();

    console.log(`[IMAP] Account added: ${account.email}`);
    return { success: true, account: this.getSafeAccount(account) };
  }

  // Get next color for account
  getNextColor() {
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    const usedColors = Array.from(this.accounts.values()).map(a => a.color);
    for (const color of colors) {
      if (!usedColors.includes(color)) return color;
    }
    return colors[this.accounts.size % colors.length];
  }

  // Remove account (don't expose password)
  getSafeAccount(account) {
    const { password, ...safe } = account;
    return safe;
  }

  // Get all accounts (safe)
  getAccounts() {
    return Array.from(this.accounts.values()).map(a => this.getSafeAccount(a));
  }

  // Get account by ID
  getAccount(accountId) {
    return this.accounts.get(accountId);
  }

  // Update account
  updateAccount(accountId, updates) {
    const account = this.accounts.get(accountId);
    if (!account) {
      return { success: false, error: 'Konto nicht gefunden' };
    }

    // Update allowed fields
    if (updates.name) account.name = updates.name;
    if (updates.color) account.color = updates.color;
    if (updates.password) account.password = updates.password;

    this.accounts.set(accountId, account);
    this.saveAccounts();

    return { success: true, account: this.getSafeAccount(account) };
  }

  // Remove account
  removeAccount(accountId) {
    if (!this.accounts.has(accountId)) {
      return { success: false, error: 'Konto nicht gefunden' };
    }

    // Disconnect if connected
    this.disconnect(accountId);

    this.accounts.delete(accountId);
    this.saveAccounts();

    console.log(`[IMAP] Account removed: ${accountId}`);
    return { success: true };
  }

  // Test connection
  async testConnection(accountOrSettings) {
    return new Promise((resolve, reject) => {
      const config = {
        user: accountOrSettings.user,
        password: accountOrSettings.password,
        host: accountOrSettings.host,
        port: accountOrSettings.port,
        tls: accountOrSettings.tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      };

      const imap = new Imap(config);

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

  // Get or create connection for account
  async getConnection(accountId, forceReconnect = false) {
    // Check existing connection - allow 'authenticated' or 'selected' states
    let conn = this.connections.get(accountId);
    if (!forceReconnect && conn && (conn.state === 'authenticated' || conn.state === 'selected')) {
      return conn;
    }

    // Close existing broken connection
    if (conn) {
      try { conn.end(); } catch (e) {}
      this.connections.delete(accountId);
    }

    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error('Konto nicht gefunden');
    }

    console.log(`[IMAP] Connecting to ${account.email}...`);

    return new Promise((resolve, reject) => {
      const config = {
        user: account.user,
        password: account.password,
        host: account.host,
        port: account.port,
        tls: account.tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 15000,
        authTimeout: 15000,
        keepalive: true
      };

      const imap = new Imap(config);

      imap.once('ready', () => {
        console.log(`[IMAP] Connected: ${account.email}`);
        this.connections.set(accountId, imap);
        resolve(imap);
      });

      imap.once('error', (err) => {
        console.error(`[IMAP] Connection error (${account.email}):`, err.message);
        this.connections.delete(accountId);
        reject(new Error(this.translateError(err.message)));
      });

      imap.once('end', () => {
        console.log(`[IMAP] Connection ended: ${account.email}`);
        this.connections.delete(accountId);
      });

      imap.once('close', (hadError) => {
        console.log(`[IMAP] Connection closed (${account.email}), hadError: ${hadError}`);
        this.connections.delete(accountId);
      });

      imap.connect();
    });
  }

  // Disconnect account
  disconnect(accountId) {
    const conn = this.connections.get(accountId);
    if (conn) {
      try {
        conn.end();
      } catch (e) {}
      this.connections.delete(accountId);
    }
  }

  // Disconnect all
  disconnectAll() {
    for (const [id, conn] of this.connections) {
      try {
        conn.end();
      } catch (e) {}
    }
    this.connections.clear();
  }

  // Get folders for account
  async getFolders(accountId) {
    try {
      const imap = await this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        imap.getBoxes((err, boxes) => {
          if (err) {
            reject(err);
            return;
          }
          const folders = this.flattenFolders(boxes);
          resolve({ success: true, folders });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get standard folders (mapped to actual server names)
  async getStandardFolders(accountId) {
    try {
      const result = await this.getFolders(accountId);
      const folders = result.success ? result.folders : [];

      // Map standard types to actual folder paths
      const standardFolders = {
        inbox: 'INBOX',
        sent: null,
        drafts: null,
        trash: null,
        spam: null,
        archive: null
      };

      for (const folder of folders) {
        if (folder.type !== 'folder' && !standardFolders[folder.type]) {
          standardFolders[folder.type] = folder.path;
        }
      }

      return standardFolders;
    } catch (error) {
      return { inbox: 'INBOX', sent: null, drafts: null, trash: null };
    }
  }

  // Flatten folder structure
  flattenFolders(boxes, prefix = '') {
    const folders = [];

    for (const [name, box] of Object.entries(boxes)) {
      const fullName = prefix ? `${prefix}${box.delimiter}${name}` : name;

      // Determine folder type
      let type = 'folder';
      const lowerName = name.toLowerCase();
      const fullLower = fullName.toLowerCase();

      if (lowerName === 'inbox') type = 'inbox';
      else if (lowerName.includes('sent') || lowerName.includes('gesendet') || fullLower.includes('sent')) type = 'sent';
      else if (lowerName.includes('draft') || lowerName.includes('entwurf') || lowerName.includes('entwürfe')) type = 'drafts';
      else if (lowerName.includes('trash') || lowerName.includes('papierkorb') || lowerName.includes('deleted') || lowerName.includes('gelöscht')) type = 'trash';
      else if (lowerName.includes('spam') || lowerName.includes('junk')) type = 'spam';
      else if (lowerName.includes('archive') || lowerName.includes('archiv')) type = 'archive';

      folders.push({
        name: name,
        path: fullName,
        type: type,
        delimiter: box.delimiter
      });

      if (box.children) {
        folders.push(...this.flattenFolders(box.children, fullName));
      }
    }

    // Sort: standard folders first
    folders.sort((a, b) => {
      const order = { inbox: 0, sent: 1, drafts: 2, archive: 3, spam: 4, trash: 5, folder: 6 };
      return (order[a.type] || 6) - (order[b.type] || 6);
    });

    return folders;
  }

  // Get emails from account
  async getEmails(accountId, folder = 'INBOX', count = 500) {
    try {
      const imap = await this.getConnection(accountId);
      const account = this.accounts.get(accountId);

      console.log(`[IMAP] Loading emails from folder: "${folder}" for account: ${account.email}`);

      return new Promise((resolve, reject) => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            console.error(`[IMAP] Failed to open folder "${folder}":`, err.message);
            reject(new Error('Ordner konnte nicht geöffnet werden: ' + folder));
            return;
          }

          console.log(`[IMAP] Folder "${folder}" opened: ${box.messages.total} messages, uidvalidity: ${box.uidvalidity}`);

          const total = box.messages.total;
          if (total === 0) {
            resolve([]);
            return;
          }

          const start = Math.max(1, total - count + 1);
          const range = `${start}:${total}`;
          const emails = [];

          const fetch = imap.seq.fetch(range, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            const email = {
              seqno,
              uid: null,
              accountId: accountId,
              accountEmail: account.email,
              accountColor: account.color,
              folder: folder
            };

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
              // Ensure UID is stored as number
              email.uid = attrs.uid ? parseInt(attrs.uid, 10) : null;
              email.flags = attrs.flags || [];
              email.isRead = email.flags.includes('\\Seen');
              email.isStarred = email.flags.includes('\\Flagged');

              // Check for attachments in BODYSTRUCTURE
              email.hasAttachments = this.checkForAttachments(attrs.struct);

              // Debug: log if UID is missing
              if (!email.uid) {
                console.warn(`[IMAP] Warning: No UID for seqno ${email.seqno}, using seqno as fallback`);
                email.uid = email.seqno;
              }
            });

            msg.once('end', () => {
              emails.push(email);
            });
          });

          fetch.once('error', (err) => {
            reject(new Error('Fehler beim Abrufen: ' + err.message));
          });

          fetch.once('end', () => {
            // Sort by date descending
            emails.sort((a, b) => new Date(b.date) - new Date(a.date));
            const uidList = emails.slice(0, 10).map(e => e.uid).join(', ');
            console.log(`[IMAP] Loaded ${emails.length} emails from "${folder}" (uidvalidity: ${box.uidvalidity}). First 10 UIDs: ${uidList}`);
            resolve(emails);
          });
        });
      });
    } catch (error) {
      console.error(`[IMAP] getEmails error:`, error);
      throw error;
    }
  }

  // Get email content with retry logic
  async getEmailContent(accountId, uid, folder = 'INBOX', retry = true) {
    try {
      const imap = await this.getConnection(accountId);
      const uidNum = parseInt(uid, 10);

      console.log(`[IMAP] getEmailContent: uid=${uidNum}, folder=${folder}`);

      return new Promise((resolve, reject) => {
        let resolved = false;
        let messageFound = false;

        imap.openBox(folder, true, (err, box) => {
          if (err) {
            if (retry) {
              console.log(`[IMAP] Box open failed, retrying with new connection...`);
              this.getConnection(accountId, true).then(() => {
                this.getEmailContent(accountId, uid, folder, false)
                  .then(resolve)
                  .catch(reject);
              }).catch(reject);
              return;
            }
            reject(new Error('Ordner konnte nicht geöffnet werden: ' + err.message));
            return;
          }

          console.log(`[IMAP] Box opened: ${folder}, total=${box.messages.total}, uidvalidity=${box.uidvalidity}`);

          // Use UID range string format for explicit UID fetch
          const uidRange = `${uidNum}:${uidNum}`;
          console.log(`[IMAP] Fetching UID range: ${uidRange}`);

          const fetch = imap.fetch(uidRange, {
            bodies: '',  // Nur komplette Nachricht, nicht doppelt
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            messageFound = true;
            console.log(`[IMAP] Message found at seqno ${seqno}`);

            let buffer = '';

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('end', () => {
              if (!resolved) {
                resolved = true;
                // Parse with simpleParser
                simpleParser(buffer, (parseErr, parsed) => {
                  if (parseErr) {
                    console.error(`[IMAP] Parse error:`, parseErr);
                    // Return raw content as fallback
                    resolve({
                      uid: uidNum,
                      from: 'Parse-Fehler',
                      to: '',
                      subject: '(Fehler beim Parsen)',
                      date: new Date(),
                      text: buffer.substring(0, 5000),
                      html: '',
                      attachments: []
                    });
                    return;
                  }

                  console.log(`[IMAP] Successfully parsed email UID ${uidNum}`);
                  // Debug: Log attachment info from parser
                  console.log(`[IMAP] Parser returned ${parsed.attachments?.length || 0} attachments`);
                  if (parsed.attachments && parsed.attachments.length > 0) {
                    parsed.attachments.forEach((att, i) => {
                      console.log(`[IMAP] Attachment ${i+1}: filename=${att.filename}, type=${att.contentType}, size=${att.size}, hasContent=${!!att.content}, contentLen=${att.content?.length || 0}, cid=${att.contentId || 'none'}`);
                    });
                  }
                  resolve({
                    uid: uidNum,
                    from: parsed.from?.text || 'Unbekannt',
                    to: parsed.to?.text || '',
                    subject: parsed.subject || '(Kein Betreff)',
                    date: parsed.date || new Date(),
                    text: parsed.text || '',
                    html: parsed.html || '',
                    attachments: (parsed.attachments || []).map(a => ({
                      filename: a.filename || 'attachment',
                      contentType: a.contentType || 'application/octet-stream',
                      size: a.size || 0,
                      content: a.content ? a.content.toString('base64') : null,
                      contentId: a.contentId || null
                    }))
                  });
                });
              }
            });
          });

          fetch.once('error', (fetchErr) => {
            console.error(`[IMAP] Fetch error:`, fetchErr);
            if (!resolved) {
              resolved = true;
              if (retry) {
                console.log(`[IMAP] Retrying with new connection...`);
                this.getConnection(accountId, true).then(() => {
                  this.getEmailContent(accountId, uid, folder, false)
                    .then(resolve)
                    .catch(reject);
                }).catch(reject);
              } else {
                reject(new Error('Fehler beim Laden: ' + fetchErr.message));
              }
            }
          });

          fetch.once('end', () => {
            console.log(`[IMAP] Fetch ended, messageFound=${messageFound}`);
            if (!resolved && !messageFound) {
              resolved = true;
              // Try to get message by sequence number as fallback
              console.log(`[IMAP] UID ${uidNum} not found, trying sequence number fallback...`);

              // Get total messages and calculate likely sequence number
              const total = box.messages.total;
              if (total > 0) {
                // Try fetching the last few messages to find the right one
                const start = Math.max(1, total - 50);
                imap.seq.fetch(`${start}:${total}`, {
                  bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
                  struct: true
                }).on('message', (msg, seqno) => {
                  msg.once('attributes', (attrs) => {
                    if (attrs.uid === uidNum) {
                      console.log(`[IMAP] Found UID ${uidNum} at seqno ${seqno}, refetching...`);
                      // Found it! Fetch full content
                      imap.seq.fetch(seqno, { bodies: '' }).on('message', (msg2) => {
                        let buf = '';
                        msg2.on('body', (stream) => {
                          stream.on('data', (chunk) => buf += chunk.toString('utf8'));
                        });
                        msg2.once('end', () => {
                          simpleParser(buf, (e, p) => {
                            resolve({
                              uid: uidNum,
                              from: p?.from?.text || 'Unbekannt',
                              to: p?.to?.text || '',
                              subject: p?.subject || '(Kein Betreff)',
                              date: p?.date || new Date(),
                              text: p?.text || '',
                              html: p?.html || '',
                              attachments: (p?.attachments || []).map(a => ({
                                filename: a.filename || 'attachment',
                                contentType: a.contentType || 'application/octet-stream',
                                size: a.size || 0,
                                content: a.content ? a.content.toString('base64') : null,
                                contentId: a.contentId || null
                              }))
                            });
                          });
                        });
                      });
                    }
                  });
                }).once('end', () => {
                  if (!resolved) {
                    reject(new Error(`E-Mail nicht gefunden (UID: ${uidNum}, Ordner: ${folder})`));
                  }
                });
              } else {
                reject(new Error(`Ordner ${folder} ist leer`));
              }
            }
          });
        });
      });
    } catch (error) {
      console.error(`[IMAP] getEmailContent error:`, error);
      throw error;
    }
  }

  // Mark email as read
  async markAsRead(accountId, uid, folder = 'INBOX') {
    try {
      const imap = await this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        imap.openBox(folder, false, (err) => {
          if (err) {
            reject(err);
            return;
          }

          imap.addFlags(uid, ['\\Seen'], (err) => {
            if (err) reject(err);
            else resolve({ success: true });
          });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Toggle star
  async toggleStar(accountId, uid, folder = 'INBOX') {
    try {
      const imap = await this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        imap.openBox(folder, false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          const fetch = imap.fetch(uid, { struct: true });

          fetch.on('message', (msg) => {
            msg.once('attributes', (attrs) => {
              const isStarred = attrs.flags.includes('\\Flagged');

              if (isStarred) {
                imap.delFlags(uid, ['\\Flagged'], (err) => {
                  if (err) reject(err);
                  else resolve({ success: true, starred: false });
                });
              } else {
                imap.addFlags(uid, ['\\Flagged'], (err) => {
                  if (err) reject(err);
                  else resolve({ success: true, starred: true });
                });
              }
            });
          });

          fetch.once('error', reject);
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Delete email
  async deleteEmail(accountId, uid, folder = 'INBOX') {
    try {
      const imap = await this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        imap.openBox(folder, false, (err) => {
          if (err) {
            reject(err);
            return;
          }

          imap.addFlags(uid, ['\\Deleted'], (err) => {
            if (err) {
              reject(err);
              return;
            }

            imap.expunge((err) => {
              if (err) reject(err);
              else resolve({ success: true });
            });
          });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Move email to folder
  async moveEmail(accountId, uid, fromFolder, toFolder) {
    try {
      const imap = await this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        imap.openBox(fromFolder, false, (err) => {
          if (err) {
            reject(err);
            return;
          }

          imap.move(uid, toFolder, (err) => {
            if (err) reject(err);
            else resolve({ success: true });
          });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get unread count for account
  async getUnreadCount(accountId, folder = 'INBOX') {
    try {
      const imap = await this.getConnection(accountId);

      return new Promise((resolve, reject) => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }

          imap.search(['UNSEEN'], (err, results) => {
            if (err) {
              reject(err);
              return;
            }
            resolve({ success: true, count: results.length });
          });
        });
      });
    } catch (error) {
      return { success: false, count: 0, error: error.message };
    }
  }

  // Get all unread counts
  async getAllUnreadCounts() {
    const counts = {};
    for (const [id, account] of this.accounts) {
      try {
        const result = await this.getUnreadCount(id);
        counts[id] = result.count || 0;
      } catch (e) {
        counts[id] = 0;
      }
    }
    return counts;
  }

  // Translate error messages
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

  // =============================================================================
  // SMTP SENDING
  // =============================================================================

  // Send an email via SMTP
  async sendEmail(accountId, { to, cc, subject, body, html, attachments }) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden');
    }

    // Get SMTP settings from preset
    const preset = IMAP_PRESETS[account.provider] || IMAP_PRESETS.custom;
    const smtpConfig = preset.smtp || { host: '', port: 587, secure: false };

    // For custom provider, try to derive SMTP from IMAP host
    let smtpHost = smtpConfig.host;
    if (!smtpHost && account.host) {
      smtpHost = account.host.replace('imap.', 'smtp.');
    }

    if (!smtpHost) {
      throw new Error('SMTP-Server konnte nicht ermittelt werden');
    }

    console.log(`[SMTP] Sending email from ${account.email} to ${to}`);

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpConfig.port || 587,
      secure: smtpConfig.secure || false,
      auth: {
        user: account.user,
        pass: account.password
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Build message
    const mailOptions = {
      from: `${account.name} <${account.email}>`,
      to: to,
      subject: subject,
      text: body
    };

    if (cc) {
      mailOptions.cc = cc;
    }

    if (html) {
      mailOptions.html = html;
    }

    // Add attachments - use base64 string with encoding parameter
    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(att => {
        console.log(`[SMTP] Adding attachment: ${att.filename}, base64 length: ${att.content.length}, type: ${att.contentType}`);

        return {
          filename: att.filename,
          content: att.content,  // Keep as base64 string
          encoding: 'base64',    // Tell nodemailer it's base64
          contentType: att.contentType || 'application/octet-stream'
        };
      });
      console.log(`[SMTP] Total attachments: ${mailOptions.attachments.length}`);
    }

    // Send
    try {
      // Log the full mailOptions structure (without content to avoid huge logs)
      console.log(`[SMTP] Sending with mailOptions:`, {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        hasText: !!mailOptions.text,
        hasHtml: !!mailOptions.html,
        attachments: mailOptions.attachments ? mailOptions.attachments.map(a => ({
          filename: a.filename,
          encoding: a.encoding,
          contentType: a.contentType,
          contentLength: a.content?.length || 0
        })) : 'none'
      });

      const info = await transporter.sendMail(mailOptions);
      console.log(`[SMTP] Email sent successfully!`);
      console.log(`[SMTP] MessageId: ${info.messageId}`);
      console.log(`[SMTP] Response: ${info.response}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`[SMTP] Send error:`, error);
      throw new Error(this.formatError(error.message));
    }
  }

  // Reply to an email
  async replyToEmail(accountId, originalEmail, replyBody) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden');
    }

    // Extract reply-to address
    const replyTo = originalEmail.replyTo || originalEmail.from;

    // Build subject with Re: prefix
    let subject = originalEmail.subject || '';
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = 'Re: ' + subject;
    }

    return this.sendEmail(accountId, {
      to: replyTo,
      subject: subject,
      body: replyBody
    });
  }

  // Check BODYSTRUCTURE for attachments
  checkForAttachments(struct) {
    if (!struct) return false;

    const check = (parts) => {
      if (!parts) return false;

      for (const part of parts) {
        // If it's an array, it's a multipart - recurse
        if (Array.isArray(part)) {
          if (check(part)) return true;
          continue;
        }

        // Check if it's an object with disposition
        if (part && typeof part === 'object') {
          // Check disposition for 'attachment'
          if (part.disposition && part.disposition.type) {
            const dispType = part.disposition.type.toLowerCase();
            if (dispType === 'attachment') return true;
          }

          // Also check for common attachment types without disposition
          if (part.type && part.subtype) {
            const type = part.type.toLowerCase();
            const subtype = part.subtype.toLowerCase();
            // PDF, Office docs, archives, etc. are usually attachments
            if (type === 'application' &&
                ['pdf', 'msword', 'vnd.ms-excel', 'zip', 'x-zip-compressed', 'octet-stream'].some(s => subtype.includes(s))) {
              return true;
            }
            // Images with filenames are usually attachments
            if (type === 'image' && part.disposition?.params?.filename) {
              return true;
            }
          }
        }
      }
      return false;
    };

    return check(struct);
  }
}

module.exports = new ImapAccountManager();
