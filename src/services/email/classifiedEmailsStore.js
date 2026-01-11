/**
 * Classified Emails Store
 *
 * Speichert klassifizierte E-Mail IDs persistent, damit bei Neuinstallation
 * oder erneutem Abruf bereits klassifizierte E-Mails nicht nochmal verarbeitet werden.
 *
 * Verwendet SQLite für Persistenz (überlebt Neuinstallation wenn DB-Datei erhalten bleibt)
 */

const path = require('path');
const { app } = require('electron');

class ClassifiedEmailsStore {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialisiert die SQLite-Datenbank
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const Database = require('better-sqlite3');

      // DB im userData Verzeichnis speichern (überlebt Updates)
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'classified-emails.db');

      console.log(`[CLASSIFIED-STORE] Initialisiere DB: ${dbPath}`);

      this.db = new Database(dbPath);

      // Tabelle erstellen falls nicht vorhanden
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS classified_emails (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          email_uid TEXT,
          message_id TEXT,
          subject TEXT,
          from_address TEXT,
          kategorie TEXT NOT NULL,
          confidence INTEGER,
          stufe INTEGER,
          classified_at TEXT NOT NULL,
          email_date TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_account_id ON classified_emails(account_id);
        CREATE INDEX IF NOT EXISTS idx_kategorie ON classified_emails(kategorie);
        CREATE INDEX IF NOT EXISTS idx_classified_at ON classified_emails(classified_at);
      `);

      this.initialized = true;

      const count = this.db.prepare('SELECT COUNT(*) as count FROM classified_emails').get();
      console.log(`[CLASSIFIED-STORE] DB initialisiert, ${count.count} E-Mails gespeichert`);

    } catch (error) {
      console.error('[CLASSIFIED-STORE] Fehler beim Initialisieren:', error);
      // Fallback: In-Memory Store
      this.inMemoryStore = new Map();
      this.initialized = true;
    }
  }

  /**
   * Generiert eine eindeutige ID für eine E-Mail
   * Kombiniert Account-ID mit UID/Message-ID
   */
  generateEmailId(email, accountId) {
    // Priorität: messageId > uid > hash aus subject+date+from
    if (email.messageId) {
      return `${accountId}:msgid:${email.messageId}`;
    }
    if (email.uid) {
      return `${accountId}:uid:${email.uid}`;
    }
    if (email.id) {
      return `${accountId}:id:${email.id}`;
    }

    // Fallback: Hash aus Subject + Date + From
    const subject = email.subject || '';
    const date = email.date ? new Date(email.date).toISOString() : '';
    const from = email.from?.address || email.from || '';
    const hash = this.simpleHash(`${subject}${date}${from}`);
    return `${accountId}:hash:${hash}`;
  }

  /**
   * Einfacher Hash für Fallback-IDs
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Prüft ob eine E-Mail bereits klassifiziert wurde
   */
  isClassified(email, accountId) {
    if (!this.initialized) return false;

    const emailId = this.generateEmailId(email, accountId);

    if (this.db) {
      const result = this.db.prepare('SELECT id FROM classified_emails WHERE id = ?').get(emailId);
      return !!result;
    }

    // Fallback: In-Memory
    return this.inMemoryStore?.has(emailId) || false;
  }

  /**
   * Speichert eine klassifizierte E-Mail
   */
  saveClassification(email, accountId, classification) {
    if (!this.initialized) return;

    const emailId = this.generateEmailId(email, accountId);

    const data = {
      id: emailId,
      account_id: accountId,
      email_uid: email.uid?.toString() || null,
      message_id: email.messageId || email.id || null,
      subject: (email.subject || '').substring(0, 500),
      from_address: email.from?.address || email.from || null,
      kategorie: classification.kategorie,
      confidence: classification.confidence || null,
      stufe: classification.stufe || null,
      classified_at: new Date().toISOString(),
      email_date: email.date ? new Date(email.date).toISOString() : null
    };

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO classified_emails
          (id, account_id, email_uid, message_id, subject, from_address, kategorie, confidence, stufe, classified_at, email_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          data.id,
          data.account_id,
          data.email_uid,
          data.message_id,
          data.subject,
          data.from_address,
          data.kategorie,
          data.confidence,
          data.stufe,
          data.classified_at,
          data.email_date
        );
      } catch (error) {
        console.error('[CLASSIFIED-STORE] Fehler beim Speichern:', error);
      }
    } else if (this.inMemoryStore) {
      this.inMemoryStore.set(emailId, data);
    }
  }

  /**
   * Holt die gespeicherte Klassifizierung einer E-Mail
   */
  getClassification(email, accountId) {
    if (!this.initialized) return null;

    const emailId = this.generateEmailId(email, accountId);

    if (this.db) {
      return this.db.prepare('SELECT * FROM classified_emails WHERE id = ?').get(emailId);
    }

    return this.inMemoryStore?.get(emailId) || null;
  }

  /**
   * Filtert bereits klassifizierte E-Mails aus einer Liste
   */
  filterUnclassified(emails, accountId) {
    if (!this.initialized || !emails || emails.length === 0) {
      return emails;
    }

    const unclassified = emails.filter(email => !this.isClassified(email, accountId));

    console.log(`[CLASSIFIED-STORE] ${emails.length} E-Mails, ${unclassified.length} unklassifiziert, ${emails.length - unclassified.length} bereits bekannt`);

    return unclassified;
  }

  /**
   * Holt alle gespeicherten Klassifizierungen für einen Account
   */
  getClassificationsForAccount(accountId) {
    if (!this.initialized || !this.db) return [];

    return this.db.prepare('SELECT * FROM classified_emails WHERE account_id = ? ORDER BY classified_at DESC').all(accountId);
  }

  /**
   * Statistiken über klassifizierte E-Mails
   */
  getStats() {
    if (!this.initialized || !this.db) {
      return { total: 0, byKategorie: {}, byAccount: {} };
    }

    const total = this.db.prepare('SELECT COUNT(*) as count FROM classified_emails').get().count;

    const byKategorie = {};
    const kategorieRows = this.db.prepare('SELECT kategorie, COUNT(*) as count FROM classified_emails GROUP BY kategorie').all();
    for (const row of kategorieRows) {
      byKategorie[row.kategorie] = row.count;
    }

    const byAccount = {};
    const accountRows = this.db.prepare('SELECT account_id, COUNT(*) as count FROM classified_emails GROUP BY account_id').all();
    for (const row of accountRows) {
      byAccount[row.account_id] = row.count;
    }

    return { total, byKategorie, byAccount };
  }

  /**
   * Löscht alle Klassifizierungen (Reset)
   */
  clearAll() {
    if (this.db) {
      this.db.exec('DELETE FROM classified_emails');
      console.log('[CLASSIFIED-STORE] Alle Klassifizierungen gelöscht');
    }
    if (this.inMemoryStore) {
      this.inMemoryStore.clear();
    }
  }

  /**
   * Löscht Klassifizierungen für einen Account
   */
  clearForAccount(accountId) {
    if (this.db) {
      this.db.prepare('DELETE FROM classified_emails WHERE account_id = ?').run(accountId);
      console.log(`[CLASSIFIED-STORE] Klassifizierungen für Account ${accountId} gelöscht`);
    }
  }

  /**
   * Löscht alte Klassifizierungen (älter als X Tage)
   */
  cleanupOld(daysToKeep = 90) {
    if (!this.db) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = this.db.prepare('DELETE FROM classified_emails WHERE email_date < ?').run(cutoffDate.toISOString());
    console.log(`[CLASSIFIED-STORE] ${result.changes} alte Klassifizierungen gelöscht`);
  }

  /**
   * Schließt die Datenbankverbindung
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

// Singleton-Instanz
const classifiedEmailsStore = new ClassifiedEmailsStore();

module.exports = classifiedEmailsStore;
