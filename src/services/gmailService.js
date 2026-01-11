// Gmail Service for Smartklick Desktop
const { google } = require('googleapis');
const googleAuth = require('./googleAuth');

class GmailService {
  constructor() {
    this.gmail = null;
  }

  getGmail() {
    if (!googleAuth.isConnected()) {
      throw new Error('Google nicht verbunden');
    }

    if (!this.gmail) {
      this.gmail = google.gmail({
        version: 'v1',
        auth: googleAuth.getClient()
      });
    }

    return this.gmail;
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
  async getRecentEmails(maxResults = 100) {
    const gmail = this.getGmail();

    // 0 bedeutet "alle E-Mails"
    const limit = maxResults === 0 ? Infinity : maxResults;

    console.log(`[GMAIL] Lade ${maxResults === 0 ? 'ALLE' : maxResults} E-Mails...`);

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

      console.log(`[GMAIL] Seite ${pageCount}: ${messages.length} E-Mails (Gesamt: ${allMessages.length})`);

      // Aufhören wenn genug E-Mails oder keine weiteren Seiten
      if (allMessages.length >= limit || !pageToken) {
        break;
      }
    } while (true);

    // Auf gewünschte Anzahl begrenzen
    const messagesToLoad = maxResults === 0 ? allMessages : allMessages.slice(0, maxResults);

    console.log(`[GMAIL] ${messagesToLoad.length} E-Mail-IDs, lade Details...`);

    // E-Mail-Details laden
    const emails = [];
    for (let i = 0; i < messagesToLoad.length; i++) {
      const msg = messagesToLoad[i];
      const email = await this.getEmail(msg.id);
      if (email) {
        emails.push(email);
      }

      // Progress alle 50 E-Mails loggen
      if ((i + 1) % 50 === 0 || i + 1 === messagesToLoad.length) {
        console.log(`[GMAIL] Details geladen: ${i + 1}/${messagesToLoad.length}`);
      }
    }

    console.log(`[GMAIL] Fertig: ${emails.length} E-Mails geladen`);
    return emails;
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

      return this.formatEmail(response.data);
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

    const userInfo = googleAuth.getUserInfo();
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

    const userInfo = googleAuth.getUserInfo();
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

  // Format email for display
  formatEmail(message) {
    const headers = message.payload?.headers || [];
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    // Get email body
    let body = '';
    let snippet = message.snippet || '';

    if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    } else if (message.payload?.parts) {
      // Multipart email - find text/plain or text/html
      const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
      const htmlPart = message.payload.parts.find(p => p.mimeType === 'text/html');

      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      } else if (htmlPart?.body?.data) {
        body = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
        // Strip HTML tags for speech
        body = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

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
      snippet: snippet,
      body: body.substring(0, 2000), // Limit body length
      date: parseInt(message.internalDate),
      dateFormatted: this.formatDate(date),
      isUnread: labels.includes('UNREAD'),
      isImportant: labels.includes('IMPORTANT'),
      isStarred: labels.includes('STARRED'),
      labels: labels
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
          isStarred: labels.includes('STARRED')
        });
      } catch (error) {
        console.error('Failed to get email for briefing:', error);
      }
    }

    return emails;
  }
}

// Singleton instance
const gmailService = new GmailService();

module.exports = gmailService;
