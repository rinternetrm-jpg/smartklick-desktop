// Google OAuth Service for Smartklick Desktop - Multi-Account Support
const { google } = require('googleapis');
const Store = require('electron-store');
const { shell } = require('electron');
const http = require('http');
const url = require('url');

// Token Store - jetzt mit Multi-Account Support
const tokenStore = new Store({
  name: 'google-tokens-v2',
  encryptionKey: 'smartklick-secure-key-2024'
});

// OAuth Credentials (Desktop App)
const CLIENT_ID = '742253337860-f3r5on61f3egk6t1vj13p7lpvtcjggfk.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:8089/oauth2callback';

// Scopes for Calendar and Gmail
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

class GoogleAuthService {
  constructor() {
    // Map von accountId -> { oauth2Client, userInfo, isAuthenticated }
    this.accounts = new Map();
    this.activeAccountId = null;
    this.loadAllAccounts();
  }

  // Lade alle gespeicherten Accounts
  loadAllAccounts() {
    const savedAccounts = tokenStore.get('accounts', []);
    console.log(`[GoogleAuth] Loading ${savedAccounts.length} saved accounts`);

    for (const accountData of savedAccounts) {
      try {
        const oauth2Client = this.createOAuth2Client();

        if (accountData.refreshToken) {
          oauth2Client.setCredentials({
            access_token: accountData.accessToken,
            refresh_token: accountData.refreshToken,
            expiry_date: accountData.expiryDate
          });

          this.accounts.set(accountData.id, {
            oauth2Client,
            userInfo: accountData.userInfo,
            isAuthenticated: true
          });

          // Ersten Account als aktiv setzen
          if (!this.activeAccountId) {
            this.activeAccountId = accountData.id;
          }

          console.log(`[GoogleAuth] Loaded account: ${accountData.userInfo?.email}`);
        }
      } catch (error) {
        console.error(`[GoogleAuth] Error loading account ${accountData.id}:`, error);
      }
    }
  }

  // Erstelle neuen OAuth2Client
  createOAuth2Client() {
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    // Token refresh event - speichere aktualisierte Tokens
    oauth2Client.on('tokens', (tokens) => {
      console.log('[GoogleAuth] Tokens refreshed');
      this.saveAllAccounts();
    });

    return oauth2Client;
  }

  // Speichere alle Accounts
  saveAllAccounts() {
    const accountsData = [];

    for (const [id, account] of this.accounts) {
      const credentials = account.oauth2Client.credentials;
      accountsData.push({
        id,
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token,
        expiryDate: credentials.expiry_date,
        userInfo: account.userInfo
      });
    }

    tokenStore.set('accounts', accountsData);
    console.log(`[GoogleAuth] Saved ${accountsData.length} accounts`);
  }

  // Generiere Account-ID aus Email
  generateAccountId(email) {
    return `gmail-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  }

  // Auth URL mit Account-Auswahl
  getAuthUrl() {
    const tempClient = this.createOAuth2Client();
    return tempClient.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'select_account consent'  // Konto-Auswahl + Consent für Refresh Token
    });
  }

  // Starte OAuth Flow für neues Konto
  async startAuthFlow() {
    return new Promise((resolve, reject) => {
      const tempClient = this.createOAuth2Client();

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url, true);

          if (reqUrl.pathname === '/oauth2callback') {
            const code = reqUrl.query.code;

            if (code) {
              // Exchange code for tokens
              const { tokens } = await tempClient.getToken(code);
              tempClient.setCredentials(tokens);

              // Get user info
              const oauth2 = google.oauth2({ version: 'v2', auth: tempClient });
              const { data } = await oauth2.userinfo.get();

              const userInfo = {
                email: data.email,
                name: data.name,
                picture: data.picture
              };

              const accountId = this.generateAccountId(data.email);

              // Prüfe ob Account bereits existiert
              if (this.accounts.has(accountId)) {
                // Update existing account
                const existing = this.accounts.get(accountId);
                existing.oauth2Client.setCredentials(tokens);
                existing.userInfo = userInfo;
                existing.isAuthenticated = true;
                console.log(`[GoogleAuth] Updated existing account: ${data.email}`);
              } else {
                // Add new account
                this.accounts.set(accountId, {
                  oauth2Client: tempClient,
                  userInfo,
                  isAuthenticated: true
                });
                console.log(`[GoogleAuth] Added new account: ${data.email}`);
              }

              // Als aktiv setzen
              this.activeAccountId = accountId;

              // Speichern
              this.saveAllAccounts();

              // Success page
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                <head>
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                           display: flex; justify-content: center; align-items: center;
                           height: 100vh; margin: 0; background: #1a1a1a; color: white; }
                    .container { text-align: center; }
                    .success { color: #22c55e; font-size: 48px; }
                    h1 { margin: 20px 0 10px; }
                    p { color: #888; }
                    .email { color: #60a5fa; font-size: 18px; margin-top: 10px; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="success">✓</div>
                    <h1>Gmail verbunden!</h1>
                    <p class="email">${data.email}</p>
                    <p>Du kannst dieses Fenster jetzt schließen.</p>
                  </div>
                </body>
                </html>
              `);

              server.close();
              resolve({
                success: true,
                accountId,
                user: userInfo,
                isNew: !this.accounts.has(accountId)
              });
            } else {
              res.writeHead(400);
              res.end('No code received');
              server.close();
              reject(new Error('No authorization code received'));
            }
          }
        } catch (error) {
          console.error('[GoogleAuth] OAuth callback error:', error);
          res.writeHead(500);
          res.end('Authentication failed');
          server.close();
          reject(error);
        }
      });

      server.listen(8089, () => {
        console.log('[GoogleAuth] OAuth callback server listening on port 8089');
        const authUrl = this.getAuthUrl();
        shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout'));
      }, 300000);
    });
  }

  // Hole OAuth Client für Account
  getClient(accountId = null) {
    const id = accountId || this.activeAccountId;
    if (!id) return null;

    const account = this.accounts.get(id);
    return account?.oauth2Client || null;
  }

  // Hole User Info für Account
  getUserInfo(accountId = null) {
    const id = accountId || this.activeAccountId;
    if (!id) return null;

    const account = this.accounts.get(id);
    return account?.userInfo || null;
  }

  // Ist Account verbunden?
  isConnected(accountId = null) {
    const id = accountId || this.activeAccountId;
    if (!id) return this.accounts.size > 0;

    const account = this.accounts.get(id);
    return account?.isAuthenticated || false;
  }

  // Hat mindestens ein Gmail-Konto?
  hasAnyAccount() {
    return this.accounts.size > 0;
  }

  // Hole alle verbundenen Accounts
  getAllAccounts() {
    const accounts = [];
    for (const [id, account] of this.accounts) {
      accounts.push({
        id,
        email: account.userInfo?.email,
        name: account.userInfo?.name,
        picture: account.userInfo?.picture,
        isActive: id === this.activeAccountId
      });
    }
    return accounts;
  }

  // Setze aktiven Account
  setActiveAccount(accountId) {
    if (this.accounts.has(accountId)) {
      this.activeAccountId = accountId;
      console.log(`[GoogleAuth] Active account set to: ${accountId}`);
      return true;
    }
    return false;
  }

  // Entferne Account
  async removeAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }

    try {
      // Revoke token
      const token = account.oauth2Client.credentials.access_token;
      if (token) {
        await account.oauth2Client.revokeToken(token);
      }
    } catch (error) {
      console.log('[GoogleAuth] Token revoke failed:', error.message);
    }

    this.accounts.delete(accountId);

    // Neuen aktiven Account setzen
    if (this.activeAccountId === accountId) {
      const remaining = Array.from(this.accounts.keys());
      this.activeAccountId = remaining.length > 0 ? remaining[0] : null;
    }

    this.saveAllAccounts();
    console.log(`[GoogleAuth] Removed account: ${accountId}`);

    return { success: true };
  }

  // Legacy: Disconnect (entfernt alle Accounts)
  async disconnect() {
    for (const accountId of this.accounts.keys()) {
      await this.removeAccount(accountId);
    }
    tokenStore.clear();
    return { success: true };
  }

  // Check if credentials are configured
  isConfigured() {
    return CLIENT_ID && CLIENT_SECRET && CLIENT_ID.length > 10;
  }

  // Migration: Lade alte Single-Account Tokens
  migrateFromOldStore() {
    const oldStore = new Store({
      name: 'google-tokens',
      encryptionKey: 'smartklick-secure-key-2024'
    });

    const oldRefreshToken = oldStore.get('refresh_token');
    const oldUserInfo = oldStore.get('user_info');

    if (oldRefreshToken && oldUserInfo?.email) {
      console.log('[GoogleAuth] Migrating old account:', oldUserInfo.email);

      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({
        access_token: oldStore.get('access_token'),
        refresh_token: oldRefreshToken,
        expiry_date: oldStore.get('expiry_date')
      });

      const accountId = this.generateAccountId(oldUserInfo.email);

      if (!this.accounts.has(accountId)) {
        this.accounts.set(accountId, {
          oauth2Client,
          userInfo: oldUserInfo,
          isAuthenticated: true
        });
        this.activeAccountId = accountId;
        this.saveAllAccounts();

        console.log('[GoogleAuth] Migration complete');
      }

      // Alte Daten löschen
      oldStore.clear();
    }
  }
}

// Singleton instance
const googleAuth = new GoogleAuthService();

// Migration beim Start
googleAuth.migrateFromOldStore();

module.exports = googleAuth;
