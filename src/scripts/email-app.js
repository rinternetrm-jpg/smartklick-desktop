// Email Window App
const { ipcRenderer } = require('electron');

// State
let emails = [];
let currentEmail = null;
let currentTab = 'inbox';
let currentReplyType = 'professional';
let isGeneratingReply = false;

// DOM Elements
const emailItems = document.getElementById('emailItems');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const unreadBadge = document.getElementById('unreadBadge');

const detailPlaceholder = document.getElementById('detailPlaceholder');
const detailContent = document.getElementById('detailContent');
const detailSubject = document.getElementById('detailSubject');
const detailFrom = document.getElementById('detailFrom');
const detailDate = document.getElementById('detailDate');
const detailBody = document.getElementById('detailBody');

const analysisPanel = document.getElementById('analysisPanel');
const analysisContent = document.getElementById('analysisContent');

const briefingModal = document.getElementById('briefingModal');
const briefingContent = document.getElementById('briefingContent');

// Reply Panel Elements
const replyPanel = document.getElementById('replyPanel');
const replyText = document.getElementById('replyText');
const replyToAddress = document.getElementById('replyToAddress');
const quickRepliesList = document.getElementById('quickRepliesList');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadEmails();
});

// Event Listeners
function setupEventListeners() {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderEmailList();
    });
  });

  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', loadEmails);

  // Briefing button
  document.getElementById('briefingBtn').addEventListener('click', showBriefing);

  // Action buttons
  document.getElementById('analyzeBtn').addEventListener('click', analyzeCurrentEmail);
  document.getElementById('markReadBtn').addEventListener('click', markCurrentAsRead);
  document.getElementById('starBtn').addEventListener('click', starCurrentEmail);
  document.getElementById('archiveBtn').addEventListener('click', archiveCurrentEmail);
  document.getElementById('deleteBtn').addEventListener('click', deleteCurrentEmail);

  // Close buttons
  document.getElementById('closeAnalysisBtn').addEventListener('click', () => {
    analysisPanel.classList.add('hidden');
  });

  document.getElementById('closeBriefingBtn').addEventListener('click', () => {
    briefingModal.classList.add('hidden');
  });

  // Modal backdrop click
  document.querySelector('.modal-backdrop').addEventListener('click', () => {
    briefingModal.classList.add('hidden');
  });

  // Reply button
  document.getElementById('replyBtn').addEventListener('click', openReplyPanel);

  // Close reply panel
  document.getElementById('closeReplyBtn').addEventListener('click', closeReplyPanel);

  // Reply type buttons
  document.querySelectorAll('.reply-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.reply-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReplyType = btn.dataset.type;
    });
  });

  // Generate KI reply
  document.getElementById('generateReplyBtn').addEventListener('click', generateKiReply);

  // Send reply
  document.getElementById('sendReplyBtn').addEventListener('click', sendReply);

  // Discard reply
  document.getElementById('discardReplyBtn').addEventListener('click', closeReplyPanel);

  // Refresh quick replies
  document.getElementById('refreshQuickReplies').addEventListener('click', loadQuickReplies);
}

// Load Emails
async function loadEmails() {
  showLoading();

  try {
    const result = await ipcRenderer.invoke('email:getRecent', 20);

    if (result.success) {
      emails = result.emails || [];
      updateUnreadBadge();
      renderEmailList();
    } else {
      showError(result.error || 'Fehler beim Laden');
    }
  } catch (error) {
    console.error('Error loading emails:', error);
    showError('Verbindungsfehler');
  }
}

function showLoading() {
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  // Clear existing items except loading/empty
  const items = emailItems.querySelectorAll('.email-item');
  items.forEach(item => item.remove());
}

function showError(message) {
  loadingState.classList.add('hidden');
  emptyState.textContent = message;
  emptyState.classList.remove('hidden');
}

function updateUnreadBadge() {
  const unreadCount = emails.filter(e => e.isUnread).length;
  unreadBadge.textContent = unreadCount;
  unreadBadge.style.display = unreadCount > 0 ? 'inline' : 'none';
}

// Render Email List
function renderEmailList() {
  loadingState.classList.add('hidden');

  // Filter by tab
  let filteredEmails = [...emails];
  if (currentTab === 'unread') {
    filteredEmails = emails.filter(e => e.isUnread);
  }

  // Clear existing items
  const items = emailItems.querySelectorAll('.email-item');
  items.forEach(item => item.remove());

  if (filteredEmails.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  filteredEmails.forEach(email => {
    const item = createEmailItem(email);
    emailItems.appendChild(item);
  });
}

function createEmailItem(email) {
  const item = document.createElement('div');
  item.className = 'email-item';
  item.dataset.id = email.id;

  if (email.isUnread) item.classList.add('unread');
  if (currentEmail && currentEmail.id === email.id) item.classList.add('active');

  const badges = [];
  if (email.isStarred) badges.push('<span class="email-badge starred">Markiert</span>');
  if (email.isImportant) badges.push('<span class="email-badge important">Wichtig</span>');

  item.innerHTML = `
    <div class="email-top">
      <span class="email-from">${escapeHtml(email.fromName || email.from)}</span>
      <span class="email-date">${email.dateFormatted || formatDate(email.date)}</span>
    </div>
    <div class="email-subject">${escapeHtml(email.subject)}</div>
    <div class="email-snippet">${escapeHtml(email.snippet || '')}</div>
    ${badges.length > 0 ? `<div class="email-badges">${badges.join('')}</div>` : ''}
  `;

  item.addEventListener('click', () => selectEmail(email));

  return item;
}

// Select Email
function selectEmail(email) {
  currentEmail = email;

  // Update list selection
  document.querySelectorAll('.email-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === email.id);
  });

  // Show detail
  detailPlaceholder.classList.add('hidden');
  detailContent.classList.remove('hidden');
  analysisPanel.classList.add('hidden');

  detailSubject.textContent = email.subject;
  detailFrom.textContent = email.from;
  detailDate.textContent = formatFullDate(email.date);
  detailBody.textContent = email.body || email.snippet || 'Kein Inhalt';

  // Update action buttons
  document.getElementById('markReadBtn').textContent = email.isUnread ? 'Als gelesen' : 'Als ungelesen';
  document.getElementById('starBtn').textContent = email.isStarred ? 'Nicht markieren' : 'Markieren';
}

// Actions
async function analyzeCurrentEmail() {
  if (!currentEmail) return;

  analysisPanel.classList.remove('hidden');
  analysisContent.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Analysiere E-Mail...</span>
    </div>
  `;

  try {
    const result = await ipcRenderer.invoke('email:analyze', {
      text: currentEmail.body || currentEmail.snippet,
      subject: currentEmail.subject,
      sender: currentEmail.fromName || currentEmail.from
    });

    if (result.success && result.analysis) {
      renderAnalysis(result.analysis);
    } else {
      analysisContent.innerHTML = `<div class="empty-state">Analyse fehlgeschlagen: ${result.error || 'Unbekannter Fehler'}</div>`;
    }
  } catch (error) {
    console.error('Analysis error:', error);
    analysisContent.innerHTML = `<div class="empty-state">Fehler bei der Analyse</div>`;
  }
}

function renderAnalysis(analysis) {
  const urgencyClass = `urgency-${(analysis.urgency || 'mittel').toLowerCase()}`;
  const sentimentClass = `sentiment-${(analysis.sentiment || 'neutral').toLowerCase()}`;

  let keyPointsHtml = '';
  if (analysis.keyPoints && analysis.keyPoints.length > 0) {
    keyPointsHtml = `
      <div class="analysis-section">
        <div class="analysis-label">Kernpunkte</div>
        <ul class="key-points">
          ${analysis.keyPoints.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  analysisContent.innerHTML = `
    <div class="analysis-section">
      <div class="analysis-label">Zusammenfassung</div>
      <div class="analysis-value">${escapeHtml(analysis.summary || 'Keine Zusammenfassung')}</div>
    </div>

    ${keyPointsHtml}

    <div class="analysis-section">
      <div class="analysis-label">Dringlichkeit</div>
      <span class="analysis-badge ${urgencyClass}">${analysis.urgency || 'Mittel'}</span>
    </div>

    <div class="analysis-section">
      <div class="analysis-label">Stimmung</div>
      <span class="analysis-badge ${sentimentClass}">${analysis.sentiment || 'Neutral'}</span>
    </div>

    <div class="analysis-section">
      <div class="analysis-label">Absicht des Absenders</div>
      <div class="analysis-value">${escapeHtml(analysis.intent || 'Unklar')}</div>
    </div>

    <div class="analysis-section">
      <div class="analysis-label">Empfohlene Aktion</div>
      <div class="analysis-value">${escapeHtml(analysis.suggestedAction || 'Keine')}</div>
    </div>
  `;
}

async function markCurrentAsRead() {
  if (!currentEmail) return;

  try {
    if (currentEmail.isUnread) {
      await ipcRenderer.invoke('email:markAsRead', currentEmail.id);
      currentEmail.isUnread = false;
    } else {
      // Mark as unread is not implemented in the basic service
    }

    updateUnreadBadge();
    renderEmailList();
    document.getElementById('markReadBtn').textContent = currentEmail.isUnread ? 'Als gelesen' : 'Als ungelesen';
  } catch (error) {
    console.error('Error marking email:', error);
  }
}

async function starCurrentEmail() {
  if (!currentEmail) return;

  try {
    if (currentEmail.isStarred) {
      await ipcRenderer.invoke('email:unstar', currentEmail.id);
      currentEmail.isStarred = false;
    } else {
      await ipcRenderer.invoke('email:star', currentEmail.id);
      currentEmail.isStarred = true;
    }

    renderEmailList();
    document.getElementById('starBtn').textContent = currentEmail.isStarred ? 'Nicht markieren' : 'Markieren';
  } catch (error) {
    console.error('Error starring email:', error);
  }
}

async function archiveCurrentEmail() {
  if (!currentEmail) return;

  try {
    await ipcRenderer.invoke('email:archive', currentEmail.id);

    // Remove from list
    emails = emails.filter(e => e.id !== currentEmail.id);
    currentEmail = null;

    renderEmailList();
    detailPlaceholder.classList.remove('hidden');
    detailContent.classList.add('hidden');
  } catch (error) {
    console.error('Error archiving email:', error);
  }
}

async function deleteCurrentEmail() {
  if (!currentEmail) return;

  if (!confirm('E-Mail wirklich loeschen?')) return;

  try {
    await ipcRenderer.invoke('email:delete', currentEmail.id);

    // Remove from list
    emails = emails.filter(e => e.id !== currentEmail.id);
    currentEmail = null;

    renderEmailList();
    detailPlaceholder.classList.remove('hidden');
    detailContent.classList.add('hidden');
  } catch (error) {
    console.error('Error deleting email:', error);
  }
}

// Briefing
async function showBriefing() {
  briefingModal.classList.remove('hidden');
  briefingContent.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Erstelle Briefing...</span>
    </div>
  `;

  try {
    // Get emails for briefing
    const briefingEmails = await ipcRenderer.invoke('email:getForBriefing', 20);

    if (!briefingEmails.success) {
      briefingContent.innerHTML = `<div class="empty-state">Fehler: ${briefingEmails.error}</div>`;
      return;
    }

    // Request briefing from server
    const result = await ipcRenderer.invoke('email:briefing', briefingEmails.emails);

    if (result.success) {
      renderBriefing(result);
    } else {
      briefingContent.innerHTML = `<div class="empty-state">Briefing fehlgeschlagen: ${result.error}</div>`;
    }
  } catch (error) {
    console.error('Briefing error:', error);
    briefingContent.innerHTML = `<div class="empty-state">Fehler beim Erstellen des Briefings</div>`;
  }
}

function renderBriefing(result) {
  const stats = result.stats || { total: 0, unread: 0, urgent: 0 };
  const highlights = result.highlights || [];

  let highlightsHtml = '';
  if (highlights.length > 0) {
    highlightsHtml = `
      <div class="highlights-section">
        <div class="highlights-title">Wichtige E-Mails</div>
        ${highlights.map(h => `
          <div class="highlight-item">
            <div class="highlight-sender">${escapeHtml(h.sender)}</div>
            <div class="highlight-subject">${escapeHtml(h.subject)}</div>
            <div class="highlight-reason">${escapeHtml(h.reason)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  briefingContent.innerHTML = `
    <div class="briefing-text">${escapeHtml(result.briefing || 'Kein Briefing verfuegbar')}</div>

    <div class="briefing-stats">
      <div class="stat-item">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Gesamt</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.unread}</div>
        <div class="stat-label">Ungelesen</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.urgent}</div>
        <div class="stat-label">Dringend</div>
      </div>
    </div>

    ${highlightsHtml}
  `;
}

// =============================================================================
// REPLY FUNCTIONS
// =============================================================================

function openReplyPanel() {
  if (!currentEmail) return;

  replyPanel.classList.remove('hidden');
  analysisPanel.classList.add('hidden');

  // Set recipient
  replyToAddress.textContent = currentEmail.from;

  // Clear previous text
  replyText.value = '';

  // Load quick replies
  loadQuickReplies();
}

function closeReplyPanel() {
  replyPanel.classList.add('hidden');
  replyText.value = '';
  quickRepliesList.innerHTML = '';
}

async function loadQuickReplies() {
  if (!currentEmail) return;

  quickRepliesList.innerHTML = `
    <div class="loading-quick-replies">
      <div class="spinner small"></div>
      <span>Lade Vorschlaege...</span>
    </div>
  `;

  try {
    const result = await ipcRenderer.invoke('email:getQuickReplies', {
      originalText: currentEmail.body || currentEmail.snippet,
      originalSubject: currentEmail.subject,
      originalSender: currentEmail.fromName || currentEmail.from
    });

    if (result.success && result.quick_replies) {
      renderQuickReplies(result.quick_replies);
    } else {
      quickRepliesList.innerHTML = `<div class="quick-reply-error">Keine Vorschlaege verfuegbar</div>`;
    }
  } catch (error) {
    console.error('Quick replies error:', error);
    quickRepliesList.innerHTML = `<div class="quick-reply-error">Fehler beim Laden</div>`;
  }
}

function renderQuickReplies(replies) {
  quickRepliesList.innerHTML = replies.map((reply, index) => `
    <button class="quick-reply-btn" data-index="${index}">
      <span class="quick-reply-text">${escapeHtml(reply)}</span>
    </button>
  `).join('');

  // Add click handlers
  quickRepliesList.querySelectorAll('.quick-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = replies[parseInt(btn.dataset.index)];
      replyText.value = text;
    });
  });
}

async function generateKiReply() {
  if (!currentEmail || isGeneratingReply) return;

  isGeneratingReply = true;
  const generateBtn = document.getElementById('generateReplyBtn');
  generateBtn.innerHTML = `
    <div class="spinner small"></div>
    <span>Generiere...</span>
  `;
  generateBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('email:generateReply', {
      originalText: currentEmail.body || currentEmail.snippet,
      originalSubject: currentEmail.subject,
      originalSender: currentEmail.fromName || currentEmail.from,
      replyType: currentReplyType,
      context: replyText.value || ''
    });

    if (result.success && result.reply) {
      replyText.value = result.reply;
    } else {
      alert('Fehler beim Generieren: ' + (result.error || 'Unbekannter Fehler'));
    }
  } catch (error) {
    console.error('Generate reply error:', error);
    alert('Fehler beim Generieren der Antwort');
  } finally {
    isGeneratingReply = false;
    generateBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5z"/>
      </svg>
      KI-Antwort generieren
    `;
    generateBtn.disabled = false;
  }
}

async function sendReply() {
  if (!currentEmail || !replyText.value.trim()) {
    alert('Bitte schreibe zuerst eine Antwort');
    return;
  }

  const sendBtn = document.getElementById('sendReplyBtn');
  sendBtn.textContent = 'Sende...';
  sendBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('email:sendReply', currentEmail.id, replyText.value);

    if (result.success) {
      // Show success
      closeReplyPanel();
      showNotification('Antwort gesendet!');

      // Mark original as read
      if (currentEmail.isUnread) {
        await ipcRenderer.invoke('email:markAsRead', currentEmail.id);
        currentEmail.isUnread = false;
        updateUnreadBadge();
        renderEmailList();
      }
    } else {
      alert('Fehler beim Senden: ' + (result.error || 'Unbekannter Fehler'));
    }
  } catch (error) {
    console.error('Send reply error:', error);
    alert('Fehler beim Senden der Antwort');
  } finally {
    sendBtn.textContent = 'Senden';
    sendBtn.disabled = false;
  }
}

function showNotification(message) {
  // Create toast notification
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Helpers
function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(parseInt(timestamp));
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

function formatFullDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(parseInt(timestamp));
  return date.toLocaleString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Listen for external commands (from main process)
ipcRenderer.on('email:selectSender', async (_, senderName) => {
  // Load emails from specific sender
  try {
    const result = await ipcRenderer.invoke('email:getFromSender', senderName);
    if (result.success && result.emails && result.emails.length > 0) {
      selectEmail(result.emails[0]);
    }
  } catch (error) {
    console.error('Error loading sender emails:', error);
  }
});

ipcRenderer.on('email:readLast', () => {
  // Select and read the last email
  if (emails.length > 0) {
    selectEmail(emails[0]);
  }
});

ipcRenderer.on('email:analyzeLast', async () => {
  // Analyze the last email
  if (emails.length > 0) {
    selectEmail(emails[0]);
    await analyzeCurrentEmail();
  }
});

ipcRenderer.on('email:showBriefing', () => {
  showBriefing();
});

// Handle voice commands from main window
ipcRenderer.on('email-command', (_, command) => {
  console.log('[EMAIL] Received voice command:', command);

  switch (command.action) {
    case 'openReply':
      if (currentEmail) {
        openReplyPanel();
      } else if (emails.length > 0) {
        selectEmail(emails[0]);
        setTimeout(openReplyPanel, 100);
      }
      break;

    case 'generateReply':
      if (currentEmail && !replyPanel.classList.contains('hidden')) {
        generateKiReply();
      } else if (currentEmail) {
        openReplyPanel();
        setTimeout(generateKiReply, 500);
      }
      break;

    case 'setReplyType':
      currentReplyType = command.type || 'professional';
      // Update UI
      document.querySelectorAll('.reply-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === currentReplyType);
      });
      break;

    case 'sendReply':
      if (!replyPanel.classList.contains('hidden') && replyText.value.trim()) {
        sendReply();
      }
      break;

    default:
      console.log('Unknown email command:', command);
  }
});
