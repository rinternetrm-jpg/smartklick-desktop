// Email Provider Manager - Handles multiple email accounts (Gmail, Outlook)
const { v4: uuidv4 } = require('uuid');
const Store = require('electron-store');

const { GmailService, createGmailService } = require('./gmailService');
const OutlookProvider = require('./outlookProvider');
const googleAuth = require('./googleAuth');

class EmailProviderManager {
  constructor(config = {}) {
    this.config = config;
    this.store = new Store({ name: 'email-accounts' });
    this.providers = new Map();  // accountId -> Provider
    this.accounts = [];
    this.gmailServices = new Map();  // accountId -> GmailService (Multi-Account)
  }

  // ==================== INITIALISIERUNG ====================

  async initialize(gmailService = null) {
    // Gespeicherte Konten laden
    this.accounts = this.store.get('accounts', []);

    // Alle Gmail-Konten von googleAuth laden
    const gmailAccounts = googleAuth.getAllAccounts();
    console.log(`[EMAIL] Found ${gmailAccounts.length} Gmail accounts in googleAuth`);

    for (const gmailAccount of gmailAccounts) {
      // Prüfe ob Account bereits in accounts-Liste
      let existingAccount = this.accounts.find(a => a.id === gmailAccount.id);

      if (!existingAccount) {
        // Neues Gmail-Konto hinzufügen
        existingAccount = {
          id: gmailAccount.id,
          name: gmailAccount.name || 'Gmail',
          email: gmailAccount.email,
          provider: 'gmail',
          isDefault: this.accounts.filter(a => a.provider === 'gmail').length === 0,
          isActive: true,
          createdAt: new Date().toISOString()
        };
        this.accounts.push(existingAccount);
        console.log(`[EMAIL] Added Gmail account: ${gmailAccount.email}`);
      } else {
        // Email/Name aktualisieren falls geändert
        existingAccount.email = gmailAccount.email;
        existingAccount.name = gmailAccount.name || existingAccount.name;
      }

      // GmailService-Instanz erstellen
      const service = createGmailService(gmailAccount.id);
      this.gmailServices.set(gmailAccount.id, service);
      this.providers.set(gmailAccount.id, service);
      console.log(`[EMAIL] Gmail provider registered: ${gmailAccount.id}`);
    }

    // Alte Gmail-Accounts entfernen die nicht mehr in googleAuth sind
    const validGmailIds = new Set(gmailAccounts.map(a => a.id));
    this.accounts = this.accounts.filter(a => {
      if (a.provider === 'gmail' && !validGmailIds.has(a.id)) {
        console.log(`[EMAIL] Removing orphaned Gmail account: ${a.email}`);
        this.providers.delete(a.id);
        this.gmailServices.delete(a.id);
        return false;
      }
      return true;
    });

    this.saveAccounts();

    // Outlook-Konten initialisieren
    for (const account of this.accounts) {
      if (account.provider === 'outlook' && account.isActive) {
        await this.initializeOutlookProvider(account);
      }
    }

    console.log(`[EMAIL] Initialized ${this.providers.size} email providers`);
  }

  // Gmail-Konten nach Verbindung aktualisieren (Multi-Account)
  refreshGmailAccounts() {
    const gmailAccounts = googleAuth.getAllAccounts();
    console.log(`[EMAIL] Refreshing ${gmailAccounts.length} Gmail accounts`);

    if (gmailAccounts.length === 0) {
      console.log('[EMAIL] No Gmail accounts connected');
      return false;
    }

    let addedCount = 0;
    let updatedCount = 0;

    for (const gmailAccount of gmailAccounts) {
      // Prüfe ob Gmail-Konto bereits existiert
      let existingAccount = this.accounts.find(a => a.id === gmailAccount.id);

      if (!existingAccount) {
        // Neues Gmail-Konto erstellen
        existingAccount = {
          id: gmailAccount.id,
          name: gmailAccount.name || 'Gmail',
          email: gmailAccount.email,
          provider: 'gmail',
          isDefault: this.accounts.filter(a => a.provider === 'gmail').length === 0,
          isActive: true,
          createdAt: new Date().toISOString()
        };
        this.accounts.push(existingAccount);
        addedCount++;
        console.log(`[EMAIL] Gmail account added: ${gmailAccount.email}`);
      } else if (existingAccount.email !== gmailAccount.email) {
        // E-Mail aktualisieren falls geändert
        existingAccount.email = gmailAccount.email;
        existingAccount.name = gmailAccount.name || existingAccount.name;
        updatedCount++;
        console.log(`[EMAIL] Gmail account updated: ${gmailAccount.email}`);
      }

      // GmailService erstellen falls noch nicht vorhanden
      if (!this.gmailServices.has(gmailAccount.id)) {
        const service = createGmailService(gmailAccount.id);
        this.gmailServices.set(gmailAccount.id, service);
        this.providers.set(gmailAccount.id, service);
        console.log(`[EMAIL] Gmail provider registered: ${gmailAccount.id}`);
      }
    }

    if (addedCount > 0 || updatedCount > 0) {
      this.saveAccounts();
    }

    console.log(`[EMAIL] Gmail refresh complete: ${addedCount} added, ${updatedCount} updated, total providers: ${this.providers.size}`);
    return true;
  }

  // Legacy-Alias für Abwärtskompatibilität
  refreshGmailAccount() {
    return this.refreshGmailAccounts();
  }

  async initializeOutlookProvider(account) {
    try {
      const credentials = this.store.get(`credentials_${account.id}`);
      if (!credentials) {
        console.error(`[EMAIL] No credentials for ${account.email}`);
        return false;
      }

      const provider = new OutlookProvider(account.id, this.config.outlook || {});

      // Credentials-Update Handler
      provider.onCredentialsUpdated = (newCreds) => {
        this.store.set(`credentials_${account.id}`, newCreds);
      };

      const success = await provider.authenticate(credentials);

      if (success) {
        this.providers.set(account.id, provider);
        this.updateLastSync(account.id);
        return true;
      } else {
        console.error(`[EMAIL] Failed to authenticate ${account.email}`);
        return false;
      }
    } catch (error) {
      console.error(`[EMAIL] Error initializing ${account.email}:`, error);
      return false;
    }
  }

  // ==================== KONTO-VERWALTUNG ====================

  async addOutlookAccount(name, email, credentials) {
    const id = `outlook-${uuidv4().substring(0, 8)}`;

    const account = {
      id,
      name: name || 'Outlook',
      email,
      provider: 'outlook',
      isDefault: this.accounts.length === 0,
      isActive: true,
      createdAt: new Date().toISOString()
    };

    // Credentials separat speichern
    this.store.set(`credentials_${id}`, credentials);

    // Provider initialisieren
    const success = await this.initializeOutlookProvider({ ...account, id });

    if (success) {
      this.accounts.push(account);
      this.saveAccounts();
      return { success: true, account };
    } else {
      this.store.delete(`credentials_${id}`);
      return { success: false, error: 'Authentication failed' };
    }
  }

  async removeAccount(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    // Gmail-Account über googleAuth entfernen
    if (account.provider === 'gmail') {
      const result = await googleAuth.removeAccount(accountId);
      if (!result.success) {
        return result;
      }
      // GmailService entfernen
      this.gmailServices.delete(accountId);
    } else {
      // Outlook: Credentials loeschen
      this.store.delete(`credentials_${accountId}`);
    }

    // Provider stoppen
    this.providers.delete(accountId);

    // Aus Liste entfernen
    this.accounts = this.accounts.filter(a => a.id !== accountId);
    this.saveAccounts();

    console.log(`[EMAIL] Account removed: ${accountId}`);
    return { success: true };
  }

  // Neues Gmail-Konto hinzufügen (startet OAuth-Flow)
  async addGmailAccount() {
    try {
      console.log('[EMAIL] Starting Gmail OAuth flow for new account...');
      const result = await googleAuth.startAuthFlow();

      if (result.success) {
        // Account-Info erstellen
        const account = {
          id: result.accountId,
          name: result.user.name || 'Gmail',
          email: result.user.email,
          provider: 'gmail',
          isDefault: this.accounts.filter(a => a.provider === 'gmail').length === 0,
          isActive: true,
          createdAt: new Date().toISOString()
        };

        // Prüfen ob schon vorhanden (re-auth)
        const existingIndex = this.accounts.findIndex(a => a.id === result.accountId);
        if (existingIndex >= 0) {
          this.accounts[existingIndex] = account;
          console.log(`[EMAIL] Gmail account re-authenticated: ${account.email}`);
        } else {
          this.accounts.push(account);
          console.log(`[EMAIL] Gmail account added: ${account.email}`);
        }

        // GmailService erstellen
        const service = createGmailService(result.accountId);
        this.gmailServices.set(result.accountId, service);
        this.providers.set(result.accountId, service);

        this.saveAccounts();

        return {
          success: true,
          account,
          isNew: result.isNew
        };
      }

      return { success: false, error: 'OAuth flow failed' };
    } catch (error) {
      console.error('[EMAIL] Gmail OAuth error:', error);
      return { success: false, error: error.message };
    }
  }

  // Alle Gmail-Konten abrufen
  getGmailAccounts() {
    return this.accounts.filter(a => a.provider === 'gmail');
  }

  setDefaultAccount(accountId) {
    this.accounts.forEach(a => {
      a.isDefault = a.id === accountId;
    });
    this.saveAccounts();
  }

  getDefaultAccount() {
    return this.accounts.find(a => a.isDefault) || this.accounts[0];
  }

  getAccountById(accountId) {
    return this.accounts.find(a => a.id === accountId);
  }

  getAccountByName(name) {
    const lower = name.toLowerCase();
    return this.accounts.find(a =>
      a.name.toLowerCase().includes(lower) ||
      a.email.toLowerCase().includes(lower) ||
      a.provider.toLowerCase().includes(lower)
    );
  }

  getAccounts() {
    return this.accounts.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      provider: a.provider,
      isDefault: a.isDefault,
      isActive: a.isActive
    }));
  }

  saveAccounts() {
    // Ohne Credentials speichern
    this.store.set('accounts', this.accounts.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      provider: a.provider,
      isDefault: a.isDefault,
      isActive: a.isActive,
      createdAt: a.createdAt
    })));
  }

  updateLastSync(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (account) {
      account.lastSync = new Date().toISOString();
      this.saveAccounts();
    }
  }

  // ==================== UNIFIED OPERATIONS ====================

  /**
   * E-Mails von allen oder einem bestimmten Konto abrufen
   * existingIds: Array von E-Mail-IDs die bereits geladen sind (für inkrementelles Laden)
   */
  async getEmails(options = {}) {
    const { accountId, accountName, unified = false, existingIds = [], ...emailOptions } = options;
    // 0 bedeutet "alle E-Mails", daher nicht mit || ersetzen
    const maxResults = emailOptions.maxResults !== undefined ? emailOptions.maxResults : 100;

    // Bestimmtes Konto nach ID?
    if (accountId) {
      const provider = this.providers.get(accountId);
      if (!provider) throw new Error('Account not found');
      const result = await provider.getRecentEmails(maxResults, existingIds);
      return this.handleIncrementalResult(result, accountId);
    }

    // Konto nach Name?
    if (accountName) {
      const account = this.getAccountByName(accountName);
      if (!account) throw new Error(`Account "${accountName}" not found`);
      const provider = this.providers.get(account.id);
      if (!provider) throw new Error('Provider not initialized');
      const result = await provider.getRecentEmails(maxResults, existingIds);
      return this.handleIncrementalResult(result, account.id);
    }

    // Unified Inbox (alle Konten)?
    if (unified) {
      return await this.getUnifiedInbox({ ...emailOptions, existingIds });
    }

    // Standard: Default Account
    const defaultAccount = this.getDefaultAccount();
    if (!defaultAccount) throw new Error('No account configured');

    const provider = this.providers.get(defaultAccount.id);
    if (!provider) throw new Error('Default provider not initialized');

    const result = await provider.getRecentEmails(maxResults, existingIds);
    return this.handleIncrementalResult(result, defaultAccount.id);
  }

  // Hilfsfunktion für inkrementelle Ergebnisse
  handleIncrementalResult(result, accountId) {
    // Wenn inkrementelles Laden, Struktur beibehalten
    if (result && result.isIncremental) {
      return {
        emails: this.addAccountInfo(result.emails, accountId),
        skipped: result.skipped,
        isIncremental: true
      };
    }
    // Normales Laden (Array)
    return this.addAccountInfo(result, accountId);
  }

  async getUnifiedInbox(options = {}) {
    // 0 bedeutet "alle E-Mails"
    const maxResults = options.maxResults !== undefined ? options.maxResults : 100;
    const existingIds = options.existingIds || [];
    const allEmails = [];
    let totalSkipped = 0;
    let isIncremental = existingIds.length > 0;

    for (const [accountId, provider] of this.providers) {
      try {
        // Bei 0 (alle) pro Provider viele abrufen, sonst aufteilen
        const perProvider = maxResults === 0 ? 500 : Math.ceil(maxResults / this.providers.size) + 5;
        const result = await provider.getRecentEmails(perProvider, existingIds);

        // Inkrementelles Ergebnis verarbeiten
        if (result && result.isIncremental) {
          allEmails.push(...this.addAccountInfo(result.emails, accountId));
          totalSkipped += result.skipped;
        } else {
          allEmails.push(...this.addAccountInfo(result, accountId));
        }
      } catch (error) {
        console.error(`[EMAIL] Error fetching from ${accountId}:`, error);
      }
    }

    // Nach Datum sortieren
    allEmails.sort((a, b) => b.date - a.date);

    // Bei inkrementellem Laden: Metadaten zurückgeben
    if (isIncremental) {
      return {
        emails: maxResults === 0 ? allEmails : allEmails.slice(0, maxResults),
        skipped: totalSkipped,
        isIncremental: true
      };
    }

    // Bei 0 alle zurückgeben, sonst limitieren
    return maxResults === 0 ? allEmails : allEmails.slice(0, maxResults);
  }

  // Progressive Loading: Lädt E-Mails in Batches und sendet sie via Callback
  async getEmailsProgressive(onBatch, batchSize = 30) {
    console.log('[EMAIL] Progressive Loading gestartet...');

    // Für jeden Provider progressive laden
    for (const [accountId, provider] of this.providers) {
      try {
        // Gmail hat eigene progressive Methode
        if (provider.getRecentEmailsProgressive) {
          await provider.getRecentEmailsProgressive(async (batchData) => {
            // Account-Info hinzufügen
            const emailsWithAccount = this.addAccountInfo(batchData.emails, accountId);

            // Callback aufrufen
            await onBatch({
              ...batchData,
              emails: emailsWithAccount,
              accountId
            });
          }, batchSize);
        } else {
          // Fallback: Alle E-Mails auf einmal laden (für andere Provider)
          const emails = await provider.getRecentEmails(0);
          const emailsWithAccount = this.addAccountInfo(emails, accountId);

          // In Batches aufteilen
          for (let i = 0; i < emailsWithAccount.length; i += batchSize) {
            const batch = emailsWithAccount.slice(i, i + batchSize);
            await onBatch({
              emails: batch,
              batchNumber: Math.floor(i / batchSize) + 1,
              totalLoaded: i + batch.length,
              totalCount: emailsWithAccount.length,
              progress: Math.round(((i + batch.length) / emailsWithAccount.length) * 100),
              isFirst: i === 0,
              isLast: i + batchSize >= emailsWithAccount.length,
              accountId
            });
          }
        }
      } catch (error) {
        console.error(`[EMAIL] Progressive loading error for ${accountId}:`, error);
      }
    }

    console.log('[EMAIL] Progressive Loading abgeschlossen');
    return { success: true };
  }

  addAccountInfo(emails, accountId) {
    const account = this.getAccountById(accountId);
    return emails.map(email => ({
      ...email,
      accountId,
      accountName: account?.name || 'Unknown',
      accountEmail: account?.email || '',
      provider: account?.provider || 'unknown'
    }));
  }

  /**
   * Ungelesene E-Mails
   */
  async getUnreadEmails(accountId = null) {
    if (accountId) {
      const provider = this.providers.get(accountId);
      if (!provider) throw new Error('Account not found');
      const emails = await provider.getUnreadEmails();
      return this.addAccountInfo(emails, accountId);
    }

    // Alle Konten
    const allEmails = [];
    for (const [id, provider] of this.providers) {
      try {
        const emails = await provider.getUnreadEmails();
        allEmails.push(...this.addAccountInfo(emails, id));
      } catch (error) {
        console.error(`[EMAIL] Unread error for ${id}:`, error);
      }
    }

    allEmails.sort((a, b) => b.date - a.date);
    return allEmails;
  }

  /**
   * E-Mails von Absender suchen
   */
  async getEmailsFromSender(senderName, accountId = null) {
    if (accountId) {
      const provider = this.providers.get(accountId);
      if (!provider) throw new Error('Account not found');
      const emails = await provider.getEmailsFromSender(senderName);
      return this.addAccountInfo(emails, accountId);
    }

    // Alle Konten durchsuchen
    const allEmails = [];
    for (const [id, provider] of this.providers) {
      try {
        const emails = await provider.getEmailsFromSender(senderName);
        allEmails.push(...this.addAccountInfo(emails, id));
      } catch (error) {
        console.error(`[EMAIL] Search error for ${id}:`, error);
      }
    }

    allEmails.sort((a, b) => b.date - a.date);
    return allEmails.slice(0, 10);
  }

  /**
   * E-Mails fuer Briefing
   */
  async getEmailsForBriefing(maxResults = 20) {
    const allEmails = [];

    for (const [id, provider] of this.providers) {
      try {
        const emails = await provider.getEmailsForBriefing(Math.ceil(maxResults / this.providers.size) + 5);
        allEmails.push(...this.addAccountInfo(emails, id));
      } catch (error) {
        console.error(`[EMAIL] Briefing error for ${id}:`, error);
      }
    }

    allEmails.sort((a, b) => b.date - a.date);
    return allEmails.slice(0, maxResults);
  }

  // ==================== E-MAIL AKTIONEN ====================

  async executeAction(emailId, accountId, action) {
    const provider = this.providers.get(accountId);
    if (!provider) throw new Error('Account not found');

    switch (action) {
      case 'markAsRead':
        return await provider.markAsRead(emailId);
      case 'markAsUnread':
        return await provider.markAsUnread?.(emailId);
      case 'star':
        return await provider.markAsStarred(emailId);
      case 'unstar':
        return await provider.unstar(emailId);
      case 'archive':
        return await provider.archiveEmail(emailId);
      case 'delete':
        return await provider.deleteEmail(emailId);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // ==================== SENDEN ====================

  async sendReply(messageId, accountId, body) {
    const provider = this.providers.get(accountId);
    if (!provider) throw new Error('Account not found');

    return await provider.replyToEmail(messageId, body);
  }

  async sendEmail(accountId, to, subject, body) {
    const provider = this.providers.get(accountId);
    if (!provider) throw new Error('Account not found');

    return await provider.sendEmail(to, subject, body);
  }

  // ==================== STATISTIKEN ====================

  async getUnreadCounts() {
    const counts = {};

    for (const account of this.accounts) {
      const provider = this.providers.get(account.id);
      if (provider) {
        try {
          const emails = await provider.getUnreadEmails(50);
          counts[account.id] = {
            id: account.id,
            name: account.name,
            email: account.email,
            provider: account.provider,
            unread: emails.length
          };
        } catch (e) {
          counts[account.id] = {
            id: account.id,
            name: account.name,
            email: account.email,
            provider: account.provider,
            unread: 0,
            error: true
          };
        }
      }
    }

    return counts;
  }
}

module.exports = EmailProviderManager;
