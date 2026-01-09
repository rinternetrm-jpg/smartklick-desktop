// Email Window App - New Dashboard Design
// Mit intelligentem Klassifizierungssystem
const { ipcRenderer } = require('electron');

// State
let emails = [];
let emailClassifications = {}; // Klassifizierungen pro E-Mail ID
let currentEmail = null;
let currentCategory = 'inbox';
let currentReplyType = 'professional';
let isGeneratingReply = false;
let accounts = [];
let selectedAccountId = 'all';
let autoReplyEnabled = false;
let autoClassifyEnabled = true;
let classifierStats = null;

// Kategorie-Mapping für UI
const KATEGORIE_MAP = {
  essenz: { name: 'Essenz', icon: '🔴', color: '#ef4444' },
  wichtig: { name: 'Wichtig', icon: '🟠', color: '#f97316' },
  normal: { name: 'Normal', icon: '🔵', color: '#3b82f6' },
  info: { name: 'Info', icon: 'ℹ️', color: '#6b7280' },
  newsletter: { name: 'Newsletter', icon: '📰', color: '#8b5cf6' },
  spam: { name: 'Spam', icon: '🗑️', color: '#dc2626' }
};

// IMAP presets
const IMAP_PRESETS = {
  '1und1': { host: 'imap.1und1.de', port: 993, tls: true },
  'gmx': { host: 'imap.gmx.net', port: 993, tls: true },
  'webde': { host: 'imap.web.de', port: 993, tls: true },
  'tonline': { host: 'secureimap.t-online.de', port: 993, tls: true },
  'outlook': { host: 'outlook.office365.com', port: 993, tls: true },
  'yahoo': { host: 'imap.mail.yahoo.com', port: 993, tls: true },
  'ionos': { host: 'imap.ionos.de', port: 993, tls: true }
};

// DOM Elements - will be initialized after DOMContentLoaded
let elements = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeElements();
  setupEventListeners();
  loadAccounts();
  loadEmails();
  renderChart();
});

function initializeElements() {
  elements = {
    // Sidebar
    settingsBtn: document.getElementById('settingsBtn'),
    accountSelector: document.getElementById('accountSelector'),
    accountDropdownMenu: document.getElementById('accountDropdownMenu'),
    currentAccountAvatar: document.getElementById('currentAccountAvatar'),
    currentAccountName: document.getElementById('currentAccountName'),
    currentAccountEmail: document.getElementById('currentAccountEmail'),
    statReceived: document.getElementById('statReceived'),
    statReplied: document.getElementById('statReplied'),
    analyzeAllBtn: document.getElementById('analyzeAllBtn'),

    // Header
    headerTitle: document.getElementById('headerTitle'),
    headerSubtitle: document.getElementById('headerSubtitle'),
    refreshBtn: document.getElementById('refreshBtn'),
    filterBtn: document.getElementById('filterBtn'),
    composeBtn: document.getElementById('composeBtn'),

    // Email List
    emailList: document.getElementById('emailList'),
    emailItems: document.getElementById('emailItems'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),

    // Email Detail
    emailDetail: document.getElementById('emailDetail'),
    detailPlaceholder: document.getElementById('detailPlaceholder'),
    detailContent: document.getElementById('detailContent'),
    detailSubject: document.getElementById('detailSubject'),
    detailFrom: document.getElementById('detailFrom'),
    detailDate: document.getElementById('detailDate'),
    detailBody: document.getElementById('detailBody'),
    attachmentsSection: document.getElementById('attachmentsSection'),
    attachmentsList: document.getElementById('attachmentsList'),

    // Action Buttons
    replyBtn: document.getElementById('replyBtn'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    archiveBtn: document.getElementById('archiveBtn'),
    starBtn: document.getElementById('starBtn'),
    deleteBtn: document.getElementById('deleteBtn'),

    // Analysis Panel
    analysisPanel: document.getElementById('analysisPanel'),
    analysisContent: document.getElementById('analysisContent'),
    closeAnalysisBtn: document.getElementById('closeAnalysisBtn'),

    // Reply Panel
    replyPanel: document.getElementById('replyPanel'),
    replyToAddress: document.getElementById('replyToAddress'),
    quickRepliesList: document.getElementById('quickRepliesList'),
    replyText: document.getElementById('replyText'),
    closeReplyBtn: document.getElementById('closeReplyBtn'),
    refreshQuickReplies: document.getElementById('refreshQuickReplies'),
    generateReplyBtn: document.getElementById('generateReplyBtn'),
    sendReplyBtn: document.getElementById('sendReplyBtn'),
    discardReplyBtn: document.getElementById('discardReplyBtn'),

    // Right Panel - Dashboard
    chartBars: document.getElementById('chartBars'),
    autoReplyToggle: document.getElementById('autoReplyToggle'),
    autoReplyCount: document.getElementById('autoReplyCount'),
    briefingBtn: document.getElementById('briefingBtn'),
    emptySpamBtn: document.getElementById('emptySpamBtn'),
    spamCount: document.getElementById('spamCount'),
    archiveNewsletterBtn: document.getElementById('archiveNewsletterBtn'),
    markAllReadBtn: document.getElementById('markAllReadBtn'),

    // Settings Panel
    settingsOverlay: document.getElementById('settingsOverlay'),
    settingsPanel: document.getElementById('settingsPanel'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    accountCardsContainer: document.getElementById('accountCardsContainer'),
    addAccountBtn: document.getElementById('addAccountBtn'),
    autoClassifyToggle: document.getElementById('autoClassifyToggle'),
    autoReplySettingToggle: document.getElementById('autoReplySettingToggle'),

    // Add Account Modal
    addAccountModal: document.getElementById('addAccountModal'),
    closeAddAccountBtn: document.getElementById('closeAddAccountBtn'),
    accountOptions: document.getElementById('accountOptions'),
    gmailSetup: document.getElementById('gmailSetup'),
    outlookSetup: document.getElementById('outlookSetup'),
    imapSetup: document.getElementById('imapSetup'),
    accountLoadingState: document.getElementById('accountLoadingState'),

    // Analysis Modal
    analysisModal: document.getElementById('analysisModal'),
    analysisProgressFill: document.getElementById('analysisProgressFill'),
    analysisProgressText: document.getElementById('analysisProgressText'),
    closeAnalysisModalBtn: document.getElementById('closeAnalysisModalBtn'),

    // Briefing Modal
    briefingModal: document.getElementById('briefingModal'),
    briefingContent: document.getElementById('briefingContent'),
    closeBriefingBtn: document.getElementById('closeBriefingBtn'),

    // Compose Modal
    composeModal: document.getElementById('composeModal'),
    closeComposeBtn: document.getElementById('closeComposeBtn'),
    composeTo: document.getElementById('composeTo'),
    composeCc: document.getElementById('composeCc'),
    composeSubject: document.getElementById('composeSubject'),
    composeBody: document.getElementById('composeBody'),
    composeAiPrompt: document.getElementById('composeAiPrompt'),
    composeAiBtn: document.getElementById('composeAiBtn'),
    composeAttachments: document.getElementById('composeAttachments'),
    composeAttachBtn: document.getElementById('composeAttachBtn'),
    composeDiscardBtn: document.getElementById('composeDiscardBtn'),
    composeSendBtn: document.getElementById('composeSendBtn'),

    // Toast
    toast: document.getElementById('toast')
  };
}

function setupEventListeners() {
  // Settings Button
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.closeSettingsBtn.addEventListener('click', closeSettings);
  elements.settingsOverlay.addEventListener('click', closeSettings);

  // Account Selector
  elements.accountSelector.addEventListener('click', toggleAccountDropdown);

  // Category Items
  document.querySelectorAll('.category-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      currentCategory = item.dataset.category;
      updateHeader();
      renderEmailList();
    });
  });

  // Analyze All Button
  elements.analyzeAllBtn.addEventListener('click', analyzeAllEmails);

  // Header Actions
  elements.refreshBtn.addEventListener('click', loadEmails);
  elements.composeBtn.addEventListener('click', composeNewEmail);

  // Email Actions
  elements.replyBtn.addEventListener('click', openReplyPanel);
  elements.analyzeBtn.addEventListener('click', analyzeCurrentEmail);
  elements.archiveBtn.addEventListener('click', archiveCurrentEmail);
  elements.starBtn.addEventListener('click', starCurrentEmail);
  elements.deleteBtn.addEventListener('click', deleteCurrentEmail);

  // Analysis Panel
  elements.closeAnalysisBtn.addEventListener('click', () => {
    elements.analysisPanel.classList.add('hidden');
  });

  // Reply Panel
  elements.closeReplyBtn.addEventListener('click', closeReplyPanel);
  elements.refreshQuickReplies.addEventListener('click', loadQuickReplies);
  elements.generateReplyBtn.addEventListener('click', generateKiReply);
  elements.sendReplyBtn.addEventListener('click', sendReply);
  elements.discardReplyBtn.addEventListener('click', closeReplyPanel);

  // Reply Type Buttons
  document.querySelectorAll('.reply-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.reply-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReplyType = btn.dataset.type;
    });
  });

  // Dashboard Quick Actions
  elements.briefingBtn.addEventListener('click', showBriefing);
  elements.emptySpamBtn.addEventListener('click', emptySpam);
  elements.archiveNewsletterBtn.addEventListener('click', archiveNewsletters);
  elements.markAllReadBtn.addEventListener('click', markAllAsRead);

  // Auto-Reply Toggle
  elements.autoReplyToggle.addEventListener('click', toggleAutoReply);

  // Settings Toggles
  elements.autoClassifyToggle.addEventListener('click', () => {
    autoClassifyEnabled = !autoClassifyEnabled;
    elements.autoClassifyToggle.classList.toggle('active', autoClassifyEnabled);
  });

  elements.autoReplySettingToggle.addEventListener('click', () => {
    autoReplyEnabled = !autoReplyEnabled;
    elements.autoReplySettingToggle.classList.toggle('active', autoReplyEnabled);
    elements.autoReplyToggle.classList.toggle('active', autoReplyEnabled);
  });

  // Clear All Data
  document.getElementById('clearAllDataBtn')?.addEventListener('click', clearAllData);

  // Add Account
  elements.addAccountBtn.addEventListener('click', openAddAccountModal);
  elements.closeAddAccountBtn.addEventListener('click', closeAddAccountModal);

  // Provider Buttons
  document.querySelector('[data-provider="gmail"]').addEventListener('click', showGmailSetup);
  document.querySelector('[data-provider="outlook"]').addEventListener('click', showOutlookSetup);
  document.querySelector('[data-provider="imap"]').addEventListener('click', showImapSetup);

  // Back Buttons
  document.getElementById('backFromGmailBtn')?.addEventListener('click', backToAccountOptions);
  document.getElementById('backFromOutlookBtn')?.addEventListener('click', backToAccountOptions);
  document.getElementById('backFromImapBtn')?.addEventListener('click', backToAccountOptions);

  // Connect Buttons
  document.getElementById('connectGmailBtn')?.addEventListener('click', connectGmail);
  document.getElementById('connectOutlookBtn')?.addEventListener('click', connectOutlook);
  document.getElementById('testImapBtn')?.addEventListener('click', testImapConnection);
  document.getElementById('connectImapBtn')?.addEventListener('click', connectImap);

  // IMAP Provider Change
  document.getElementById('imapProvider')?.addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    document.getElementById('imapCustomFields').classList.toggle('hidden', !isCustom);
  });

  // Close Analysis Modal
  elements.closeAnalysisModalBtn?.addEventListener('click', () => {
    elements.analysisModal.classList.add('hidden');
  });

  // Close Briefing Modal
  elements.closeBriefingBtn?.addEventListener('click', () => {
    elements.briefingModal.classList.add('hidden');
  });

  // Compose Modal
  elements.closeComposeBtn?.addEventListener('click', closeComposeModal);
  elements.composeDiscardBtn?.addEventListener('click', closeComposeModal);
  elements.composeSendBtn?.addEventListener('click', sendNewEmail);
  elements.composeAiBtn?.addEventListener('click', generateComposeAI);
  elements.composeAttachBtn?.addEventListener('click', addComposeAttachment);

  // Click outside to close dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.account-selector') && !e.target.closest('.account-dropdown-menu')) {
      elements.accountDropdownMenu.classList.add('hidden');
    }
  });
}

// =============================================================================
// SETTINGS PANEL
// =============================================================================

function openSettings() {
  elements.settingsOverlay.classList.remove('hidden');
  elements.settingsPanel.classList.add('open');
  renderAccountCards();
}

function closeSettings() {
  elements.settingsOverlay.classList.add('hidden');
  elements.settingsPanel.classList.remove('open');
}

function renderAccountCards() {
  elements.accountCardsContainer.innerHTML = accounts.map(account => `
    <div class="account-card" data-id="${account.id}">
      <div class="account-card-header">
        <div class="account-card-avatar ${account.provider}">${account.email?.[0]?.toUpperCase() || '?'}</div>
        <div class="account-card-info">
          <h4>${account.name || account.email}</h4>
          <p>${account.email}</p>
        </div>
      </div>
      <div class="account-card-status">
        <div class="status-dot ${account.connected ? 'connected' : 'error'}"></div>
        <span>${account.connected ? 'Verbunden' : 'Nicht verbunden'}</span>
      </div>
      <div class="account-card-actions">
        <button class="account-card-btn secondary" onclick="syncAccount('${account.id}')">Sync</button>
        <button class="account-card-btn danger" onclick="removeAccount('${account.id}')">Entfernen</button>
      </div>
    </div>
  `).join('') || '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Keine Konten verbunden</p>';
}

// =============================================================================
// ACCOUNT DROPDOWN
// =============================================================================

function toggleAccountDropdown() {
  elements.accountDropdownMenu.classList.toggle('hidden');
}

function selectAccount(accountId) {
  selectedAccountId = accountId;

  // Update dropdown items
  document.querySelectorAll('.account-dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.account === accountId);
  });

  // Update selector display
  if (accountId === 'all') {
    elements.currentAccountName.textContent = 'Alle Konten';
    elements.currentAccountEmail.textContent = 'Unified Inbox';
    elements.currentAccountAvatar.textContent = '✉';
  } else {
    const account = accounts.find(a => a.id === accountId);
    if (account) {
      elements.currentAccountName.textContent = account.name || account.email;
      elements.currentAccountEmail.textContent = account.email;
      elements.currentAccountAvatar.textContent = account.email?.[0]?.toUpperCase() || '?';
    }
  }

  elements.accountDropdownMenu.classList.add('hidden');
  loadEmails();
}

function updateAccountDropdown() {
  const dropdown = elements.accountDropdownMenu;

  // Keep the "All Accounts" item, remove others
  const allItem = dropdown.querySelector('[data-account="all"]');
  dropdown.innerHTML = '';
  dropdown.appendChild(allItem);

  // Add account items
  accounts.forEach(account => {
    const item = document.createElement('div');
    item.className = 'account-dropdown-item';
    item.dataset.account = account.id;
    item.innerHTML = `
      <div class="dropdown-avatar ${account.provider}">${account.email?.[0]?.toUpperCase() || '?'}</div>
      <div class="dropdown-info">
        <div class="dropdown-name">${account.name || account.email}</div>
        <div class="dropdown-email">${account.email}</div>
      </div>
    `;
    item.addEventListener('click', () => selectAccount(account.id));
    dropdown.appendChild(item);
  });

  // Re-add click handler for all accounts
  allItem.addEventListener('click', () => selectAccount('all'));
}

// =============================================================================
// EMAIL LOADING
// =============================================================================

async function loadEmails() {
  showLoading();

  try {
    let result;

    if (selectedAccountId === 'all') {
      result = await ipcRenderer.invoke('email:getUnifiedInbox', 30);
    } else if (selectedAccountId === 'imap') {
      return loadImapEmails();
    } else {
      result = await ipcRenderer.invoke('email:getEmailsFromAccount', selectedAccountId, 30);
    }

    // Fallback
    if (!result || result.error === 'Provider manager not initialized') {
      result = await ipcRenderer.invoke('email:getRecent', 30);
    }

    if (result.success) {
      emails = result.emails || [];

      // Automatische Klassifizierung wenn aktiviert
      if (autoClassifyEnabled && emails.length > 0) {
        await classifyAllEmails();
      }

      updateStats();
      updateCategoryCounts();
      renderEmailList();
    } else {
      showError(result.error || 'Fehler beim Laden');
    }
  } catch (error) {
    console.error('Error loading emails:', error);
    showError('Verbindungsfehler');
  }
}

// Intelligente E-Mail-Klassifizierung
async function classifyAllEmails() {
  if (emails.length === 0) {
    console.log('[CLASSIFY] No emails to classify');
    return;
  }

  console.log('[CLASSIFY] Starting classification for', emails.length, 'emails');

  try {
    // Bereite E-Mails für Klassifizierung vor
    const emailsForClassification = emails.map(e => ({
      id: e.id,
      from: { address: e.from, name: e.fromName },
      subject: e.subject,
      text: e.body || e.snippet || '',
      date: e.date,
      to: e.to || [],
      cc: e.cc || [],
      attachments: e.attachments || []
    }));

    console.log('[CLASSIFY] Calling IPC email:classifyBatch');
    const result = await ipcRenderer.invoke('email:classifyBatch', emailsForClassification);
    console.log('[CLASSIFY] IPC result:', result);

    if (result.success && result.classifications) {
      // Speichere Klassifizierungen
      result.classifications.forEach((classification, index) => {
        const email = emails[index];
        if (email && classification) {
          emailClassifications[email.id] = classification;

          // Update E-Mail mit Klassifizierung
          email.kategorie = classification.kategorie;
          email.confidence = classification.confidence;
          email.tags = classification.tags || [];
          email.zusammenfassung = classification.zusammenfassung;
          email.aktion = classification.aktion;

          // Mapping zu bestehenden Feldern
          email.isImportant = classification.kategorie === 'essenz' || classification.kategorie === 'wichtig';
          email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
          email.isSpam = classification.kategorie === 'spam';
          email.isNewsletter = classification.kategorie === 'newsletter';
          email.canAutoReply = classification.autoAntwortMöglich;
        }
      });

      // Aktualisiere Statistiken
      classifierStats = await ipcRenderer.invoke('email:classifierStats');

      // Log Klassifizierungsergebnisse
      const kategorieStats = {};
      emails.forEach(e => {
        const kat = e.kategorie || 'unclassified';
        kategorieStats[kat] = (kategorieStats[kat] || 0) + 1;
      });
      console.log('[CLASSIFY] Ergebnisse:', kategorieStats);
      console.log('[CLASSIFY] Stats:', classifierStats);

      // Toast mit Ergebnis zeigen
      const essenzCount = emails.filter(e => e.kategorie === 'essenz').length;
      const wichtigCount = emails.filter(e => e.kategorie === 'wichtig').length;
      if (essenzCount > 0 || wichtigCount > 0) {
        showToast(`${essenzCount} Essenz, ${wichtigCount} Wichtig klassifiziert`);
      }

      // WICHTIG: UI aktualisieren nach Klassifizierung!
      renderEmailList();
      updateCategoryCounts();
      console.log('[CLASSIFY] UI aktualisiert');
    } else {
      console.error('[CLASSIFY] Failed:', result.error);
    }
  } catch (error) {
    console.error('[CLASSIFY] Fehler bei Batch-Klassifizierung:', error);
  }
}

async function loadImapEmails() {
  try {
    const result = await ipcRenderer.invoke('imap:getEmails', 30);

    if (result.success) {
      emails = (result.emails || []).map(email => ({
        id: email.uid.toString(),
        uid: email.uid,
        from: email.from,
        fromName: extractName(email.from),
        subject: email.subject,
        date: email.date ? new Date(email.date).getTime() : Date.now(),
        dateFormatted: formatDate(email.date ? new Date(email.date).getTime() : Date.now()),
        snippet: '',
        body: '',
        isUnread: !email.isRead,
        isStarred: email.isStarred,
        provider: 'imap'
      }));

      updateStats();
      updateCategoryCounts();
      renderEmailList();
    } else {
      showError(result.error || 'Fehler beim Laden');
    }
  } catch (error) {
    console.error('Error loading IMAP emails:', error);
    showError('Verbindungsfehler: ' + error.message);
  }
}

async function loadAccounts() {
  try {
    const result = await ipcRenderer.invoke('email:getAccounts');
    if (result.success) {
      accounts = result.accounts || [];
      updateAccountDropdown();
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
  }
}

function showLoading() {
  elements.loadingState.classList.remove('hidden');
  elements.emptyState.classList.add('hidden');
  elements.emailItems.innerHTML = '';
}

function showError(message) {
  elements.loadingState.classList.add('hidden');
  elements.emptyState.innerHTML = `<span style="font-size: 48px;">❌</span><p>${message}</p>`;
  elements.emptyState.classList.remove('hidden');
}

// =============================================================================
// EMAIL RENDERING
// =============================================================================

function renderEmailList() {
  elements.loadingState.classList.add('hidden');

  // Filter by category
  let filteredEmails = filterByCategory([...emails]);

  elements.emailItems.innerHTML = '';

  if (filteredEmails.length === 0) {
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');

  filteredEmails.forEach(email => {
    const item = createEmailItem(email);
    elements.emailItems.appendChild(item);
  });
}

function filterByCategory(emailList) {
  switch (currentCategory) {
    case 'important':
      // Essenz + Wichtig (aus Klassifizierung)
      return emailList.filter(e =>
        e.kategorie === 'essenz' ||
        e.kategorie === 'wichtig' ||
        e.isStarred
      );
    case 'action':
      // Aktion nötig (aus Tags)
      return emailList.filter(e =>
        e.needsAction ||
        e.tags?.includes('ANTWORT_NÖTIG') ||
        e.aktion === 'antworten' ||
        e.aktion === 'entscheiden'
      );
    case 'inbox':
      // Alles außer Spam und Newsletter
      return emailList.filter(e =>
        e.kategorie !== 'spam' &&
        e.kategorie !== 'newsletter' &&
        !e.isSpam &&
        !e.isNewsletter
      );
    case 'newsletter':
      return emailList.filter(e => e.kategorie === 'newsletter' || e.isNewsletter);
    case 'sent':
      return emailList.filter(e => e.isSent);
    case 'spam':
      return emailList.filter(e => e.kategorie === 'spam' || e.isSpam);
    case 'essenz':
      // Nur Essenz
      return emailList.filter(e => e.kategorie === 'essenz');
    case 'info':
      // Nur Info
      return emailList.filter(e => e.kategorie === 'info');
    default:
      return emailList;
  }
}

function createEmailItem(email) {
  const item = document.createElement('div');
  item.className = 'email-item';
  item.dataset.id = email.id;
  item.dataset.accountId = email.accountId || '';

  if (email.isUnread) item.classList.add('unread');
  if (email.kategorie === 'essenz' || email.needsAction) item.classList.add('urgent');
  if (currentEmail && currentEmail.id === email.id) item.classList.add('active');

  // Priority dot basierend auf Klassifizierung
  let priorityClass = 'normal';
  if (email.kategorie === 'essenz') priorityClass = 'high';
  else if (email.kategorie === 'wichtig') priorityClass = 'medium';
  else if (email.kategorie === 'spam' || email.kategorie === 'newsletter') priorityClass = 'low';

  // Tags basierend auf Klassifizierung
  let tagsHtml = '';
  const tags = [];

  // Kategorie-Tag
  if (email.kategorie && KATEGORIE_MAP[email.kategorie]) {
    const kat = KATEGORIE_MAP[email.kategorie];
    tags.push(`<span class="email-tag kategorie" style="background: ${kat.color}20; color: ${kat.color}">${kat.icon} ${kat.name}</span>`);
  }

  // Aktions-Tags
  if (email.tags?.includes('ANTWORT_NÖTIG')) {
    tags.push('<span class="email-tag action">↩️ Antwort nötig</span>');
  }
  if (email.tags?.includes('DEADLINE')) {
    tags.push('<span class="email-tag deadline">⏰ Deadline</span>');
  }
  if (email.tags?.includes('GELD')) {
    tags.push('<span class="email-tag money">💰 Rechnung</span>');
  }
  if (email.canAutoReply) {
    tags.push('<span class="email-tag auto">🤖 Auto-Antwort</span>');
  }

  if (tags.length > 0) {
    tagsHtml = `<div class="email-tags">${tags.join('')}</div>`;
  }

  // Confidence-Indikator (nur wenn Klassifizierung vorhanden)
  let confidenceHtml = '';
  if (email.confidence) {
    const confColor = email.confidence >= 80 ? '#10b981' : email.confidence >= 60 ? '#f59e0b' : '#ef4444';
    confidenceHtml = `<span class="email-confidence" style="color: ${confColor}" title="Konfidenz: ${email.confidence}%">●</span>`;
  }

  item.innerHTML = `
    <div class="email-priority ${priorityClass}"></div>
    <div class="email-content">
      <div class="email-header">
        <span class="email-sender">${escapeHtml(email.fromName || email.from)}</span>
        <span class="email-time">${confidenceHtml}${email.dateFormatted || formatDate(email.date)}</span>
      </div>
      <div class="email-subject">${escapeHtml(email.subject)}</div>
      <div class="email-preview">${escapeHtml(email.zusammenfassung || email.snippet || '')}</div>
      ${tagsHtml}
    </div>
  `;

  item.addEventListener('click', () => selectEmail(email));

  return item;
}

// =============================================================================
// EMAIL SELECTION & DETAIL
// =============================================================================

async function selectEmail(email) {
  currentEmail = email;

  // Tracking: E-Mail geöffnet (für Lernsystem)
  if (autoClassifyEnabled) {
    ipcRenderer.invoke('email:trackOpened', {
      id: email.id,
      from: { address: email.from, name: email.fromName },
      subject: email.subject
    }).catch(err => console.warn('Track opened error:', err));
  }

  // Update list selection
  document.querySelectorAll('.email-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === email.id);
  });

  // Show detail
  elements.detailPlaceholder.classList.add('hidden');
  elements.detailContent.classList.remove('hidden');
  elements.analysisPanel.classList.add('hidden');
  elements.replyPanel.classList.add('hidden');

  elements.detailSubject.textContent = email.subject;
  elements.detailFrom.textContent = email.from;
  elements.detailDate.textContent = formatFullDate(email.date);

  // Load full content for IMAP emails
  if (email.provider === 'imap' && email.uid && !email.body) {
    elements.detailBody.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Lade Inhalt...</span></div>';

    try {
      const fullEmail = await ipcRenderer.invoke('imap:getEmailContent', email.uid);
      if (fullEmail && !fullEmail.error) {
        email.body = fullEmail.text || fullEmail.html || '';
        if (fullEmail.html) {
          elements.detailBody.innerHTML = fullEmail.html;
        } else {
          elements.detailBody.textContent = fullEmail.text || 'Kein Inhalt';
        }

        // Mark as read
        if (email.isUnread) {
          await ipcRenderer.invoke('imap:markAsRead', email.uid);
          email.isUnread = false;
          updateStats();
          renderEmailList();
        }
      } else {
        elements.detailBody.textContent = fullEmail.error || 'Fehler beim Laden';
      }
    } catch (err) {
      elements.detailBody.textContent = 'Fehler: ' + err.message;
    }
  } else {
    elements.detailBody.textContent = email.body || email.snippet || 'Kein Inhalt';
  }

  // Update action buttons
  elements.starBtn.innerHTML = email.isStarred ? '⭐ Markiert' : '☆ Markieren';

  // Show attachments if any
  if (email.attachments && email.attachments.length > 0) {
    elements.attachmentsSection.classList.remove('hidden');
    elements.attachmentsList.innerHTML = email.attachments.map(att => `
      <div class="attachment-item" onclick="downloadAttachment('${att.id}')">
        <span class="attachment-icon">📎</span>
        <div>
          <span class="attachment-name">${escapeHtml(att.filename)}</span>
          <span class="attachment-size">${formatSize(att.size)}</span>
        </div>
      </div>
    `).join('');
  } else {
    elements.attachmentsSection.classList.add('hidden');
  }
}

// =============================================================================
// EMAIL ACTIONS
// =============================================================================

async function analyzeCurrentEmail() {
  if (!currentEmail) return;

  elements.analysisPanel.classList.remove('hidden');
  elements.replyPanel.classList.add('hidden');
  elements.analysisContent.innerHTML = `
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
      elements.analysisContent.innerHTML = `<div class="empty-state">Analyse fehlgeschlagen: ${result.error || 'Unbekannter Fehler'}</div>`;
    }
  } catch (error) {
    console.error('Analysis error:', error);
    elements.analysisContent.innerHTML = `<div class="empty-state">Fehler bei der Analyse</div>`;
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

  elements.analysisContent.innerHTML = `
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
      <div class="analysis-label">Empfohlene Aktion</div>
      <div class="analysis-value">${escapeHtml(analysis.suggestedAction || 'Keine')}</div>
    </div>
  `;
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

    elements.starBtn.innerHTML = currentEmail.isStarred ? '⭐ Markiert' : '☆ Markieren';
    renderEmailList();
  } catch (error) {
    console.error('Error starring email:', error);
    showToast('Fehler beim Markieren', 'error');
  }
}

async function archiveCurrentEmail() {
  if (!currentEmail) return;

  try {
    await ipcRenderer.invoke('email:archive', currentEmail.id);

    emails = emails.filter(e => e.id !== currentEmail.id);
    currentEmail = null;

    renderEmailList();
    elements.detailPlaceholder.classList.remove('hidden');
    elements.detailContent.classList.add('hidden');
    showToast('E-Mail archiviert');
  } catch (error) {
    console.error('Error archiving email:', error);
    showToast('Fehler beim Archivieren', 'error');
  }
}

async function deleteCurrentEmail() {
  if (!currentEmail) return;

  if (!confirm('E-Mail wirklich löschen?')) return;

  try {
    // Tracking: Gelöscht ohne Lesen (für Spam-Lernen)
    if (autoClassifyEnabled && currentEmail.isUnread) {
      ipcRenderer.invoke('email:trackDeletedUnread', {
        id: currentEmail.id,
        from: { address: currentEmail.from, name: currentEmail.fromName },
        subject: currentEmail.subject
      }).catch(err => console.warn('Track deleted error:', err));
    }

    await ipcRenderer.invoke('email:delete', currentEmail.id);

    emails = emails.filter(e => e.id !== currentEmail.id);
    delete emailClassifications[currentEmail.id];
    currentEmail = null;

    renderEmailList();
    elements.detailPlaceholder.classList.remove('hidden');
    elements.detailContent.classList.add('hidden');
    showToast('E-Mail gelöscht');
  } catch (error) {
    console.error('Error deleting email:', error);
    showToast('Fehler beim Löschen', 'error');
  }
}

// =============================================================================
// REPLY PANEL
// =============================================================================

function openReplyPanel() {
  if (!currentEmail) return;

  elements.replyPanel.classList.remove('hidden');
  elements.analysisPanel.classList.add('hidden');
  elements.replyToAddress.textContent = currentEmail.from;
  elements.replyText.value = '';

  loadQuickReplies();
}

function closeReplyPanel() {
  elements.replyPanel.classList.add('hidden');
  elements.replyText.value = '';
  elements.quickRepliesList.innerHTML = '';
}

async function loadQuickReplies() {
  if (!currentEmail) return;

  elements.quickRepliesList.innerHTML = `
    <div class="quick-reply-loading">
      <div class="spinner small"></div>
      Generiere Vorschläge...
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
      elements.quickRepliesList.innerHTML = `<div style="color: var(--text-muted); padding: 12px; text-align: center;">Keine Vorschläge verfügbar</div>`;
    }
  } catch (error) {
    console.error('Quick replies error:', error);
    elements.quickRepliesList.innerHTML = `<div style="color: var(--text-muted); padding: 12px; text-align: center;">Fehler beim Laden</div>`;
  }
}

function renderQuickReplies(replies) {
  elements.quickRepliesList.innerHTML = replies.map((reply, index) => `
    <button class="quick-reply-btn" data-index="${index}">${escapeHtml(reply)}</button>
  `).join('');

  elements.quickRepliesList.querySelectorAll('.quick-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = replies[parseInt(btn.dataset.index)];
      elements.replyText.value = text;
    });
  });
}

async function generateKiReply() {
  if (!currentEmail || isGeneratingReply) return;

  isGeneratingReply = true;
  elements.generateReplyBtn.innerHTML = '<div class="spinner small"></div> Generiere...';
  elements.generateReplyBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('email:generateReply', {
      originalText: currentEmail.body || currentEmail.snippet,
      originalSubject: currentEmail.subject,
      originalSender: currentEmail.fromName || currentEmail.from,
      replyType: currentReplyType,
      context: elements.replyText.value || ''
    });

    if (result.success && result.reply) {
      elements.replyText.value = result.reply;
    } else {
      showToast('Fehler beim Generieren: ' + (result.error || 'Unbekannter Fehler'), 'error');
    }
  } catch (error) {
    console.error('Generate reply error:', error);
    showToast('Fehler beim Generieren', 'error');
  } finally {
    isGeneratingReply = false;
    elements.generateReplyBtn.innerHTML = '🤖 KI generieren';
    elements.generateReplyBtn.disabled = false;
  }
}

async function sendReply() {
  if (!currentEmail || !elements.replyText.value.trim()) {
    showToast('Bitte schreibe zuerst eine Antwort', 'warning');
    return;
  }

  elements.sendReplyBtn.innerHTML = '📤 Sende...';
  elements.sendReplyBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('email:sendReply', currentEmail.id, elements.replyText.value);

    if (result.success) {
      closeReplyPanel();
      showToast('Antwort gesendet!');

      // Tracking: E-Mail beantwortet (für Lernsystem)
      if (autoClassifyEnabled) {
        ipcRenderer.invoke('email:trackReplied', {
          id: currentEmail.id,
          from: { address: currentEmail.from, name: currentEmail.fromName },
          subject: currentEmail.subject
        }).catch(err => console.warn('Track replied error:', err));
      }

      if (currentEmail.isUnread) {
        await ipcRenderer.invoke('email:markAsRead', currentEmail.id);
        currentEmail.isUnread = false;
        updateStats();
        renderEmailList();
      }
    } else {
      showToast('Fehler beim Senden: ' + (result.error || 'Unbekannter Fehler'), 'error');
    }
  } catch (error) {
    console.error('Send reply error:', error);
    showToast('Fehler beim Senden', 'error');
  } finally {
    elements.sendReplyBtn.innerHTML = '📤 Senden';
    elements.sendReplyBtn.disabled = false;
  }
}

// =============================================================================
// DASHBOARD & STATS
// =============================================================================

function updateStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayEmails = emails.filter(e => e.date && new Date(e.date) >= today);
  elements.statReceived.textContent = todayEmails.length;
  elements.statReplied.textContent = emails.filter(e => e.hasReply).length || 0;

  // Update header subtitle
  const unreadCount = emails.filter(e => e.isUnread).length;
  elements.headerSubtitle.textContent = `${emails.length} E-Mails, ${unreadCount} ungelesen`;
}

function updateCategoryCounts() {
  // Inbox (alles außer Spam und Newsletter)
  const inboxCount = emails.filter(e =>
    e.kategorie !== 'spam' && e.kategorie !== 'newsletter' &&
    !e.isSpam && !e.isNewsletter
  ).length;
  document.getElementById('catInbox').textContent = `${inboxCount} E-Mails`;

  // Important (Essenz + Wichtig)
  const essenzCount = emails.filter(e => e.kategorie === 'essenz').length;
  const wichtigCount = emails.filter(e => e.kategorie === 'wichtig').length;
  const importantCount = essenzCount + wichtigCount + emails.filter(e => e.isStarred && e.kategorie !== 'essenz' && e.kategorie !== 'wichtig').length;
  document.getElementById('catImportant').textContent = `${importantCount} E-Mails`;
  if (essenzCount > 0) {
    document.getElementById('badgeImportant').textContent = essenzCount;
    document.getElementById('badgeImportant').classList.remove('hidden');
  } else if (importantCount > 0) {
    document.getElementById('badgeImportant').textContent = importantCount;
    document.getElementById('badgeImportant').classList.remove('hidden');
  } else {
    document.getElementById('badgeImportant').classList.add('hidden');
  }

  // Action (Antwort nötig, Entscheidung)
  const actionCount = emails.filter(e =>
    e.needsAction ||
    e.tags?.includes('ANTWORT_NÖTIG') ||
    e.aktion === 'antworten' ||
    e.aktion === 'entscheiden'
  ).length;
  document.getElementById('catAction').textContent = `${actionCount} E-Mails`;
  if (actionCount > 0) {
    document.getElementById('badgeAction').textContent = actionCount;
    document.getElementById('badgeAction').classList.remove('hidden');
  } else {
    document.getElementById('badgeAction').classList.add('hidden');
  }

  // Newsletter
  const newsletterCount = emails.filter(e => e.kategorie === 'newsletter' || e.isNewsletter).length;
  document.getElementById('catNewsletter').textContent = `${newsletterCount} E-Mails`;

  // Spam
  const spamCount = emails.filter(e => e.kategorie === 'spam' || e.isSpam).length;
  document.getElementById('catSpam').textContent = `${spamCount} E-Mails`;
  elements.spamCount.textContent = spamCount;

  // Sent
  const sentCount = emails.filter(e => e.isSent).length;
  document.getElementById('catSent').textContent = `${sentCount} E-Mails`;

  // Update Auto-Reply count (E-Mails die automatisch beantwortet werden können)
  const autoReplyCount = emails.filter(e => e.canAutoReply).length;
  elements.autoReplyCount.textContent = autoReplyCount;
}

function updateHeader() {
  const titles = {
    inbox: 'Posteingang',
    important: 'Wichtig',
    action: 'Aktion erforderlich',
    newsletter: 'Newsletter',
    sent: 'Gesendet',
    spam: 'Spam'
  };
  elements.headerTitle.textContent = titles[currentCategory] || 'Posteingang';
}

function renderChart() {
  // Sample data for the week
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const data = [
    { spam: 5, news: 8, normal: 15, important: 3 },
    { spam: 3, news: 12, normal: 20, important: 5 },
    { spam: 7, news: 6, normal: 18, important: 4 },
    { spam: 4, news: 10, normal: 22, important: 6 },
    { spam: 2, news: 9, normal: 16, important: 3 },
    { spam: 1, news: 4, normal: 8, important: 1 },
    { spam: 2, news: 5, normal: 10, important: 2 }
  ];

  const maxTotal = Math.max(...data.map(d => d.spam + d.news + d.normal + d.important));

  elements.chartBars.innerHTML = data.map((d, i) => {
    const total = d.spam + d.news + d.normal + d.important;
    const scale = 100 / maxTotal;

    return `
      <div class="chart-row">
        <span class="chart-label">${days[i]}</span>
        <div class="chart-bar-container">
          <div class="chart-bar spam" style="width: ${d.spam * scale}%"></div>
          <div class="chart-bar news" style="width: ${d.news * scale}%"></div>
          <div class="chart-bar normal" style="width: ${d.normal * scale}%"></div>
          <div class="chart-bar important" style="width: ${d.important * scale}%"></div>
        </div>
        <span class="chart-total">${total}</span>
      </div>
    `;
  }).join('');
}

// =============================================================================
// QUICK ACTIONS
// =============================================================================

async function showBriefing() {
  elements.briefingModal.classList.remove('hidden');
  elements.briefingContent.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Erstelle Briefing...</span>
    </div>
  `;

  try {
    const briefingEmails = await ipcRenderer.invoke('email:getForBriefing', 20);

    if (!briefingEmails.success) {
      elements.briefingContent.innerHTML = `<div class="empty-state">Fehler: ${briefingEmails.error}</div>`;
      return;
    }

    const result = await ipcRenderer.invoke('email:briefing', briefingEmails.emails);

    if (result.success) {
      renderBriefing(result);
    } else {
      elements.briefingContent.innerHTML = `<div class="empty-state">Briefing fehlgeschlagen: ${result.error}</div>`;
    }
  } catch (error) {
    console.error('Briefing error:', error);
    elements.briefingContent.innerHTML = `<div class="empty-state">Fehler beim Erstellen</div>`;
  }
}

function renderBriefing(result) {
  const stats = result.stats || { total: 0, unread: 0, urgent: 0 };

  elements.briefingContent.innerHTML = `
    <div class="briefing-text">${escapeHtml(result.briefing || 'Kein Briefing verfügbar')}</div>

    <div class="briefing-stats">
      <div class="briefing-stat">
        <div class="briefing-stat-value">${stats.total}</div>
        <div class="briefing-stat-label">Gesamt</div>
      </div>
      <div class="briefing-stat">
        <div class="briefing-stat-value">${stats.unread}</div>
        <div class="briefing-stat-label">Ungelesen</div>
      </div>
      <div class="briefing-stat">
        <div class="briefing-stat-value">${stats.urgent}</div>
        <div class="briefing-stat-label">Dringend</div>
      </div>
    </div>
  `;
}

async function analyzeAllEmails() {
  elements.analysisModal.classList.remove('hidden');
  elements.analysisProgressFill.style.width = '0%';
  elements.analysisProgressText.textContent = 'Klassifiziere E-Mails...';

  try {
    // Starte Klassifizierung
    const startTime = Date.now();

    // Progress-Animation
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 5, 90);
      elements.analysisProgressFill.style.width = `${progress}%`;
    }, 100);

    // Klassifiziere alle E-Mails
    await classifyAllEmails();

    clearInterval(progressInterval);
    elements.analysisProgressFill.style.width = '100%';

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    elements.analysisProgressText.textContent = `Analyse abgeschlossen in ${duration}s!`;

    // Zähle Ergebnisse basierend auf echten Klassifizierungen
    const stats = {
      spam: emails.filter(e => e.kategorie === 'spam').length,
      important: emails.filter(e => e.kategorie === 'essenz' || e.kategorie === 'wichtig').length,
      action: emails.filter(e => e.needsAction).length,
      auto: emails.filter(e => e.canAutoReply).length
    };

    document.getElementById('resultSpam').textContent = stats.spam;
    document.getElementById('resultImportant').textContent = stats.important;
    document.getElementById('resultAction').textContent = stats.action;
    document.getElementById('resultAuto').textContent = stats.auto;

    // Aktualisiere UI
    updateCategoryCounts();
    renderEmailList();

    // Zeige Classifier-Statistiken
    if (classifierStats?.stats) {
      console.log('[CLASSIFIER] Stufe 1:', classifierStats.stats.stufe1);
      console.log('[CLASSIFIER] Stufe 2:', classifierStats.stats.stufe2);
      console.log('[CLASSIFIER] Stufe 3:', classifierStats.stats.stufe3);
      console.log('[CLASSIFIER] Kosten:', classifierStats.stats.kostenGesamt);
    }

  } catch (error) {
    console.error('[CLASSIFIER] Analyse-Fehler:', error);
    elements.analysisProgressText.textContent = 'Analyse fehlgeschlagen: ' + error.message;
  }
}

async function emptySpam() {
  if (!confirm('Alle Spam-E-Mails löschen?')) return;

  try {
    await ipcRenderer.invoke('email:emptySpam');
    emails = emails.filter(e => !e.isSpam);
    updateCategoryCounts();
    renderEmailList();
    showToast('Spam geleert');
  } catch (error) {
    console.error('Error emptying spam:', error);
    showToast('Fehler beim Leeren', 'error');
  }
}

async function archiveNewsletters() {
  try {
    await ipcRenderer.invoke('email:archiveNewsletters');
    emails = emails.filter(e => !e.isNewsletter);
    updateCategoryCounts();
    renderEmailList();
    showToast('Newsletter archiviert');
  } catch (error) {
    console.error('Error archiving newsletters:', error);
    showToast('Fehler beim Archivieren', 'error');
  }
}

async function markAllAsRead() {
  try {
    await ipcRenderer.invoke('email:markAllAsRead');
    emails.forEach(e => e.isUnread = false);
    updateStats();
    renderEmailList();
    showToast('Alle als gelesen markiert');
  } catch (error) {
    console.error('Error marking all as read:', error);
    showToast('Fehler', 'error');
  }
}

function toggleAutoReply() {
  autoReplyEnabled = !autoReplyEnabled;
  elements.autoReplyToggle.classList.toggle('active', autoReplyEnabled);
  elements.autoReplySettingToggle.classList.toggle('active', autoReplyEnabled);
  showToast(autoReplyEnabled ? 'Auto-Antworten aktiviert' : 'Auto-Antworten deaktiviert');
}

// =============================================================================
// ACCOUNT MANAGEMENT
// =============================================================================

function openAddAccountModal() {
  elements.addAccountModal.classList.remove('hidden');
  elements.accountOptions.classList.remove('hidden');
  elements.gmailSetup?.classList.add('hidden');
  elements.outlookSetup?.classList.add('hidden');
  elements.imapSetup?.classList.add('hidden');
  elements.accountLoadingState.classList.add('hidden');
}

function closeAddAccountModal() {
  elements.addAccountModal.classList.add('hidden');
}

function backToAccountOptions() {
  elements.gmailSetup?.classList.add('hidden');
  elements.outlookSetup?.classList.add('hidden');
  elements.imapSetup?.classList.add('hidden');
  elements.accountOptions.classList.remove('hidden');
}

function showGmailSetup() {
  elements.accountOptions.classList.add('hidden');
  elements.gmailSetup.classList.remove('hidden');
}

function showOutlookSetup() {
  elements.accountOptions.classList.add('hidden');
  elements.outlookSetup.classList.remove('hidden');
}

function showImapSetup() {
  elements.accountOptions.classList.add('hidden');
  elements.imapSetup.classList.remove('hidden');
}

async function connectGmail() {
  elements.gmailSetup.classList.add('hidden');
  elements.accountLoadingState.classList.remove('hidden');

  try {
    const result = await ipcRenderer.invoke('google:startAuth');

    if (result.success) {
      showToast('Gmail-Konto verbunden!');
      await loadAccounts();
      closeAddAccountModal();
      loadEmails();
    } else {
      showToast('Fehler: ' + (result.error || 'Verbindung fehlgeschlagen'), 'error');
      elements.accountLoadingState.classList.add('hidden');
      elements.gmailSetup.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Gmail auth error:', error);
    showToast('Fehler bei der Gmail-Verbindung', 'error');
    elements.accountLoadingState.classList.add('hidden');
    elements.gmailSetup.classList.remove('hidden');
  }
}

async function connectOutlook() {
  elements.outlookSetup.classList.add('hidden');
  elements.accountLoadingState.classList.remove('hidden');

  try {
    const result = await ipcRenderer.invoke('outlook:startAuth');

    if (result.success) {
      showToast('Outlook-Konto verbunden!');
      await loadAccounts();
      closeAddAccountModal();
      loadEmails();
    } else {
      showToast('Fehler: ' + (result.error || 'Verbindung fehlgeschlagen'), 'error');
      elements.accountLoadingState.classList.add('hidden');
      elements.outlookSetup.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Outlook auth error:', error);
    showToast('Fehler bei der Outlook-Verbindung', 'error');
    elements.accountLoadingState.classList.add('hidden');
    elements.outlookSetup.classList.remove('hidden');
  }
}

function getImapSettings() {
  const providerEl = document.getElementById('imapProvider');
  const emailEl = document.getElementById('imapEmail');
  const passwordEl = document.getElementById('imapPassword');
  const serverEl = document.getElementById('imapServer');
  const portEl = document.getElementById('imapPort');
  const tlsEl = document.getElementById('imapTls');

  const provider = providerEl?.value || 'custom';
  const preset = IMAP_PRESETS[provider] || {};

  return {
    provider,
    host: provider === 'custom' ? (serverEl?.value || '') : (preset.host || ''),
    port: provider === 'custom' ? parseInt(portEl?.value || '993') : (preset.port || 993),
    tls: provider === 'custom' ? (tlsEl?.checked ?? true) : (preset.tls ?? true),
    user: emailEl?.value?.trim() || '',
    password: passwordEl?.value || ''
  };
}

async function testImapConnection() {
  const settings = getImapSettings();

  if (!settings.user || !settings.password) {
    showToast('Bitte E-Mail und Passwort eingeben', 'warning');
    return;
  }

  const testBtn = document.getElementById('testImapBtn');
  testBtn.textContent = 'Teste...';
  testBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('imap:test', settings);
    if (result.success) {
      showToast('Verbindung erfolgreich!');
    } else {
      showToast('Verbindung fehlgeschlagen: ' + (result.error || 'Unbekannter Fehler'), 'error');
    }
  } catch (error) {
    showToast('Fehler: ' + error.message, 'error');
  } finally {
    testBtn.textContent = 'Verbindung testen';
    testBtn.disabled = false;
  }
}

async function connectImap() {
  const settings = getImapSettings();

  if (!settings.user || !settings.password) {
    showToast('Bitte E-Mail und Passwort eingeben', 'warning');
    return;
  }

  elements.imapSetup.classList.add('hidden');
  elements.accountLoadingState.classList.remove('hidden');

  try {
    const result = await ipcRenderer.invoke('imap:configure', settings);

    if (result.success) {
      selectedAccountId = 'imap';
      showToast('IMAP-Konto verbunden!');
      closeAddAccountModal();
      // Wichtig: Konten neu laden damit das neue Konto erscheint
      await loadAccounts();
      await loadEmails();
    } else {
      showToast('Fehler: ' + (result.error || 'Verbindung fehlgeschlagen'), 'error');
      elements.accountLoadingState.classList.add('hidden');
      elements.imapSetup.classList.remove('hidden');
    }
  } catch (error) {
    console.error('IMAP config error:', error);
    showToast('Fehler: ' + error.message, 'error');
    elements.accountLoadingState.classList.add('hidden');
    elements.imapSetup.classList.remove('hidden');
  }
}

async function syncAccount(accountId) {
  showToast('Synchronisiere...');
  await loadEmails();
  showToast('Synchronisiert!');
}

async function removeAccount(accountId) {
  if (!confirm('Konto wirklich entfernen?')) return;

  try {
    await ipcRenderer.invoke('email:removeAccount', accountId);
    accounts = accounts.filter(a => a.id !== accountId);
    updateAccountDropdown();
    renderAccountCards();
    showToast('Konto entfernt');
  } catch (error) {
    console.error('Error removing account:', error);
    showToast('Fehler beim Entfernen', 'error');
  }
}

async function clearAllData() {
  if (!confirm('ACHTUNG: Alle Daten werden unwiderruflich gelöscht!\n\nDas beinhaltet:\n- Alle E-Mail-Konten\n- Alle Klassifizierungen\n- Alle Lerndaten\n- Gmail-Verbindungen\n\nDie App wird danach neu gestartet.\n\nFortfahren?')) {
    return;
  }

  try {
    showToast('Lösche alle Daten...');
    const result = await ipcRenderer.invoke('email:clearAllData');

    if (result.success) {
      // Reset local state
      emails = [];
      emailClassifications = {};
      accounts = [];
      selectedAccountId = 'all';
      currentEmail = null;

      // Update UI
      updateAccountDropdown();
      renderAccountCards();
      renderEmailList();

      // Reset detail view
      elements.detailPlaceholder.classList.remove('hidden');
      elements.detailContent.classList.add('hidden');

      showToast('Alle Daten gelöscht! App wird neu gestartet...', 'success');

      // Close settings
      closeSettings();

      // Restart app after short delay
      setTimeout(() => {
        ipcRenderer.invoke('app:restart');
      }, 1500);
    } else {
      showToast('Fehler: ' + (result.error || 'Unbekannter Fehler'), 'error');
    }
  } catch (error) {
    console.error('Error clearing data:', error);
    showToast('Fehler beim Löschen', 'error');
  }
}

// =============================================================================
// COMPOSE EMAIL
// =============================================================================

let composeAttachments = [];

function composeNewEmail() {
  // Reset form
  elements.composeTo.value = '';
  elements.composeCc.value = '';
  elements.composeSubject.value = '';
  elements.composeBody.value = '';
  elements.composeAiPrompt.value = '';
  composeAttachments = [];
  renderComposeAttachments();

  // Show modal
  elements.composeModal.classList.remove('hidden');
  elements.composeTo.focus();
}

function closeComposeModal() {
  elements.composeModal.classList.add('hidden');
  composeAttachments = [];
}

async function sendNewEmail() {
  const to = elements.composeTo.value.trim();
  const cc = elements.composeCc.value.trim();
  const subject = elements.composeSubject.value.trim();
  const body = elements.composeBody.value.trim();

  if (!to) {
    showToast('Bitte gib einen Empfänger ein', 'warning');
    elements.composeTo.focus();
    return;
  }

  if (!subject) {
    showToast('Bitte gib einen Betreff ein', 'warning');
    elements.composeSubject.focus();
    return;
  }

  if (!body) {
    showToast('Bitte schreibe eine Nachricht', 'warning');
    elements.composeBody.focus();
    return;
  }

  elements.composeSendBtn.innerHTML = '📤 Sende...';
  elements.composeSendBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('email:sendNew', {
      accountId: selectedAccountId === 'all' ? null : selectedAccountId,
      to,
      cc: cc || null,
      subject,
      body,
      attachments: composeAttachments
    });

    if (result.success) {
      showToast('E-Mail gesendet!');
      closeComposeModal();
    } else {
      showToast('Fehler: ' + (result.error || 'Senden fehlgeschlagen'), 'error');
    }
  } catch (error) {
    console.error('Send email error:', error);
    showToast('Fehler beim Senden', 'error');
  } finally {
    elements.composeSendBtn.innerHTML = '📤 Senden';
    elements.composeSendBtn.disabled = false;
  }
}

async function generateComposeAI() {
  const prompt = elements.composeAiPrompt.value.trim();

  if (!prompt) {
    showToast('Bitte beschreibe was du schreiben möchtest', 'warning');
    elements.composeAiPrompt.focus();
    return;
  }

  elements.composeAiBtn.innerHTML = '⏳ Generiere...';
  elements.composeAiBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('email:aiCompose', {
      prompt,
      subject: elements.composeSubject.value
    });

    if (result.success) {
      if (result.subject && !elements.composeSubject.value) {
        elements.composeSubject.value = result.subject;
      }
      elements.composeBody.value = result.body || result.text || '';
      showToast('KI-Text generiert!');
    } else {
      showToast('Fehler: ' + (result.error || 'Generierung fehlgeschlagen'), 'error');
    }
  } catch (error) {
    console.error('AI compose error:', error);
    showToast('Fehler bei KI-Generierung', 'error');
  } finally {
    elements.composeAiBtn.innerHTML = 'Generieren';
    elements.composeAiBtn.disabled = false;
  }
}

async function addComposeAttachment() {
  try {
    const result = await ipcRenderer.invoke('email:selectAttachment');

    if (result.success && result.attachment) {
      composeAttachments.push(result.attachment);
      renderComposeAttachments();
      showToast('Anhang hinzugefügt');
    }
  } catch (error) {
    console.error('Attachment error:', error);
    showToast('Fehler beim Hinzufügen', 'error');
  }
}

function removeComposeAttachment(index) {
  composeAttachments.splice(index, 1);
  renderComposeAttachments();
}

function renderComposeAttachments() {
  if (composeAttachments.length === 0) {
    elements.composeAttachments.innerHTML = '';
    return;
  }

  elements.composeAttachments.innerHTML = composeAttachments.map((att, i) => `
    <div class="compose-attachment-item">
      <span>📎 ${escapeHtml(att.filename)}</span>
      <span class="remove-attachment" onclick="removeComposeAttachment(${i})">✕</span>
    </div>
  `).join('');
}

// Make removeComposeAttachment global
window.removeComposeAttachment = removeComposeAttachment;

// =============================================================================
// UTILITIES
// =============================================================================

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

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function extractName(from) {
  if (!from) return 'Unbekannt';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split('@')[0];
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  elements.toast.textContent = message;
  elements.toast.className = 'toast ' + type;
  elements.toast.classList.add('show');

  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3000);
}

// =============================================================================
// IPC LISTENERS
// =============================================================================

ipcRenderer.on('email:selectSender', async (_, senderName) => {
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
  if (emails.length > 0) {
    selectEmail(emails[0]);
  }
});

ipcRenderer.on('email:analyzeLast', async () => {
  if (emails.length > 0) {
    selectEmail(emails[0]);
    await analyzeCurrentEmail();
  }
});

ipcRenderer.on('email:showBriefing', () => {
  showBriefing();
});

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
      if (currentEmail && !elements.replyPanel.classList.contains('hidden')) {
        generateKiReply();
      } else if (currentEmail) {
        openReplyPanel();
        setTimeout(generateKiReply, 500);
      }
      break;

    case 'sendReply':
      if (!elements.replyPanel.classList.contains('hidden') && elements.replyText.value.trim()) {
        sendReply();
      }
      break;
  }
});

// Make functions globally accessible for onclick handlers
window.syncAccount = syncAccount;
window.removeAccount = removeAccount;
window.downloadAttachment = async (attachmentId) => {
  try {
    await ipcRenderer.invoke('email:downloadAttachment', attachmentId);
    showToast('Anhang heruntergeladen');
  } catch (error) {
    showToast('Fehler beim Download', 'error');
  }
};
