// Outlook Email Provider using Microsoft Graph API
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');

class OutlookProvider {
  constructor(accountId, config) {
    this.providerId = 'outlook';
    this.accountId = accountId;
    this.config = config;
    this.graphClient = null;
    this.credentials = null;
    this.onCredentialsUpdated = null;
  }

  // ==================== AUTHENTIFIZIERUNG ====================

  async authenticate(credentials) {
    this.credentials = credentials;

    // Graph Client initialisieren
    this.graphClient = Client.init({
      authProvider: async (done) => {
        try {
          // Token refreshen falls noetig
          if (this.isTokenExpired()) {
            await this.refreshAuth();
          }
          done(null, this.credentials.accessToken);
        } catch (error) {
          done(error, null);
        }
      }
    });

    // Verbindung testen
    try {
      const user = await this.graphClient.api('/me').get();
      console.log('[OUTLOOK] Connected as:', user.mail || user.userPrincipalName);
      return true;
    } catch (error) {
      console.error('[OUTLOOK] Auth failed:', error.message);
      return false;
    }
  }

  async refreshAuth() {
    try {
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          refresh_token: this.credentials.refreshToken,
          grant_type: 'refresh_token',
          scope: 'Mail.Read Mail.Send Mail.ReadWrite offline_access User.Read'
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      this.credentials.accessToken = data.access_token;
      if (data.refresh_token) {
        this.credentials.refreshToken = data.refresh_token;
      }
      this.credentials.expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      // Credentials in DB aktualisieren
      if (this.onCredentialsUpdated) {
        this.onCredentialsUpdated(this.credentials);
      }

      console.log('[OUTLOOK] Token refreshed');
      return true;
    } catch (error) {
      console.error('[OUTLOOK] Token refresh failed:', error);
      return false;
    }
  }

  isTokenExpired() {
    if (!this.credentials?.expiresAt) return true;
    // 5 Minuten Puffer
    return new Date(this.credentials.expiresAt) <= new Date(Date.now() + 5 * 60 * 1000);
  }

  isAuthenticated() {
    return this.graphClient !== null && this.credentials?.accessToken;
  }

  // ==================== E-MAILS LESEN ====================

  async getEmails(options = {}) {
    const {
      folder = 'inbox',
      maxResults = 10,
      unreadOnly = false,
      query = ''
    } = options;

    try {
      let request = this.graphClient
        .api(`/me/mailFolders/${folder}/messages`)
        .top(maxResults)
        .select('id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,flag,hasAttachments,conversationId')
        .orderby('receivedDateTime desc');

      if (unreadOnly) {
        request = request.filter('isRead eq false');
      }

      if (query) {
        request = request.search(`"${query}"`);
      }

      const response = await request.get();

      return response.value.map(msg => this.mapToUnifiedEmail(msg));
    } catch (error) {
      console.error('[OUTLOOK] getEmails error:', error);
      throw error;
    }
  }

  async getRecentEmails(maxResults = 10) {
    return this.getEmails({ maxResults });
  }

  async getUnreadEmails(maxResults = 20) {
    return this.getEmails({ maxResults, unreadOnly: true });
  }

  async getEmailById(id) {
    try {
      const message = await this.graphClient
        .api(`/me/messages/${id}`)
        .select('id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,flag,hasAttachments,conversationId')
        .get();

      return this.mapToUnifiedEmail(message);
    } catch (error) {
      console.error('[OUTLOOK] getEmailById error:', error);
      throw error;
    }
  }

  async getThread(conversationId) {
    try {
      const response = await this.graphClient
        .api('/me/messages')
        .filter(`conversationId eq '${conversationId}'`)
        .orderby('receivedDateTime asc')
        .get();

      return response.value.map(msg => this.mapToUnifiedEmail(msg));
    } catch (error) {
      console.error('[OUTLOOK] getThread error:', error);
      throw error;
    }
  }

  async getEmailsFromSender(senderName, maxResults = 5) {
    try {
      const response = await this.graphClient
        .api('/me/messages')
        .search(`"from:${senderName}"`)
        .top(maxResults)
        .orderby('receivedDateTime desc')
        .get();

      return response.value.map(msg => this.mapToUnifiedEmail(msg));
    } catch (error) {
      console.error('[OUTLOOK] getEmailsFromSender error:', error);
      throw error;
    }
  }

  async searchEmails(query, maxResults = 20) {
    try {
      const response = await this.graphClient
        .api('/me/messages')
        .search(`"${query}"`)
        .top(maxResults)
        .get();

      return response.value.map(msg => this.mapToUnifiedEmail(msg));
    } catch (error) {
      console.error('[OUTLOOK] searchEmails error:', error);
      throw error;
    }
  }

  async getEmailsForBriefing(maxResults = 20) {
    // Ungelesene E-Mails der letzten 24 Stunden
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
      const response = await this.graphClient
        .api('/me/messages')
        .filter(`receivedDateTime ge ${yesterday}`)
        .top(maxResults)
        .orderby('receivedDateTime desc')
        .select('id,subject,bodyPreview,from,receivedDateTime,isRead,flag')
        .get();

      return response.value.map(msg => this.mapToUnifiedEmail(msg));
    } catch (error) {
      console.error('[OUTLOOK] getEmailsForBriefing error:', error);
      throw error;
    }
  }

  // ==================== E-MAIL AKTIONEN ====================

  async markAsRead(id) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}`)
        .patch({ isRead: true });
    } catch (error) {
      console.error('[OUTLOOK] markAsRead error:', error);
      throw error;
    }
  }

  async markAsUnread(id) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}`)
        .patch({ isRead: false });
    } catch (error) {
      console.error('[OUTLOOK] markAsUnread error:', error);
      throw error;
    }
  }

  async markAsStarred(id) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}`)
        .patch({ flag: { flagStatus: 'flagged' } });
    } catch (error) {
      console.error('[OUTLOOK] markAsStarred error:', error);
      throw error;
    }
  }

  async unstar(id) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}`)
        .patch({ flag: { flagStatus: 'notFlagged' } });
    } catch (error) {
      console.error('[OUTLOOK] unstar error:', error);
      throw error;
    }
  }

  async archiveEmail(id) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}/move`)
        .post({ destinationId: 'archive' });
    } catch (error) {
      console.error('[OUTLOOK] archiveEmail error:', error);
      throw error;
    }
  }

  async deleteEmail(id) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}/move`)
        .post({ destinationId: 'deleteditems' });
    } catch (error) {
      console.error('[OUTLOOK] deleteEmail error:', error);
      throw error;
    }
  }

  async move(id, folderId) {
    try {
      await this.graphClient
        .api(`/me/messages/${id}/move`)
        .post({ destinationId: folderId });
    } catch (error) {
      console.error('[OUTLOOK] move error:', error);
      throw error;
    }
  }

  // ==================== SENDEN ====================

  async sendEmail(to, subject, body, isHtml = false) {
    try {
      const message = {
        subject: subject,
        body: {
          contentType: isHtml ? 'HTML' : 'Text',
          content: body
        },
        toRecipients: [{
          emailAddress: { address: to }
        }]
      };

      await this.graphClient
        .api('/me/sendMail')
        .post({ message, saveToSentItems: true });

      return { success: true };
    } catch (error) {
      console.error('[OUTLOOK] sendEmail error:', error);
      throw error;
    }
  }

  async replyToEmail(messageId, body, isHtml = false) {
    try {
      await this.graphClient
        .api(`/me/messages/${messageId}/reply`)
        .post({
          message: {
            body: {
              contentType: isHtml ? 'HTML' : 'Text',
              content: body
            }
          }
        });

      return { success: true };
    } catch (error) {
      console.error('[OUTLOOK] replyToEmail error:', error);
      throw error;
    }
  }

  // ==================== ORDNER ====================

  async getFolders() {
    try {
      const response = await this.graphClient
        .api('/me/mailFolders')
        .select('id,displayName,unreadItemCount,totalItemCount')
        .get();

      return response.value.map(folder => ({
        id: folder.id,
        name: folder.displayName,
        type: this.mapFolderType(folder.displayName),
        unreadCount: folder.unreadItemCount,
        totalCount: folder.totalItemCount
      }));
    } catch (error) {
      console.error('[OUTLOOK] getFolders error:', error);
      throw error;
    }
  }

  mapFolderType(name) {
    const map = {
      'Inbox': 'inbox',
      'Posteingang': 'inbox',
      'Sent Items': 'sent',
      'Gesendete Elemente': 'sent',
      'Drafts': 'drafts',
      'Entwuerfe': 'drafts',
      'Deleted Items': 'trash',
      'Geloeschte Elemente': 'trash',
      'Junk Email': 'spam',
      'Junk-E-Mail': 'spam',
      'Archive': 'archive',
      'Archiv': 'archive'
    };
    return map[name] || 'custom';
  }

  // ==================== MAPPING ====================

  mapToUnifiedEmail(msg) {
    return {
      id: msg.id,
      accountId: this.accountId,
      threadId: msg.conversationId,
      from: msg.from?.emailAddress?.address || '',
      fromName: msg.from?.emailAddress?.name || '',
      to: msg.toRecipients?.map(r => r.emailAddress.address) || [],
      cc: msg.ccRecipients?.map(r => r.emailAddress.address) || [],
      subject: msg.subject || '(Kein Betreff)',
      body: msg.body?.content ? this.stripHtml(msg.body.content) : '',
      bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : null,
      snippet: msg.bodyPreview || '',
      date: new Date(msg.receivedDateTime).getTime(),
      dateFormatted: this.formatDate(msg.receivedDateTime),
      isUnread: !msg.isRead,
      isStarred: msg.flag?.flagStatus === 'flagged',
      isImportant: msg.flag?.flagStatus === 'flagged',
      hasAttachments: msg.hasAttachments,
      labels: [],
      provider: 'outlook'
    };
  }

  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Gestern';
    }

    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  }
}

module.exports = OutlookProvider;
