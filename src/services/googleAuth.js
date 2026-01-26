// Google OAuth Service for Smartklick Desktop
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const Store = require('electron-store');
const { BrowserWindow, shell } = require('electron');
const http = require('http');
const url = require('url');

// Token Store
const tokenStore = new Store({
  name: 'google-tokens',
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
    this.oauth2Client = null;
    this.isAuthenticated = false;
    this.userInfo = null;
    this.initClient();
  }

  initClient() {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.warn('Google OAuth: Client ID/Secret not configured');
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    // Try to load saved tokens
    this.loadTokens();

    // Token refresh event
    this.oauth2Client.on('tokens', (tokens) => {
      console.log('Google OAuth: New tokens received');
      if (tokens.refresh_token) {
        tokenStore.set('refresh_token', tokens.refresh_token);
      }
      if (tokens.access_token) {
        tokenStore.set('access_token', tokens.access_token);
        tokenStore.set('expiry_date', tokens.expiry_date);
      }
    });
  }

  loadTokens() {
    const accessToken = tokenStore.get('access_token');
    const refreshToken = tokenStore.get('refresh_token');
    const expiryDate = tokenStore.get('expiry_date');

    if (refreshToken) {
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry_date: expiryDate
      });
      this.isAuthenticated = true;
      console.log('Google OAuth: Tokens loaded from store');
    }
  }

  getAuthUrl() {
    if (!this.oauth2Client) {
      return null;
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'  // Force consent screen for refresh token
    });
  }

  // Start OAuth flow with local callback server
  async startAuthFlow() {
    return new Promise((resolve, reject) => {
      if (!this.oauth2Client) {
        reject(new Error('OAuth client not initialized. Please configure CLIENT_ID and CLIENT_SECRET.'));
        return;
      }

      // Create local server for OAuth callback
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url, true);

          if (reqUrl.pathname === '/oauth2callback') {
            const code = reqUrl.query.code;

            if (code) {
              // Exchange code for tokens
              const { tokens } = await this.oauth2Client.getToken(code);
              this.oauth2Client.setCredentials(tokens);

              // Save tokens
              tokenStore.set('access_token', tokens.access_token);
              if (tokens.refresh_token) {
                tokenStore.set('refresh_token', tokens.refresh_token);
              }
              tokenStore.set('expiry_date', tokens.expiry_date);

              this.isAuthenticated = true;

              // Get user info
              await this.fetchUserInfo();

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
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="success">✓</div>
                    <h1>Erfolgreich verbunden!</h1>
                    <p>Du kannst dieses Fenster jetzt schließen.</p>
                  </div>
                </body>
                </html>
              `);

              server.close();
              resolve({ success: true, user: this.userInfo });
            } else {
              res.writeHead(400);
              res.end('No code received');
              server.close();
              reject(new Error('No authorization code received'));
            }
          }
        } catch (error) {
          console.error('OAuth callback error:', error);
          res.writeHead(500);
          res.end('Authentication failed');
          server.close();
          reject(error);
        }
      });

      server.listen(8089, () => {
        console.log('OAuth callback server listening on port 8089');

        // Open browser with auth URL
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

  async fetchUserInfo() {
    if (!this.oauth2Client || !this.isAuthenticated) {
      return null;
    }

    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();
      this.userInfo = {
        email: data.email,
        name: data.name,
        picture: data.picture
      };
      tokenStore.set('user_info', this.userInfo);
      return this.userInfo;
    } catch (error) {
      console.error('Failed to fetch user info:', error);
      return null;
    }
  }

  getClient() {
    return this.oauth2Client;
  }

  getUserInfo() {
    if (!this.userInfo) {
      this.userInfo = tokenStore.get('user_info');
    }
    return this.userInfo;
  }

  isConnected() {
    return this.isAuthenticated && this.oauth2Client != null;
  }

  async disconnect() {
    if (this.oauth2Client) {
      try {
        // Revoke token
        const token = tokenStore.get('access_token');
        if (token) {
          await this.oauth2Client.revokeToken(token);
        }
      } catch (error) {
        console.log('Token revoke failed (may already be invalid):', error.message);
      }
    }

    // Clear stored tokens
    tokenStore.clear();
    this.isAuthenticated = false;
    this.userInfo = null;

    // Reinitialize client
    this.initClient();

    return { success: true };
  }

  // Check if credentials are configured
  isConfigured() {
    return CLIENT_ID && CLIENT_SECRET && CLIENT_ID.length > 10;
  }
}

// Singleton instance
const googleAuth = new GoogleAuthService();

module.exports = googleAuth;
