// Gmail Service for Smartklick Desktop - Multi-Account Support
const { google } = require('googleapis');
const googleAuth = require('./googleAuth');

class GmailService {
  constructor(accountId = null) {
    this.accountId = accountId;
    this.gmail = null;
  }

  getGmail() {
    if (!googleAuth.isConnected(this.accountId)) {
      throw new Error('Google nicht verbunden');
    }

    if (!this.gmail) {
      const client = googleAuth.getClient(this.accountId);
      if (!client) {
        throw new Error('OAuth Client nicht verfügbar');
      }
      this.gmail = google.gmail({
        version: 'v1',
        auth: client
      });
    }

    return this.gmail;
  }

  // Hole Account Info
  getAccountInfo() {
    return googleAuth.getUserInfo(this.accountId);
  }

  // Get unread emails count
  async getUnreadCount() {
    const gmail = this.getGmail();

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 1
    });

    return response.data.resultSizeEstimate || 0;
  }

  // Get recent unread emails
  async getUnreadEmails(maxResults = 10) {
    const gmail = this.getGmail();

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: maxResults
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      const email = await this.getEmail(msg.id);
      if (email) {
        emails.push(email);
      }
    }

    return emails;
  }

  // Get recent emails (inbox)
  // maxResults: 0 = alle, sonst die gewünschte Anzahl (10, 50, 100, 250, 500, etc.)
  // existingIds: Array von IDs die bereits geladen sind (für inkrementelles Laden)
  async getRecentEmails(maxResults = 100, existingIds = []) {
    const gmail = this.getGmail();

    // 0 bedeutet "alle E-Mails"
    const limit = maxResults === 0 ? Infinity : maxResults;
    const existingIdSet = new Set(existingIds);

    const accountInfo = this.getAccountInfo();
    const accountEmail = accountInfo?.email || this.accountId;
    console.log(`[GMAIL:${accountEmail}] Lade ${maxResults === 0 ? 'ALLE' : maxResults} E-Mails... (${existingIds.length} bereits vorhanden)`);

    const allMessages = [];
    let pageToken = null;
    let pageCount = 0;

    // Pagination: Solange laden bis genug E-Mails oder keine mehr
    do {
      // Pro Request maximal 500 (Gmail API Limit)
      const perPage = Math.min(500, limit - allMessages.length);

      const response = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: perPage,
        pageToken: pageToken
      });

      const messages = response.data.messages || [];
      allMessages.push(...messages);
      pageToken = response.data.nextPageToken;
      pageCount++;

      console.log(`[GMAIL:${accountEmail}] Seite ${pageCount}: ${messages.length} E-Mails (Gesamt: ${allMessages.length})`);

      // Aufhören wenn genug E-Mails oder keine weiteren Seiten
      if (allMessages.length >= limit || !pageToken) {
        break;
      }
    } while (true);

    // Auf gewünschte Anzahl begrenzen
    const messagesToLoad = maxResults === 0 ? allMessages : allMessages.slice(0, maxResults);

    // Nur neue E-Mails laden (die wir noch nicht haben)
    const newMessages = messagesToLoad.filter(msg => !existingIdSet.has(msg.id));

    console.log(`[GMAIL:${accountEmail}] ${messagesToLoad.length} E-Mail-IDs, davon ${newMessages.length} neu zu laden`);

    if (newMessages.length === 0) {
      console.log(`[GMAIL:${accountEmail}] Keine neuen E-Mails zu laden`);
      return { emails: [], skipped: existingIds.length, isIncremental: true };
    }

    // E-Mail-Details laden (nur für neue)
    const emails = [];
    for (let i = 0; i < newMessages.length; i++) {
      const msg = newMessages[i];
      const email = await this.getEmail(msg.id);
      if (email) {
        emails.push(email);
      }

      // Progress alle 50 E-Mails loggen
      if ((i + 1) % 50 === 0 || i + 1 === newMessages.length) {
        console.log(`[GMAIL:${accountEmail}] Details geladen: ${i + 1}/${newMessages.length}`);
      }
    }

    console.log(`[GMAIL:${accountEmail}] Fertig: ${emails.length} neue E-Mails geladen`);

    // Bei inkrementellem Laden: Rückgabe mit Metadaten
    if (existingIds.length > 0) {
      return { emails, skipped: existingIds.length, isIncremental: true };
    }

    return emails;
  }

  // Progressive Loading: Lädt E-Mails in Batches und ruft onBatch für jeden Batch auf
  async getRecentEmailsProgressive(onBatch, batchSize = 30) {
    const gmail = this.getGmail();

    const accountInfo = this.getAccountInfo();
    const accountEmail = accountInfo?.email || this.accountId;
    console.log(`[GMAIL:${accountEmail}] Progressive Loading gestartet (Batch-Größe: ${batchSize})`);

    let pageToken = null;
    let totalLoaded = 0;
    let batchNumber = 0;

    // Pagination: Alle E-Mail-IDs laden
    const allMessageIds = [];
    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: 500,
        pageToken: pageToken
      });

      const messages = response.data.messages || [];
      allMessageIds.push(...messages);
      pageToken = response.data.nextPageToken;

      console.log(`[GMAIL:${accountEmail}] IDs geladen: ${allMessageIds.length}`);
    } while (pageToken);

    console.log(`[GMAIL:${accountEmail}] Gesamt ${allMessageIds.length} E-Mail-IDs, starte Progressive Loading...`);

    // E-Mails in Batches laden
    for (let i = 0; i < allMessageIds.length; i += batchSize) {
      const batchIds = allMessageIds.slice(i, i + batchSize);
      const batchEmails = [];

      // Details für diesen Batch laden
      for (const msg of batchIds) {
        const email = await this.getEmail(msg.id);
        if (email) {
          batchEmails.push(email);
        }
      }

      totalLoaded += batchEmails.length;
      batchNumber++;

      console.log(`[GMAIL:${accountEmail}] Batch ${batchNumber}: ${batchEmails.length} E-Mails (Gesamt: ${totalLoaded}/${allMessageIds.length})`);

      // Callback mit dem Batch aufrufen
      if (onBatch && batchEmails.length > 0) {
        const isFirst = batchNumber === 1;
        const isLast = i + batchSize >= allMessageIds.length;
        const progress = Math.round((totalLoaded / allMessageIds.length) * 100);

        await onBatch({
          emails: batchEmails,
          batchNumber,
          totalLoaded,
          totalCount: allMessageIds.length,
          progress,
          isFirst,
          isLast
        });
      }
    }

    console.log(`[GMAIL:${accountEmail}] Progressive Loading abgeschlossen: ${totalLoaded} E-Mails`);
    return { success: true, totalLoaded };
  }

  // Get single email details
  async getEmail(messageId) {
    const gmail = this.getGmail();

    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const email = this.formatEmail(response.data);
      // Account-ID hinzufügen
      email.accountId = this.accountId;
      return email;
    } catch (error) {
      console.error('Failed to get email:', error);
      return null;
    }
  }

  // Search emails
  async searchEmails(query, maxResults = 10) {
    const gmail = this.getGmail();

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: maxResults
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      const email = await this.getEmail(msg.id);
      if (email) {
        emails.push(email);
      }
    }

    return emails;
  }

  // Mark email as read
  async markAsRead(messageId) {
    const gmail = this.getGmail();

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      resource: {
        removeLabelIds: ['UNREAD']
      }
    });

    return { success: true };
  }

  // Send email
  async sendEmail(to, subject, body, isHtml = false) {
    const gmail = this.getGmail();

    const userInfo = this.getAccountInfo();
    const from = userInfo?.email || 'me';

    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      resource: {
        raw: encodedMessage
      }
    });

    return {
      success: true,
      messageId: response.data.id
    };
  }

  // Reply to email
  async replyToEmail(messageId, body, isHtml = false) {
    const gmail = this.getGmail();

    // Get original email
    const original = await this.getEmail(messageId);
    if (!original) {
      throw new Error('Original-E-Mail nicht gefunden');
    }

    const userInfo = this.getAccountInfo();
    const from = userInfo?.email || 'me';

    const message = [
      `From: ${from}`,
      `To: ${original.from}`,
      `Subject: Re: ${original.subject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
      '',
      body
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      resource: {
        raw: encodedMessage,
        threadId: original.threadId
      }
    });

    return {
      success: true,
      messageId: response.data.id
    };
  }

  // Delete email (move to trash)
  async deleteEmail(messageId) {
    const gmail = this.getGmail();

    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId
    });

    return { success: true };
  }

  // Anhang herunterladen
  async getAttachment(messageId, attachmentId) {
    const gmail = this.getGmail();

    try {
      const response = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: messageId,
        id: attachmentId
      });

      // Data ist Base64-kodiert
      return {
        success: true,
        data: response.data.data,
        size: response.data.size
      };
    } catch (error) {
      console.error('[GMAIL] Attachment download error:', error);
      return { success: false, error: error.message };
    }
  }

  // Format email for display
  formatEmail(message) {
    const headers = message.payload?.headers || [];
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    // Rekursiv durch alle Parts gehen um Text, HTML und Anhänge zu finden
    let textBody = '';
    let htmlBody = '';
    const attachments = [];

    const extractParts = (part) => {
      if (!part) return;

      const mimeType = part.mimeType || '';
      const filename = part.filename || '';

      // Anhang gefunden (hat Dateiname oder ist nicht text/html/plain)
      if (filename && filename.length > 0) {
        attachments.push({
          id: part.body?.attachmentId || part.partId || '',
          partId: part.partId || '',
          filename: filename,
          mimeType: mimeType,
          size: part.body?.size || 0
        });
        return;
      }

      // Text/Plain
      if (mimeType === 'text/plain' && part.body?.data) {
        textBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }

      // Text/HTML
      if (mimeType === 'text/html' && part.body?.data) {
        htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }

      // Rekursiv durch verschachtelte Parts (multipart/*)
      if (part.parts && Array.isArray(part.parts)) {
        for (const subPart of part.parts) {
          extractParts(subPart);
        }
      }
    };

    // Haupt-Payload verarbeiten
    if (message.payload?.body?.data) {
      // Einfache E-Mail ohne Parts
      const content = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
      if (message.payload.mimeType === 'text/html') {
        htmlBody = content;
      } else {
        textBody = content;
      }
    }

    // Parts durchsuchen
    extractParts(message.payload);

    // Body für Text-Anzeige (ohne HTML-Tags)
    const body = textBody || (htmlBody ? htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '');

    const date = new Date(parseInt(message.internalDate));
    const labels = message.labelIds || [];

    return {
      id: message.id,
      threadId: message.threadId,
      from: getHeader('From'),
      fromName: this.extractName(getHeader('From')),
      fromEmail: this.extractEmail(getHeader('From')),
      to: getHeader('To'),
      subject: getHeader('Subject') || 'Kein Betreff',
      snippet: message.snippet || '',
      body: body.substring(0, 2000),
      html: htmlBody, // HTML-Version für Anzeige
      date: parseInt(message.internalDate),
      dateFormatted: this.formatDate(date),
      isUnread: labels.includes('UNREAD'),
      isImportant: labels.includes('IMPORTANT'),
      isStarred: labels.includes('STARRED'),
      hasAttachments: attachments.length > 0,
      attachments: attachments,
      labels: labels,
      provider: 'gmail',
      accountId: this.accountId
    };
  }

  extractName(fromHeader) {
    // "Max Mustermann <max@example.com>" -> "Max Mustermann"
    const match = fromHeader.match(/^([^<]+)</);
    if (match) {
      return match[1].trim().replace(/"/g, '');
    }
    return fromHeader.replace(/<.*>/, '').trim();
  }

  extractEmail(fromHeader) {
    // "Max Mustermann <max@example.com>" -> "max@example.com"
    const match = fromHeader.match(/<([^>]+)>/);
    if (match) {
      return match[1];
    }
    return fromHeader;
  }

  formatDate(date) {
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

  // Generate speech response for email query
  generateSpeechResponse(emails, queryType = 'unread') {
    if (emails.length === 0) {
      if (queryType === 'unread') {
        return 'Du hast keine ungelesenen E-Mails.';
      }
      return 'Keine E-Mails gefunden.';
    }

    if (queryType === 'unread') {
      if (emails.length === 1) {
        const e = emails[0];
        return `Du hast eine ungelesene E-Mail von ${e.fromName}. Betreff: ${e.subject}.`;
      }

      const summary = emails.slice(0, 3).map(e => {
        return `${e.fromName}: ${e.subject}`;
      }).join('. ');

      return `Du hast ${emails.length} ungelesene E-Mails. Die neuesten sind: ${summary}.`;
    }

    if (queryType === 'search') {
      return `${emails.length} E-Mails gefunden. Die neueste ist von ${emails[0].fromName} mit dem Betreff: ${emails[0].subject}.`;
    }

    return `${emails.length} E-Mails.`;
  }

  // Read email content for speech
  generateReadEmailSpeech(email) {
    const parts = [
      `E-Mail von ${email.fromName}.`,
      `Betreff: ${email.subject}.`,
      email.snippet
    ];

    return parts.join(' ');
  }

  // Get emails from a specific sender (by name or email)
  async getEmailsFromSender(senderName, maxResults = 5) {
    const gmail = this.getGmail();

    // Search for sender - Gmail accepts both name and email in from: query
    const query = `from:(${senderName})`;

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: maxResults
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      const email = await this.getEmail(msg.id);
      if (email) {
        emails.push(email);
      }
    }

    return emails;
  }

  // Get full email thread/conversation
  async getThread(threadId) {
    const gmail = this.getGmail();

    try {
      const response = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full'
      });

      const messages = response.data.messages || [];
      return messages.map(msg => this.formatEmail(msg));
    } catch (error) {
      console.error('Failed to get thread:', error);
      return [];
    }
  }

  // Mark email as starred
  async markAsStarred(messageId) {
    const gmail = this.getGmail();

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      resource: {
        addLabelIds: ['STARRED']
      }
    });

    return { success: true };
  }

  // Remove star from email
  async unstar(messageId) {
    const gmail = this.getGmail();

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      resource: {
        removeLabelIds: ['STARRED']
      }
    });

    return { success: true };
  }

  // Archive email (remove from inbox)
  async archiveEmail(messageId) {
    const gmail = this.getGmail();

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      resource: {
        removeLabelIds: ['INBOX']
      }
    });

    return { success: true };
  }

  // Get emails for briefing (with minimal data for faster loading)
  async getEmailsForBriefing(maxResults = 20) {
    const gmail = this.getGmail();

    // Get recent inbox emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: maxResults
    });

    const messages = response.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      try {
        // Get minimal email info (metadata only)
        const emailResponse = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });

        const headers = emailResponse.data.payload?.headers || [];
        const getHeader = (name) => {
          const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
          return header?.value || '';
        };

        const labels = emailResponse.data.labelIds || [];

        emails.push({
          id: emailResponse.data.id,
          sender: this.extractName(getHeader('From')),
          senderEmail: this.extractEmail(getHeader('From')),
          subject: getHeader('Subject') || 'Kein Betreff',
          snippet: emailResponse.data.snippet || '',
          date: emailResponse.data.internalDate,
          isUnread: labels.includes('UNREAD'),
          isImportant: labels.includes('IMPORTANT'),
          isStarred: labels.includes('STARRED'),
          accountId: this.accountId
        });
      } catch (error) {
        console.error('Failed to get email for briefing:', error);
      }
    }

    return emails;
  }
}

// Factory function statt Singleton
function createGmailService(accountId = null) {
  return new GmailService(accountId);
}

// Legacy Singleton für Abwärtskompatibilität
const defaultGmailService = new GmailService();

module.exports = {
  GmailService,
  createGmailService,
  // Legacy export für Abwärtskompatibilität
  default: defaultGmailService,
  getRecentEmails: (...args) => defaultGmailService.getRecentEmails(...args),
  getEmail: (...args) => defaultGmailService.getEmail(...args),
  sendEmail: (...args) => defaultGmailService.sendEmail(...args),
  replyToEmail: (...args) => defaultGmailService.replyToEmail(...args),
  markAsRead: (...args) => defaultGmailService.markAsRead(...args),
  deleteEmail: (...args) => defaultGmailService.deleteEmail(...args),
  archiveEmail: (...args) => defaultGmailService.archiveEmail(...args),
  searchEmails: (...args) => defaultGmailService.searchEmails(...args),
  getUnreadCount: (...args) => defaultGmailService.getUnreadCount(...args),
  getUnreadEmails: (...args) => defaultGmailService.getUnreadEmails(...args),
  getThread: (...args) => defaultGmailService.getThread(...args),
  markAsStarred: (...args) => defaultGmailService.markAsStarred(...args),
  unstar: (...args) => defaultGmailService.unstar(...args),
  getAttachment: (...args) => defaultGmailService.getAttachment(...args),
  getEmailsForBriefing: (...args) => defaultGmailService.getEmailsForBriefing(...args),
  getRecentEmailsProgressive: (...args) => defaultGmailService.getRecentEmailsProgressive(...args),
  getEmailsFromSender: (...args) => defaultGmailService.getEmailsFromSender(...args)
};
