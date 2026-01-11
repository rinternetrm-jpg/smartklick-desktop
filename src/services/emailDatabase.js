/**
 * Email Database Service
 * Speichert E-Mails in SQLite für schnellen Zugriff und Konversations-Übersicht
 */

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db = null;

/**
 * Initialisiert die Datenbank
 */
function initDatabase() {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'emails.db');

  console.log('[EMAIL-DB] Initialisiere Datenbank:', dbPath);

  db = new Database(dbPath);

  // WAL-Modus für bessere Performance
  db.pragma('journal_mode = WAL');

  // Tabellen erstellen
  db.exec(`
    -- E-Mails Tabelle
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      uid INTEGER,
      message_id TEXT,
      thread_id TEXT,
      from_address TEXT,
      from_name TEXT,
      to_address TEXT,
      cc TEXT,
      subject TEXT,
      date TEXT,
      date_timestamp INTEGER,
      snippet TEXT,
      body_text TEXT,
      body_html TEXT,
      is_read INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0,
      is_sent INTEGER DEFAULT 0,
      kategorie TEXT,
      labels TEXT,
      attachments TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Indizes für schnelle Suche
    CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id);
    CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_address);
    CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
    CREATE INDEX IF NOT EXISTS idx_emails_kategorie ON emails(kategorie);

    -- Konversationen Tabelle (für Thread-Zuordnung)
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_email TEXT NOT NULL,
      contact_name TEXT,
      account_id TEXT NOT NULL,
      email_count INTEGER DEFAULT 0,
      first_contact TEXT,
      last_contact TEXT,
      summary TEXT,
      topics TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(contact_email, account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_email);
    CREATE INDEX IF NOT EXISTS idx_conv_account ON conversations(account_id);

    -- Import Status Tabelle (für Resume-Funktion)
    CREATE TABLE IF NOT EXISTS import_status (
      account_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'idle',
      total_count INTEGER DEFAULT 0,
      imported_count INTEGER DEFAULT 0,
      last_page_token TEXT,
      last_message_id TEXT,
      excluded_categories TEXT,
      started_at INTEGER,
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      error_message TEXT
    );

    -- Sync Settings Tabelle (für Kategorie-Filter)
    CREATE TABLE IF NOT EXISTS sync_settings (
      account_id TEXT PRIMARY KEY,
      exclude_promotions INTEGER DEFAULT 1,
      exclude_social INTEGER DEFAULT 1,
      exclude_forums INTEGER DEFAULT 1,
      exclude_updates INTEGER DEFAULT 0,
      email_limit INTEGER DEFAULT 1000,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  console.log('[EMAIL-DB] Datenbank initialisiert');

  return db;
}

/**
 * Speichert eine E-Mail in der Datenbank
 */
function saveEmail(email, accountId) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO emails (
      id, account_id, uid, message_id, thread_id,
      from_address, from_name, to_address, cc, subject,
      date, date_timestamp, snippet, body_text, body_html,
      is_read, is_starred, is_sent, kategorie, labels, attachments,
      updated_at
    ) VALUES (
      @id, @account_id, @uid, @message_id, @thread_id,
      @from_address, @from_name, @to_address, @cc, @subject,
      @date, @date_timestamp, @snippet, @body_text, @body_html,
      @is_read, @is_starred, @is_sent, @kategorie, @labels, @attachments,
      strftime('%s', 'now')
    )
  `);

  try {
    // E-Mail-Adresse aus From extrahieren
    let fromAddress = email.from || '';
    let fromName = email.fromName || '';
    if (fromAddress.includes('<')) {
      const match = fromAddress.match(/<(.+?)>/);
      if (match) {
        fromName = fromAddress.split('<')[0].trim().replace(/"/g, '');
        fromAddress = match[1];
      }
    }

    const dateTimestamp = email.date ? new Date(email.date).getTime() : Date.now();

    stmt.run({
      id: email.id,
      account_id: accountId,
      uid: email.uid || null,
      message_id: email.messageId || email.message_id || null,
      thread_id: email.threadId || email.thread_id || null,
      from_address: fromAddress.toLowerCase(),
      from_name: fromName,
      to_address: email.to || '',
      cc: email.cc || '',
      subject: email.subject || '',
      date: email.date || new Date().toISOString(),
      date_timestamp: dateTimestamp,
      snippet: email.snippet || '',
      body_text: email.body || email.text || '',
      body_html: email.html || email.bodyHtml || '',
      is_read: email.isRead || email.read ? 1 : 0,
      is_starred: email.isStarred || email.starred ? 1 : 0,
      is_sent: email.isSent ? 1 : 0,
      kategorie: email.kategorie || null,
      labels: email.labels ? JSON.stringify(email.labels) : null,
      attachments: email.attachments ? JSON.stringify(email.attachments) : null
    });

    return true;
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Speichern:', error.message);
    return false;
  }
}

/**
 * Speichert mehrere E-Mails in einer Transaktion
 */
function saveEmails(emails, accountId) {
  if (!db) initDatabase();
  if (!emails || emails.length === 0) return 0;

  const saveMany = db.transaction((emailList) => {
    let count = 0;
    for (const email of emailList) {
      if (saveEmail(email, accountId)) count++;
    }
    return count;
  });

  const saved = saveMany(emails);
  console.log(`[EMAIL-DB] ${saved}/${emails.length} E-Mails gespeichert für Account ${accountId}`);
  return saved;
}

/**
 * Holt E-Mails für eine Konversation (alle E-Mails mit diesem Kontakt)
 */
function getConversationEmails(contactEmail, accountId = null) {
  if (!db) initDatabase();

  // Email-Adresse normalisieren
  const normalizedEmail = contactEmail.toLowerCase().trim();

  // Domain extrahieren für erweiterte Suche
  const domain = normalizedEmail.split('@')[1];

  let query = `
    SELECT * FROM emails
    WHERE (
      from_address = ?
      OR from_address LIKE ?
      OR to_address LIKE ?
    )
  `;

  const params = [normalizedEmail, `%${normalizedEmail}%`, `%${normalizedEmail}%`];

  if (accountId) {
    query += ' AND account_id = ?';
    params.push(accountId);
  }

  query += ' ORDER BY date_timestamp DESC';

  try {
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    // Rows in Email-Objekte umwandeln
    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      uid: row.uid,
      messageId: row.message_id,
      threadId: row.thread_id,
      from: row.from_name ? `${row.from_name} <${row.from_address}>` : row.from_address,
      fromName: row.from_name,
      fromAddress: row.from_address,
      to: row.to_address,
      cc: row.cc,
      subject: row.subject,
      date: row.date,
      snippet: row.snippet,
      body: row.body_text,
      html: row.body_html,
      isRead: row.is_read === 1,
      isStarred: row.is_starred === 1,
      isSent: row.is_sent === 1,
      kategorie: row.kategorie,
      labels: row.labels ? JSON.parse(row.labels) : [],
      attachments: row.attachments ? JSON.parse(row.attachments) : []
    }));
  } catch (error) {
    console.error('[EMAIL-DB] Fehler bei Konversations-Abfrage:', error.message);
    return [];
  }
}

/**
 * Holt eine E-Mail nach ID
 */
function getEmailById(emailId) {
  if (!db) initDatabase();

  try {
    const stmt = db.prepare('SELECT * FROM emails WHERE id = ?');
    const row = stmt.get(emailId);

    if (!row) return null;

    return {
      id: row.id,
      accountId: row.account_id,
      uid: row.uid,
      messageId: row.message_id,
      threadId: row.thread_id,
      from: row.from_name ? `${row.from_name} <${row.from_address}>` : row.from_address,
      fromName: row.from_name,
      fromAddress: row.from_address,
      to: row.to_address,
      cc: row.cc,
      subject: row.subject,
      date: row.date,
      snippet: row.snippet,
      body: row.body_text,
      html: row.body_html,
      isRead: row.is_read === 1,
      isStarred: row.is_starred === 1,
      isSent: row.is_sent === 1,
      kategorie: row.kategorie,
      labels: row.labels ? JSON.parse(row.labels) : [],
      attachments: row.attachments ? JSON.parse(row.attachments) : []
    };
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Abrufen:', error.message);
    return null;
  }
}

/**
 * Aktualisiert die Kategorie einer E-Mail
 */
function updateEmailCategory(emailId, kategorie) {
  if (!db) initDatabase();

  try {
    const stmt = db.prepare(`
      UPDATE emails SET kategorie = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(kategorie, emailId);
    return true;
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Kategorie-Update:', error.message);
    return false;
  }
}

/**
 * Holt Statistiken für einen Kontakt
 */
function getContactStats(contactEmail, accountId = null) {
  if (!db) initDatabase();

  const normalizedEmail = contactEmail.toLowerCase().trim();

  let query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_sent = 0 THEN 1 ELSE 0 END) as received,
      SUM(CASE WHEN is_sent = 1 THEN 1 ELSE 0 END) as sent,
      MIN(date) as first_contact,
      MAX(date) as last_contact
    FROM emails
    WHERE from_address = ? OR to_address LIKE ?
  `;

  const params = [normalizedEmail, `%${normalizedEmail}%`];

  if (accountId) {
    query += ' AND account_id = ?';
    params.push(accountId);
  }

  try {
    const stmt = db.prepare(query);
    return stmt.get(...params);
  } catch (error) {
    console.error('[EMAIL-DB] Fehler bei Stats-Abfrage:', error.message);
    return null;
  }
}

/**
 * Sucht E-Mails
 */
function searchEmails(searchTerm, accountId = null, limit = 50) {
  if (!db) initDatabase();

  const term = `%${searchTerm}%`;

  let query = `
    SELECT * FROM emails
    WHERE (subject LIKE ? OR body_text LIKE ? OR from_address LIKE ? OR from_name LIKE ?)
  `;

  const params = [term, term, term, term];

  if (accountId) {
    query += ' AND account_id = ?';
    params.push(accountId);
  }

  query += ' ORDER BY date_timestamp DESC LIMIT ?';
  params.push(limit);

  try {
    const stmt = db.prepare(query);
    return stmt.all(...params);
  } catch (error) {
    console.error('[EMAIL-DB] Fehler bei Suche:', error.message);
    return [];
  }
}

/**
 * Löscht alte E-Mails (älter als X Tage)
 */
function cleanupOldEmails(daysToKeep = 90) {
  if (!db) initDatabase();

  const cutoffTimestamp = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

  try {
    const stmt = db.prepare('DELETE FROM emails WHERE date_timestamp < ?');
    const result = stmt.run(cutoffTimestamp);
    console.log(`[EMAIL-DB] ${result.changes} alte E-Mails gelöscht`);
    return result.changes;
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Cleanup:', error.message);
    return 0;
  }
}

/**
 * Gibt Datenbankstatistiken zurück
 */
function getDbStats() {
  if (!db) initDatabase();

  try {
    const totalEmails = db.prepare('SELECT COUNT(*) as count FROM emails').get();
    const accounts = db.prepare('SELECT DISTINCT account_id FROM emails').all();
    const oldestEmail = db.prepare('SELECT MIN(date) as date FROM emails').get();
    const newestEmail = db.prepare('SELECT MAX(date) as date FROM emails').get();

    return {
      totalEmails: totalEmails.count,
      accounts: accounts.length,
      oldestEmail: oldestEmail.date,
      newestEmail: newestEmail.date
    };
  } catch (error) {
    console.error('[EMAIL-DB] Fehler bei Stats:', error.message);
    return null;
  }
}

/**
 * Prüft ob eine E-Mail bereits gespeichert ist
 */
function emailExists(emailId) {
  if (!db) initDatabase();

  try {
    const stmt = db.prepare('SELECT 1 FROM emails WHERE id = ?');
    return stmt.get(emailId) !== undefined;
  } catch (error) {
    return false;
  }
}

/**
 * Indiziert alle Konversationen (einzigartige Kontakte zählen)
 */
function indexConversations(accountId = null) {
  if (!db) initDatabase();

  try {
    console.log('[EMAIL-DB] Starte Konversations-Indizierung...');

    // Alle einzigartigen Absender mit E-Mail-Anzahl
    let query = `
      SELECT
        from_address,
        from_name,
        COUNT(*) as email_count,
        MIN(date) as first_contact,
        MAX(date) as last_contact
      FROM emails
    `;

    if (accountId) {
      query += ' WHERE account_id = ?';
    }

    query += ' GROUP BY from_address ORDER BY email_count DESC';

    const stmt = db.prepare(query);
    const contacts = accountId ? stmt.all(accountId) : stmt.all();

    // Konversationen sind Kontakte mit mehr als 1 E-Mail
    const conversations = contacts.filter(c => c.email_count >= 2);

    // Update conversations table
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO conversations
        (contact_email, contact_name, account_id, email_count, first_contact, last_contact, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);

    const updateMany = db.transaction((contactList) => {
      for (const contact of contactList) {
        upsertStmt.run(
          contact.from_address,
          contact.from_name || '',
          accountId || 'all',
          contact.email_count,
          contact.first_contact,
          contact.last_contact
        );
      }
    });

    updateMany(conversations);

    console.log(`[EMAIL-DB] Indizierung abgeschlossen: ${contacts.length} Kontakte, ${conversations.length} Konversationen`);

    return {
      contacts: contacts.length,
      conversations: conversations.length
    };

  } catch (error) {
    console.error('[EMAIL-DB] Indizierung fehlgeschlagen:', error);
    return { contacts: 0, conversations: 0, error: error.message };
  }
}

/**
 * Holt alle Konversationen (für Übersicht)
 */
function getAllConversations(accountId = null, limit = 50) {
  if (!db) initDatabase();

  try {
    let query = `
      SELECT * FROM conversations
    `;

    if (accountId) {
      query += ' WHERE account_id = ?';
    }

    query += ' ORDER BY email_count DESC LIMIT ?';

    const stmt = db.prepare(query);
    return accountId ? stmt.all(accountId, limit) : stmt.all(limit);

  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Abrufen der Konversationen:', error);
    return [];
  }
}

/**
 * Schließt die Datenbank
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[EMAIL-DB] Datenbank geschlossen');
  }
}

// ========================================
// IMPORT STATUS FUNCTIONS
// ========================================

/**
 * Speichert/aktualisiert den Import-Status für einen Account
 */
function saveImportStatus(accountId, status) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO import_status (
      account_id, status, total_count, imported_count,
      last_page_token, last_message_id, excluded_categories,
      started_at, updated_at, error_message
    ) VALUES (
      @account_id, @status, @total_count, @imported_count,
      @last_page_token, @last_message_id, @excluded_categories,
      @started_at, strftime('%s', 'now'), @error_message
    )
  `);

  try {
    stmt.run({
      account_id: accountId,
      status: status.status || 'idle',
      total_count: status.totalCount || 0,
      imported_count: status.importedCount || 0,
      last_page_token: status.lastPageToken || null,
      last_message_id: status.lastMessageId || null,
      excluded_categories: status.excludedCategories ? JSON.stringify(status.excludedCategories) : null,
      started_at: status.startedAt || Date.now(),
      error_message: status.errorMessage || null
    });
    return true;
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Speichern des Import-Status:', error.message);
    return false;
  }
}

/**
 * Holt den Import-Status für einen Account
 */
function getImportStatus(accountId) {
  if (!db) initDatabase();

  try {
    const stmt = db.prepare('SELECT * FROM import_status WHERE account_id = ?');
    const row = stmt.get(accountId);

    if (!row) return null;

    return {
      accountId: row.account_id,
      status: row.status,
      totalCount: row.total_count,
      importedCount: row.imported_count,
      lastPageToken: row.last_page_token,
      lastMessageId: row.last_message_id,
      excludedCategories: row.excluded_categories ? JSON.parse(row.excluded_categories) : [],
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      errorMessage: row.error_message
    };
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Abrufen des Import-Status:', error.message);
    return null;
  }
}

/**
 * Löscht den Import-Status für einen Account
 */
function clearImportStatus(accountId) {
  if (!db) initDatabase();

  try {
    const stmt = db.prepare('DELETE FROM import_status WHERE account_id = ?');
    stmt.run(accountId);
    return true;
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Löschen des Import-Status:', error.message);
    return false;
  }
}

// ========================================
// SYNC SETTINGS FUNCTIONS
// ========================================

/**
 * Speichert die Sync-Einstellungen für einen Account
 */
function saveSyncSettings(accountId, settings) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sync_settings (
      account_id, exclude_promotions, exclude_social,
      exclude_forums, exclude_updates, email_limit, updated_at
    ) VALUES (
      @account_id, @exclude_promotions, @exclude_social,
      @exclude_forums, @exclude_updates, @email_limit, strftime('%s', 'now')
    )
  `);

  try {
    stmt.run({
      account_id: accountId,
      exclude_promotions: settings.excludePromotions ? 1 : 0,
      exclude_social: settings.excludeSocial ? 1 : 0,
      exclude_forums: settings.excludeForums ? 1 : 0,
      exclude_updates: settings.excludeUpdates ? 1 : 0,
      email_limit: settings.emailLimit || 1000
    });
    return true;
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Speichern der Sync-Einstellungen:', error.message);
    return false;
  }
}

/**
 * Holt die Sync-Einstellungen für einen Account
 */
function getSyncSettings(accountId) {
  if (!db) initDatabase();

  try {
    const stmt = db.prepare('SELECT * FROM sync_settings WHERE account_id = ?');
    const row = stmt.get(accountId);

    if (!row) {
      // Default-Einstellungen zurückgeben
      return {
        accountId: accountId,
        excludePromotions: true,
        excludeSocial: true,
        excludeForums: true,
        excludeUpdates: false,
        emailLimit: 1000
      };
    }

    return {
      accountId: row.account_id,
      excludePromotions: row.exclude_promotions === 1,
      excludeSocial: row.exclude_social === 1,
      excludeForums: row.exclude_forums === 1,
      excludeUpdates: row.exclude_updates === 1,
      emailLimit: row.email_limit
    };
  } catch (error) {
    console.error('[EMAIL-DB] Fehler beim Abrufen der Sync-Einstellungen:', error.message);
    return {
      excludePromotions: true,
      excludeSocial: true,
      excludeForums: true,
      excludeUpdates: false,
      emailLimit: 1000
    };
  }
}

/**
 * Baut den Gmail Query-String für die Kategorie-Filter
 */
function buildGmailCategoryQuery(settings) {
  const excludes = [];

  if (settings.excludePromotions) excludes.push('-category:promotions');
  if (settings.excludeSocial) excludes.push('-category:social');
  if (settings.excludeForums) excludes.push('-category:forums');
  if (settings.excludeUpdates) excludes.push('-category:updates');

  return excludes.join(' ');
}

module.exports = {
  initDatabase,
  saveEmail,
  saveEmails,
  getConversationEmails,
  getEmailById,
  updateEmailCategory,
  getContactStats,
  searchEmails,
  cleanupOldEmails,
  getDbStats,
  emailExists,
  indexConversations,
  getAllConversations,
  closeDatabase,
  // Import Status
  saveImportStatus,
  getImportStatus,
  clearImportStatus,
  // Sync Settings
  saveSyncSettings,
  getSyncSettings,
  buildGmailCategoryQuery
};
