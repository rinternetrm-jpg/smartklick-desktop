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
let isClassifying = false;  // Flag um doppelte Klassifizierung zu verhindern
let stopAnalysisRequested = false;  // Flag um Analyse zu stoppen
let debugLog = [];  // Debug-Log für GPT-Gedanken

// Pagination State
let currentPage = 1;
let emailsPerPage = 30;
let visibleEmails = [];  // Aktuell sichtbare E-Mails (für KI-Analyse)

// Kategorie-Mapping für UI
const KATEGORIE_MAP = {
  essenz: { name: 'Essenz', icon: '🔴', color: '#ef4444' },
  wichtig: { name: 'Wichtig', icon: '🟠', color: '#f97316' },
  termine: { name: 'Termine', icon: '📅', color: '#0ea5e9' },
  rechnung: { name: 'Rechnung', icon: '📄', color: '#10b981' },
  normal: { name: 'Normal', icon: '🔵', color: '#3b82f6' },
  info: { name: 'Info', icon: 'ℹ️', color: '#6b7280' },
  newsletter: { name: 'Newsletter', icon: '📰', color: '#8b5cf6' },
  werbung: { name: 'Werbung', icon: '📢', color: '#f59e0b' },
  papierkorb: { name: 'Papierkorb', icon: '🗑️', color: '#71717a' },
  veraltet: { name: 'Veraltet', icon: '⏰', color: '#a1a1aa' }
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
  initKIFeedback();
  setupKIFeedbackListeners();
  setupKIRegelnListeners();
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
    stopAnalysisBtn: document.getElementById('stopAnalysisBtn'),

    // Header
    headerTitle: document.getElementById('headerTitle'),
    headerSubtitle: document.getElementById('headerSubtitle'),
    refreshBtn: document.getElementById('refreshBtn'),
    filterBtn: document.getElementById('filterBtn'),
    composeBtn: document.getElementById('composeBtn'),

    // Pagination
    paginationSelect: document.getElementById('paginationSelect'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    paginationInfo: document.getElementById('paginationInfo'),

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
    papierkorbCount: document.getElementById('papierkorbCount'),
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
    toast: document.getElementById('toast'),

    // Debug Modal
    debugModal: document.getElementById('debugModal'),
    debugLog: document.getElementById('debugLog'),
    debugToggleBtn: document.getElementById('debugToggleBtn'),
    closeDebugBtn: document.getElementById('closeDebugBtn'),
    closeDebugModalBtn: document.getElementById('closeDebugModalBtn'),
    clearDebugBtn: document.getElementById('clearDebugBtn')
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

  // Stop Analysis Button
  if (elements.stopAnalysisBtn) {
    elements.stopAnalysisBtn.addEventListener('click', stopAnalysis);
  }

  // Pagination
  if (elements.paginationSelect) {
    elements.paginationSelect.addEventListener('change', (e) => {
      emailsPerPage = e.target.value === 'all' ? Infinity : parseInt(e.target.value);
      currentPage = 1;
      renderEmailList();
    });
  }
  if (elements.prevPageBtn) {
    elements.prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderEmailList();
      }
    });
  }
  if (elements.nextPageBtn) {
    elements.nextPageBtn.addEventListener('click', () => {
      const filteredEmails = filterByCategory(emails);
      const totalPages = Math.ceil(filteredEmails.length / emailsPerPage);
      if (currentPage < totalPages) {
        currentPage++;
        renderEmailList();
      }
    });
  }

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
  elements.emptySpamBtn.addEventListener('click', emptyPapierkorb);
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

  // OpenAI API Key
  document.getElementById('saveApiKeyBtn')?.addEventListener('click', saveOpenAIApiKey);
  loadOpenAIApiKey(); // Lade gespeicherten Key beim Start

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

  // Debug Modal
  elements.debugToggleBtn?.addEventListener('click', openDebugModal);
  elements.closeDebugBtn?.addEventListener('click', closeDebugModal);
  elements.closeDebugModalBtn?.addEventListener('click', closeDebugModal);
  elements.clearDebugBtn?.addEventListener('click', clearDebugLog);

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
    const accountCount = accounts.length;
    elements.currentAccountEmail.textContent = accountCount > 0 ? `${accountCount} ${accountCount === 1 ? 'Konto' : 'Konten'}` : '';
    elements.currentAccountAvatar.textContent = '✉';
    // Update dropdown too
    const dropdownAllCount = document.getElementById('dropdownAllCount');
    if (dropdownAllCount) {
      dropdownAllCount.textContent = accountCount > 0 ? `${accountCount} ${accountCount === 1 ? 'Konto' : 'Konten'}` : '';
    }
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

    // Prüfe zuerst ob Konten vorhanden sind
    if (accounts.length === 0) {
      console.log('[EMAIL] Keine Konten konfiguriert');
      emails = [];
      updateStats();
      updateCategoryCounts();
      renderEmailList();
      hideLoading();
      return;
    }

    if (selectedAccountId === 'all') {
      result = await ipcRenderer.invoke('email:getUnifiedInbox', 0);
    } else if (selectedAccountId === 'imap' || selectedAccountId?.startsWith('imap-')) {
      return loadImapEmails();
    } else {
      result = await ipcRenderer.invoke('email:getEmailsFromAccount', selectedAccountId, 0);
    }

    // Kein Fallback mehr - wenn keine Konten, keine E-Mails
    if (!result || !result.success) {
      console.log('[EMAIL] Keine E-Mails:', result?.error || 'Kein Ergebnis');
      emails = [];
      updateStats();
      updateCategoryCounts();
      renderEmailList();
      hideLoading();
      return;
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
    }
  } catch (error) {
    console.error('Error loading emails:', error);
    emails = [];
    updateStats();
    updateCategoryCounts();
    renderEmailList();
  }
}

// Intelligente E-Mail-Klassifizierung (OHNE Animation - für automatische Klassifizierung beim Laden)
async function classifyAllEmails() {
  if (emails.length === 0) {
    console.log('[CLASSIFY] No emails to classify');
    return;
  }

  // Verhindere doppelte Klassifizierung
  if (isClassifying) {
    console.log('[CLASSIFY] Already classifying, skipping...');
    return;
  }

  isClassifying = true;
  const totalEmails = emails.length;
  console.log('[CLASSIFY] Starting auto-classification for', totalEmails, 'emails');

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
      // Direkt die E-Mail-Daten aktualisieren (OHNE Animation)
      for (let i = 0; i < result.classifications.length; i++) {
        const classification = result.classifications[i];
        const email = emails[i];

        if (email && classification) {
          emailClassifications[email.id] = classification;
          email.kategorie = classification.kategorie;
          email.confidence = classification.confidence;
          email.tags = classification.tags || [];
          email.zusammenfassung = classification.zusammenfassung;
          email.aktion = classification.aktion;
          email.isImportant = classification.kategorie === 'essenz' || classification.kategorie === 'wichtig';
          email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
          email.isPapierkorb = classification.kategorie === 'papierkorb';
          email.isNewsletter = classification.kategorie === 'newsletter';
          email.canAutoReply = classification.autoAntwortMöglich;
        }
      }

      // Aktualisiere Statistiken
      classifierStats = await ipcRenderer.invoke('email:classifierStats');

      // Log Klassifizierungsergebnisse
      const kategorieStats = {};
      emails.forEach(e => {
        const kat = e.kategorie || 'unclassified';
        kategorieStats[kat] = (kategorieStats[kat] || 0) + 1;
      });
      console.log('[CLASSIFY] Auto-Klassifizierung abgeschlossen:', kategorieStats);

      // UI aktualisieren
      updateCategoryCounts();
      renderEmailList();
    } else {
      console.error('[CLASSIFY] Failed:', result.error);
    }
  } catch (error) {
    console.error('[CLASSIFY] Fehler bei Batch-Klassifizierung:', error);
  } finally {
    isClassifying = false;
    renderChart(); // Chart mit echten Daten aktualisieren
  }
}

// =============================================================================
// E-MAIL ANALYSE ANIMATION SYSTEM
// Emails fliegen von der MITTE (E-Mail Liste) nach LINKS (Sidebar Kategorien)
// =============================================================================

class EmailAnalysisAnimation {
  constructor() {
    this.isAnalyzing = false;
    this.counts = {
      essenz: 0,
      wichtig: 0,
      termine: 0,
      rechnung: 0,
      normal: 0,
      info: 0,
      werbung: 0,
      newsletter: 0,
      papierkorb: 0,
      veraltet: 0
    };
    // Mapping: Klassifizierungs-Kategorie → Sidebar-Kategorie
    this.categoryMapping = {
      essenz: 'important',
      wichtig: 'important',
      termine: 'termine',
      rechnung: 'rechnung',
      normal: 'inbox',
      info: 'info',
      werbung: 'werbung',
      newsletter: 'newsletter',
      papierkorb: 'papierkorb',
      veraltet: 'inbox'
    };
    this.createUIElements();
  }

  createUIElements() {
    // Progress Indicator
    if (!document.getElementById('analysisProgressIndicator')) {
      const progressIndicator = document.createElement('div');
      progressIndicator.id = 'analysisProgressIndicator';
      progressIndicator.className = 'analysis-progress-indicator';
      progressIndicator.innerHTML = `
        <div class="progress-spinner"></div>
        <span class="progress-text">Analysiere <span class="progress-count">0/0</span> E-Mails...</span>
      `;
      document.body.appendChild(progressIndicator);
    }

    // Summary Modal
    if (!document.getElementById('analysisSummaryModal')) {
      const summaryModal = document.createElement('div');
      summaryModal.id = 'analysisSummaryModal';
      summaryModal.className = 'analysis-summary-modal';
      summaryModal.innerHTML = `
        <div class="summary-header">Analyse abgeschlossen</div>
        <div class="summary-stats-grid">
          <div class="summary-stat-item">
            <div class="summary-stat-number essenz" id="summaryEssenz">0</div>
            <div class="summary-stat-label">Essenz</div>
          </div>
          <div class="summary-stat-item">
            <div class="summary-stat-number wichtig" id="summaryWichtig">0</div>
            <div class="summary-stat-label">Wichtig</div>
          </div>
          <div class="summary-stat-item">
            <div class="summary-stat-number info" id="summaryInfo">0</div>
            <div class="summary-stat-label">Info</div>
          </div>
          <div class="summary-stat-item">
            <div class="summary-stat-number newsletter" id="summaryNewsletter">0</div>
            <div class="summary-stat-label">Newsletter</div>
          </div>
          <div class="summary-stat-item">
            <div class="summary-stat-number papierkorb" id="summaryPapierkorb">0</div>
            <div class="summary-stat-label">Papierkorb</div>
          </div>
          <div class="summary-stat-item">
            <div class="summary-stat-number normal" id="summaryNormal">0</div>
            <div class="summary-stat-label">Normal</div>
          </div>
        </div>
        <div class="summary-message" id="summaryMessage">Du hast 0 wichtige E-Mails.</div>
        <button class="summary-close-btn" id="closeSummaryBtn">Fertig</button>
      `;
      document.body.appendChild(summaryModal);

      document.getElementById('closeSummaryBtn').addEventListener('click', () => {
        summaryModal.classList.remove('visible');
      });
    }

    // Overlay
    if (!document.getElementById('analysisOverlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'analysisOverlay';
      overlay.className = 'analysis-overlay';
      document.body.appendChild(overlay);
    }
  }

  async startAnalysis(emailsData, classifications) {
    if (this.isAnalyzing) return;
    this.isAnalyzing = true;

    // Reset counts
    this.resetCounts();

    // Show progress indicator
    const progressIndicator = document.getElementById('analysisProgressIndicator');
    const progressCount = progressIndicator.querySelector('.progress-count');
    progressIndicator.classList.add('visible');

    // Analyse Button auf Loading
    const analyzeBtn = document.getElementById('analyzeAllBtn');
    if (analyzeBtn) {
      analyzeBtn.classList.add('loading');
    }

    const totalEmails = emailsData.length;

    // Verarbeite jede E-Mail mit Animation
    for (let i = 0; i < totalEmails; i++) {
      const email = emailsData[i];
      const classification = classifications[i];

      if (email && classification) {
        // Update progress
        progressCount.textContent = `${i + 1}/${totalEmails}`;

        // Speichere Klassifizierung
        emailClassifications[email.id] = classification;

        // Update E-Mail Daten
        email.kategorie = classification.kategorie;
        email.confidence = classification.confidence;
        email.tags = classification.tags || [];
        email.zusammenfassung = classification.zusammenfassung;
        email.aktion = classification.aktion;
        email.isImportant = classification.kategorie === 'essenz' || classification.kategorie === 'wichtig';
        email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
        email.isPapierkorb = classification.kategorie === 'papierkorb';
        email.isNewsletter = classification.kategorie === 'newsletter';
        email.canAutoReply = classification.autoAntwortMöglich;

        // Animation starten: E-Mail fliegt zur Kategorie
        await this.animateEmailToCategory(email, classification.kategorie, i);

        // Kurze Pause vor nächster E-Mail (150-300ms)
        await this.sleep(150 + Math.random() * 150);
      }
    }

    // Progress ausblenden
    progressIndicator.classList.remove('visible');

    // Button zurücksetzen
    if (analyzeBtn) {
      analyzeBtn.classList.remove('loading');
    }

    // Zusammenfassung anzeigen
    this.showSummary();

    // Finale UI-Aktualisierung
    updateCategoryCounts();

    // WICHTIG: Nach Animation automatisch zur "Wichtig"-Kategorie wechseln
    const wichtigCount = (this.counts.essenz || 0) + (this.counts.wichtig || 0);
    if (wichtigCount > 0) {
      // Wechsle zur Wichtig-Kategorie
      this.switchToCategory('important');
    } else {
      // Keine wichtigen E-Mails - bleibe im Posteingang
      renderEmailList();
    }

    this.isAnalyzing = false;
    console.log('[ANIMATION] Analyse-Animation abgeschlossen');
  }

  // Wechselt zur angegebenen Kategorie und aktualisiert die UI
  switchToCategory(categoryName) {
    // Update active category in sidebar
    document.querySelectorAll('.category-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.category === categoryName) {
        item.classList.add('active');
      }
    });

    // Update global state
    currentCategory = categoryName;

    // Update header
    const titles = {
      inbox: 'Posteingang',
      important: 'Wichtig',
      action: 'Aktion erforderlich',
      newsletter: 'Newsletter',
      sent: 'Gesendet',
      papierkorb: 'Papierkorb'
    };

    if (elements.headerTitle) {
      elements.headerTitle.textContent = titles[categoryName] || 'Posteingang';
    }

    // Render the filtered email list
    renderEmailList();

    console.log(`[ANIMATION] Gewechselt zu Kategorie: ${categoryName}`);
  }

  async animateEmailToCategory(email, kategorie, index) {
    // Finde das E-Mail Element in der Liste
    const emailElement = document.querySelector(`[data-id="${email.id}"]`);
    if (!emailElement) {
      // Kein Element gefunden, nur Zähler aktualisieren
      this.counts[kategorie]++;
      return;
    }

    // Finde die Ziel-Kategorie in der Sidebar
    const targetCategory = this.categoryMapping[kategorie] || 'inbox';
    const categoryElement = document.querySelector(`.category-item[data-category="${targetCategory}"]`);

    if (!categoryElement) {
      this.counts[kategorie]++;
      return;
    }

    // ALLE E-Mails fliegen zu ihrer Kategorie (auch normale zum Posteingang-Icon)
    // Aber: normale/info werden schneller verarbeitet (kürzere Animation)

    // Positionen berechnen
    const emailRect = emailElement.getBoundingClientRect();
    const categoryRect = categoryElement.getBoundingClientRect();

    // PHASE 1: Klon erstellen für Flug-Animation
    const clone = this.createFlyingClone(emailElement, emailRect, kategorie);

    // PHASE 2: Original E-Mail schrumpfen lassen (nur wenn es wegfliegt)
    emailElement.classList.add('shrinking');

    // PHASE 3: Trail-Effekt erstellen (von rechts nach links)
    this.createTrailEffect(emailRect, categoryRect, kategorie);

    // PHASE 4: Klon zur Kategorie fliegen lassen
    await this.sleep(50);

    const targetX = categoryRect.left + categoryRect.width / 2 - 40;
    const targetY = categoryRect.top + categoryRect.height / 2 - 20;

    clone.classList.add('flying');
    clone.style.left = targetX + 'px';
    clone.style.top = targetY + 'px';
    clone.style.transform = 'scale(0.2)';
    clone.style.opacity = '0';

    // PHASE 5: Kategorie hervorheben
    categoryElement.classList.add('receiving', 'pulse');

    await this.sleep(400);

    // PHASE 6: Zähler aktualisieren mit Bounce
    this.counts[kategorie]++;
    this.updateCategoryCount(targetCategory, kategorie);

    await this.sleep(100);

    // Aufräumen
    clone.remove();
    categoryElement.classList.remove('receiving');

    await this.sleep(100);
    categoryElement.classList.remove('pulse');
  }

  createFlyingClone(emailElement, rect, kategorie) {
    const clone = document.createElement('div');
    clone.className = 'email-flying-clone';

    // Kompakte Version des E-Mail-Inhalts
    const senderEl = emailElement.querySelector('.email-sender');
    const subjectEl = emailElement.querySelector('.email-subject');

    clone.innerHTML = `
      <div style="padding: 10px 14px; max-width: 200px;">
        <div style="font-weight: 600; font-size: 12px; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${senderEl ? senderEl.textContent : 'E-Mail'}
        </div>
        <div style="font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${subjectEl ? subjectEl.textContent : ''}
        </div>
        <div style="margin-top: 6px; font-size: 16px; text-align: center;">
          ${KATEGORIE_MAP[kategorie]?.icon || '📧'}
        </div>
      </div>
    `;

    clone.style.position = 'fixed';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.width = '200px';
    clone.style.zIndex = '10000';

    document.body.appendChild(clone);
    return clone;
  }

  createTrailEffect(startRect, endRect, kategorie) {
    const steps = 6;

    for (let i = 0; i < steps; i++) {
      setTimeout(() => {
        const trail = document.createElement('div');
        trail.className = `email-trail ${kategorie}`;

        // Position entlang des Weges berechnen (von rechts nach links)
        const progress = i / steps;
        const x = startRect.left + (endRect.left - startRect.left) * progress + startRect.width / 2 - 5;
        const y = startRect.top + (endRect.top - startRect.top) * progress + startRect.height / 2 - 5;

        trail.style.left = x + 'px';
        trail.style.top = y + 'px';

        document.body.appendChild(trail);

        // Nach Animation entfernen
        setTimeout(() => trail.remove(), 600);
      }, i * 60);
    }
  }

  updateCategoryCount(targetCategory, kategorie) {
    // Update den Count-Text in der Sidebar
    const countElement = document.querySelector(`.category-item[data-category="${targetCategory}"] .category-count`);
    if (countElement) {
      countElement.classList.add('bounce');
      setTimeout(() => countElement.classList.remove('bounce'), 400);
    }

    // Update Badge für "Important" Kategorie
    if (targetCategory === 'important') {
      const badge = document.getElementById('badgeImportant');
      if (badge) {
        const currentCount = (this.counts.essenz || 0) + (this.counts.wichtig || 0);
        badge.textContent = currentCount;
        badge.classList.remove('hidden');
        badge.classList.add('bounce');
        setTimeout(() => badge.classList.remove('bounce'), 400);
      }
    }

    // Live-Update der Kategorie-Zähler
    updateCategoryCounts();
  }

  showSummary() {
    const modal = document.getElementById('analysisSummaryModal');

    // Update Stats
    document.getElementById('summaryEssenz').textContent = this.counts.essenz || 0;
    document.getElementById('summaryWichtig').textContent = this.counts.wichtig || 0;
    document.getElementById('summaryNormal').textContent = this.counts.normal || 0;
    document.getElementById('summaryInfo').textContent = this.counts.info || 0;
    document.getElementById('summaryNewsletter').textContent = this.counts.newsletter || 0;
    document.getElementById('summaryPapierkorb').textContent = this.counts.papierkorb || 0;

    // Message
    const wichtigeAnzahl = (this.counts.essenz || 0) + (this.counts.wichtig || 0);
    const message = wichtigeAnzahl === 0
      ? 'Keine wichtigen E-Mails - alles erledigt!'
      : `Du hast ${wichtigeAnzahl} wichtige E-Mail${wichtigeAnzahl > 1 ? 's' : ''} die Aufmerksamkeit brauchen.`;
    document.getElementById('summaryMessage').textContent = message;

    // Show modal
    modal.classList.add('visible');
  }

  resetCounts() {
    Object.keys(this.counts).forEach(cat => {
      this.counts[cat] = 0;
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Globale Instanz der Animation-Klasse
const emailAnalysisAnimation = new EmailAnalysisAnimation();

// Animiertes Sortieren der E-Mails in Kategorien (NEUE VERSION mit Flug-Animation)
async function animateSorting(classifications) {
  // Starte die neue Animation
  await emailAnalysisAnimation.startAnalysis(emails, classifications);
}

async function loadImapEmails() {
  try {
    const result = await ipcRenderer.invoke('imap:getEmails', 0);

    if (result.success) {
      emails = (result.emails || []).map(email => ({
        id: email.uid.toString(),
        uid: email.uid,
        accountId: email.accountId,
        folder: email.folder || 'INBOX',
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

      // Wenn nur 1 Konto → direkt dieses Konto auswählen
      if (accounts.length === 1) {
        selectedAccountId = accounts[0].id;
        selectAccount(accounts[0].id);
      } else {
        // Bei mehreren oder keinen Konten → "Alle Konten" anzeigen
        updateAccountSelectorDisplay();
      }
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
  }
}

// Aktualisiert die Anzeige des Account-Selectors ohne E-Mails neu zu laden
function updateAccountSelectorDisplay() {
  if (selectedAccountId === 'all') {
    elements.currentAccountName.textContent = 'Alle Konten';
    const accountCount = accounts.length;
    elements.currentAccountEmail.textContent = accountCount > 0 ? `${accountCount} ${accountCount === 1 ? 'Konto' : 'Konten'}` : '';
    elements.currentAccountAvatar.textContent = '✉';
    const dropdownAllCount = document.getElementById('dropdownAllCount');
    if (dropdownAllCount) {
      dropdownAllCount.textContent = accountCount > 0 ? `${accountCount} ${accountCount === 1 ? 'Konto' : 'Konten'}` : '';
    }
  }
}

function showLoading() {
  elements.loadingState.classList.remove('hidden');
  elements.emptyState.classList.add('hidden');
  elements.emailItems.innerHTML = '';
}

function hideLoading() {
  elements.loadingState.classList.add('hidden');
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
    updatePaginationInfo(0, 0, 0);
    visibleEmails = [];
    return;
  }

  elements.emptyState.classList.add('hidden');

  // Pagination anwenden
  const totalEmails = filteredEmails.length;
  const totalPages = emailsPerPage === Infinity ? 1 : Math.ceil(totalEmails / emailsPerPage);

  // Sicherstellen dass currentPage im gültigen Bereich ist
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * emailsPerPage;
  const endIndex = emailsPerPage === Infinity ? totalEmails : Math.min(startIndex + emailsPerPage, totalEmails);

  // Sichtbare E-Mails für diese Seite
  const pageEmails = filteredEmails.slice(startIndex, endIndex);
  visibleEmails = pageEmails;  // Speichern für KI-Analyse

  // Pagination Info aktualisieren
  updatePaginationInfo(startIndex + 1, endIndex, totalEmails);

  pageEmails.forEach(email => {
    const item = createEmailItem(email);
    elements.emailItems.appendChild(item);
  });
}

function updatePaginationInfo(start, end, total) {
  if (elements.paginationInfo) {
    if (total === 0) {
      elements.paginationInfo.textContent = '0 E-Mails';
    } else {
      elements.paginationInfo.textContent = `${start}-${end} von ${total}`;
    }
  }

  // Buttons aktivieren/deaktivieren
  if (elements.prevPageBtn) {
    elements.prevPageBtn.disabled = currentPage <= 1;
  }
  if (elements.nextPageBtn) {
    const totalPages = emailsPerPage === Infinity ? 1 : Math.ceil(total / emailsPerPage);
    elements.nextPageBtn.disabled = currentPage >= totalPages;
  }
}

function switchToCategory(categoryName) {
  // Entferne active von allen Kategorien
  document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));

  // Setze active auf die gewählte Kategorie
  const targetItem = document.querySelector(`.category-item[data-category="${categoryName}"]`);
  if (targetItem) {
    targetItem.classList.add('active');
  }

  // Update currentCategory und UI
  currentCategory = categoryName;
  updateHeader();
  renderEmailList();
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
      // Nur unkategorisierte E-Mails (oder normal/veraltet)
      return emailList.filter(e =>
        !e.kategorie ||
        e.kategorie === 'normal' ||
        e.kategorie === 'veraltet' ||
        (e.kategorie !== 'papierkorb' &&
         e.kategorie !== 'newsletter' &&
         e.kategorie !== 'info' &&
         e.kategorie !== 'werbung' &&
         e.kategorie !== 'essenz' &&
         e.kategorie !== 'wichtig' &&
         e.kategorie !== 'termine' &&
         e.kategorie !== 'rechnung' &&
         !e.isPapierkorb &&
         !e.isNewsletter)
      );
    case 'info':
      return emailList.filter(e => e.kategorie === 'info');
    case 'werbung':
      return emailList.filter(e => e.kategorie === 'werbung');
    case 'newsletter':
      return emailList.filter(e => e.kategorie === 'newsletter' || e.isNewsletter);
    case 'sent':
      return emailList.filter(e => e.isSent);
    case 'papierkorb':
      return emailList.filter(e => e.kategorie === 'papierkorb' || e.isPapierkorb);
    case 'essenz':
      return emailList.filter(e => e.kategorie === 'essenz');
    case 'termine':
      return emailList.filter(e => e.kategorie === 'termine');
    case 'rechnung':
      return emailList.filter(e => e.kategorie === 'rechnung');
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
  else if (email.kategorie === 'papierkorb' || email.kategorie === 'newsletter') priorityClass = 'low';

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
  if (email.provider === 'imap' && email.uid && !email.body && !email.html) {
    elements.detailBody.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Lade Inhalt...</span></div>';

    try {
      const fullEmail = await ipcRenderer.invoke('imap:getEmailContent', email.accountId, email.uid, email.folder || 'INBOX');
      if (fullEmail && fullEmail.success && fullEmail.email) {
        const content = fullEmail.email;
        // Speichere BEIDE Versionen - Text UND HTML
        email.body = content.text || '';
        email.html = content.html || '';

        // Debug: Zeige was geladen wurde
        console.log(`[EMAIL] Geladen: text=${email.body?.length || 0} chars, html=${email.html?.length || 0} chars`);
        console.log(`[EMAIL] Text preview:`, email.body?.substring(0, 200));
        console.log(`[EMAIL] HTML preview:`, email.html?.substring(0, 500));

        // Zeige HTML wenn vorhanden, sonst Text
        if (email.html) {
          elements.detailBody.innerHTML = email.html;
        } else {
          elements.detailBody.textContent = email.body || 'Kein Inhalt';
        }

        // Mark as read
        if (email.isUnread) {
          await ipcRenderer.invoke('imap:markAsRead', email.accountId, email.uid, email.folder || 'INBOX');
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
    // Bereits geladene E-Mail - zeige HTML wenn vorhanden, sonst Text
    if (email.html) {
      elements.detailBody.innerHTML = email.html;
    } else {
      elements.detailBody.textContent = email.body || email.snippet || 'Kein Inhalt';
    }
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

  // Reset Feedback-Elemente bei neuer E-Mail
  document.getElementById('feedbackInputContainer')?.classList.add('hidden');
  document.getElementById('feedbackTextareaNew').value = '';
  document.getElementById('kiAnalyseBox')?.classList.add('hidden');
  document.getElementById('kategorieDropdown')?.classList.add('hidden');

  // Zeige KI-Gedanken Box wenn aktiviert (nur bei essenz/wichtig)
  showKIGedankenBox(email);
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
  // Inbox (nur unkategorisierte E-Mails, normal, veraltet)
  const inboxCount = emails.filter(e =>
    !e.kategorie ||
    e.kategorie === 'normal' ||
    e.kategorie === 'veraltet' ||
    (e.kategorie !== 'papierkorb' && e.kategorie !== 'newsletter' &&
     e.kategorie !== 'info' && e.kategorie !== 'werbung' &&
     e.kategorie !== 'essenz' && e.kategorie !== 'wichtig' &&
     e.kategorie !== 'termine' && e.kategorie !== 'rechnung' &&
     !e.isPapierkorb && !e.isNewsletter)
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

  // Termine
  const termineCount = emails.filter(e => e.kategorie === 'termine').length;
  const catTermine = document.getElementById('catTermine');
  if (catTermine) catTermine.textContent = `${termineCount} E-Mails`;
  const badgeTermine = document.getElementById('badgeTermine');
  if (badgeTermine) {
    if (termineCount > 0) {
      badgeTermine.textContent = termineCount;
      badgeTermine.classList.remove('hidden');
    } else {
      badgeTermine.classList.add('hidden');
    }
  }

  // Rechnungen
  const rechnungCount = emails.filter(e => e.kategorie === 'rechnung').length;
  const catRechnung = document.getElementById('catRechnung');
  if (catRechnung) catRechnung.textContent = `${rechnungCount} E-Mails`;

  // Info
  const infoCount = emails.filter(e => e.kategorie === 'info').length;
  document.getElementById('catInfo').textContent = `${infoCount} E-Mails`;

  // Werbung
  const werbungCount = emails.filter(e => e.kategorie === 'werbung').length;
  document.getElementById('catWerbung').textContent = `${werbungCount} E-Mails`;

  // Newsletter
  const newsletterCount = emails.filter(e => e.kategorie === 'newsletter' || e.isNewsletter).length;
  document.getElementById('catNewsletter').textContent = `${newsletterCount} E-Mails`;

  // Papierkorb
  const papierkorbCount = emails.filter(e => e.kategorie === 'papierkorb' || e.isPapierkorb).length;
  document.getElementById('catPapierkorb').textContent = `${papierkorbCount} E-Mails`;
  elements.papierkorbCount.textContent = papierkorbCount;

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
    termine: 'Termine',
    rechnung: 'Rechnungen',
    info: 'Info',
    werbung: 'Werbung',
    newsletter: 'Newsletter',
    sent: 'Gesendet',
    papierkorb: 'Papierkorb'
  };
  elements.headerTitle.textContent = titles[currentCategory] || 'Posteingang';
}

function renderChart() {
  // Berechne echte Daten aus den geladenen E-Mails
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sonntag
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  // Initialisiere Daten für jeden Wochentag (alle Kategorien)
  const data = days.map(() => ({
    essenz: 0,
    wichtig: 0,
    termine: 0,
    rechnung: 0,
    normal: 0,
    info: 0,
    newsletter: 0,
    werbung: 0,
    papierkorb: 0,
    veraltet: 0
  }));

  // Berechne Wochengrenzen
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  console.log(`[CHART] Woche: ${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`);
  console.log(`[CHART] Geladene E-Mails: ${emails.length}`);

  let countedEmails = 0;
  let skippedEmails = [];

  // Zähle E-Mails pro Tag und Kategorie
  emails.forEach(email => {
    const emailDate = new Date(email.date);

    // Nur E-Mails dieser Woche
    if (emailDate >= monday && emailDate <= sunday) {
      const emailDayOfWeek = emailDate.getDay();
      const dayIndex = emailDayOfWeek === 0 ? 6 : emailDayOfWeek - 1; // Mo=0, So=6

      const kategorie = email.kategorie || 'normal';
      if (data[dayIndex][kategorie] !== undefined) {
        data[dayIndex][kategorie]++;
      } else {
        data[dayIndex].normal++;
      }
      countedEmails++;
    } else {
      skippedEmails.push({
        subject: email.subject?.substring(0, 30),
        date: emailDate.toLocaleDateString(),
        kategorie: email.kategorie
      });
    }
  });

  console.log(`[CHART] Gezählt: ${countedEmails}, Übersprungen: ${skippedEmails.length}`);
  if (skippedEmails.length > 0) {
    console.log(`[CHART] Übersprungene E-Mails (außerhalb dieser Woche):`, skippedEmails);
  }

  // Berechne Maximum für Skalierung (alle Kategorien)
  const maxTotal = Math.max(1, ...data.map(d =>
    d.essenz + d.wichtig + d.termine + d.rechnung + d.normal + d.info + d.newsletter + d.werbung + d.papierkorb + d.veraltet
  ));

  elements.chartBars.innerHTML = data.map((d, i) => {
    const total = d.essenz + d.wichtig + d.termine + d.rechnung + d.normal + d.info + d.newsletter + d.werbung + d.papierkorb + d.veraltet;
    const scale = 100 / maxTotal;

    return `
      <div class="chart-row">
        <span class="chart-label">${days[i]}</span>
        <div class="chart-bar-container">
          <div class="chart-bar essenz" style="width: ${d.essenz * scale}%" title="Essenz: ${d.essenz}"></div>
          <div class="chart-bar wichtig" style="width: ${d.wichtig * scale}%" title="Wichtig: ${d.wichtig}"></div>
          <div class="chart-bar termine" style="width: ${d.termine * scale}%" title="Termine: ${d.termine}"></div>
          <div class="chart-bar rechnung" style="width: ${d.rechnung * scale}%" title="Rechnung: ${d.rechnung}"></div>
          <div class="chart-bar normal" style="width: ${d.normal * scale}%" title="Normal: ${d.normal}"></div>
          <div class="chart-bar info" style="width: ${d.info * scale}%" title="Info: ${d.info}"></div>
          <div class="chart-bar newsletter" style="width: ${d.newsletter * scale}%" title="Newsletter: ${d.newsletter}"></div>
          <div class="chart-bar werbung" style="width: ${d.werbung * scale}%" title="Werbung: ${d.werbung}"></div>
          <div class="chart-bar papierkorb" style="width: ${d.papierkorb * scale}%" title="Papierkorb: ${d.papierkorb}"></div>
          <div class="chart-bar veraltet" style="width: ${d.veraltet * scale}%" title="Veraltet: ${d.veraltet}"></div>
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

// Stop-Analyse Funktion
function stopAnalysis() {
  if (isClassifying) {
    stopAnalysisRequested = true;
    showToast('Analyse wird gestoppt...', 'info');
    console.log('[ANALYZE] Stop angefordert');
  }
}

async function analyzeAllEmails() {
  // Prüfe ob sichtbare E-Mails vorhanden sind
  if (visibleEmails.length === 0) {
    showToast('Keine E-Mails zum Analysieren sichtbar', 'warning');
    return;
  }

  // Prüfe ob bereits eine Analyse läuft
  if (emailAnalysisAnimation.isAnalyzing || isClassifying) {
    showToast('Analyse läuft bereits...', 'info');
    return;
  }

  // Setze Flags
  isClassifying = true;
  stopAnalysisRequested = false;
  emailAnalysisAnimation.isAnalyzing = true;

  // Zeige Loading-Status auf Button und Stop-Button
  const analyzeBtn = document.getElementById('analyzeAllBtn');
  const stopBtn = document.getElementById('stopAnalysisBtn');
  if (analyzeBtn) {
    analyzeBtn.classList.add('loading');
  }
  if (stopBtn) {
    stopBtn.classList.remove('hidden');
  }

  // Progress Indicator anzeigen
  const progressIndicator = document.getElementById('analysisProgressIndicator');
  const progressCount = progressIndicator?.querySelector('.progress-count');
  if (progressIndicator) progressIndicator.classList.add('visible');

  try {
    // Nur die sichtbaren E-Mails analysieren!
    const emailsToAnalyze = [...visibleEmails];
    console.log('[ANALYZE] Starte KI-Analyse für', emailsToAnalyze.length, 'sichtbare E-Mails');
    const startTime = Date.now();
    const totalEmails = emailsToAnalyze.length;

    // Reset Zähler
    emailAnalysisAnimation.resetCounts();

    // SEQUENTIELLE Verarbeitung: Eine E-Mail nach der anderen
    for (let i = 0; i < totalEmails; i++) {
      // Prüfe ob Stop angefordert wurde
      if (stopAnalysisRequested) {
        console.log(`[ANALYZE] Analyse gestoppt bei E-Mail ${i + 1}/${totalEmails}`);
        showToast(`Analyse gestoppt bei ${i}/${totalEmails} E-Mails`, 'warning');
        break;
      }

      const email = emailsToAnalyze[i];

      // Update Progress
      if (progressCount) {
        progressCount.textContent = `${i + 1}/${totalEmails}`;
      }

      // Bereite E-Mail für Klassifizierung vor
      const emailForClassification = {
        id: email.id,
        from: { address: email.from, name: email.fromName },
        subject: email.subject,
        text: email.body || email.snippet || '',
        date: email.date,
        to: email.to || [],
        cc: email.cc || [],
        attachments: email.attachments || []
      };

      // Klassifiziere DIESE EINE E-Mail
      const result = await ipcRenderer.invoke('email:classify', emailForClassification);

      if (result.success && result.classification) {
        const classification = result.classification;

        // Speichere Klassifizierung
        emailClassifications[email.id] = classification;

        // Update E-Mail Daten
        email.kategorie = classification.kategorie;
        email.confidence = classification.confidence;
        email.tags = classification.tags || [];
        email.zusammenfassung = classification.zusammenfassung;
        email.aktion = classification.aktion;
        email.isImportant = classification.kategorie === 'essenz' || classification.kategorie === 'wichtig';
        email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
        email.isPapierkorb = classification.kategorie === 'papierkorb';
        email.isNewsletter = classification.kategorie === 'newsletter';
        email.canAutoReply = classification.autoAntwortMöglich;

        // Debug-Log Eintrag hinzufügen
        addDebugEntry(emailForClassification, classification);

        // SOFORT Animation für diese E-Mail
        await emailAnalysisAnimation.animateEmailToCategory(email, classification.kategorie, i);

        // Update Counts nach jeder E-Mail
        updateCategoryCounts();

        console.log(`[ANALYZE] ${i + 1}/${totalEmails}: ${email.subject?.substring(0, 30)}... → ${classification.kategorie} (Stufe ${classification.stufe})`);
      } else {
        console.warn(`[ANALYZE] Fehler bei E-Mail ${i + 1}:`, result.error);
      }

      // Kurze Pause zwischen E-Mails (100ms)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Progress ausblenden
    if (progressIndicator) progressIndicator.classList.remove('visible');

    // Aktualisiere Statistiken
    classifierStats = await ipcRenderer.invoke('email:classifierStats');

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ANALYZE] Analyse abgeschlossen in ${duration}s`);

    // Log Klassifizierungsergebnisse
    const kategorieStats = {};
    emails.forEach(e => {
      const kat = e.kategorie || 'unclassified';
      kategorieStats[kat] = (kategorieStats[kat] || 0) + 1;
    });
    console.log('[ANALYZE] Ergebnisse:', kategorieStats);

    // Zeige Classifier-Kosten wenn verfügbar
    if (classifierStats?.stats) {
      console.log('[CLASSIFIER] Stufe 0 (Domain):', classifierStats.stats.stufe0 || 0);
      console.log('[CLASSIFIER] Stufe 1 (Header):', classifierStats.stats.stufe1 || 0);
      console.log('[CLASSIFIER] Stufe 2 (Inhalt):', classifierStats.stats.stufe2 || 0);
      console.log('[CLASSIFIER] Kosten:', classifierStats.stats.kostenGesamt);
    }

    // Wechsle zu "Wichtig" Kategorie wenn fertig (nur wenn nicht gestoppt)
    if (!stopAnalysisRequested) {
      switchToCategory('important');
      // Zeige Summary
      emailAnalysisAnimation.showSummary();
    } else {
      // Bei Stop: Aktuelle Liste neu rendern
      renderEmailList();
    }

  } catch (error) {
    console.error('[ANALYZE] Fehler:', error);
    showToast('Analyse-Fehler: ' + error.message, 'error');
  } finally {
    // Reset Flags und Buttons
    isClassifying = false;
    stopAnalysisRequested = false;
    emailAnalysisAnimation.isAnalyzing = false;

    const analyzeBtn = document.getElementById('analyzeAllBtn');
    if (analyzeBtn) {
      analyzeBtn.classList.remove('loading');
    }

    const stopBtn = document.getElementById('stopAnalysisBtn');
    if (stopBtn) {
      stopBtn.classList.add('hidden');
    }

    const progressIndicator = document.getElementById('analysisProgressIndicator');
    if (progressIndicator) progressIndicator.classList.remove('visible');

    renderChart(); // Chart mit echten Daten aktualisieren
  }
}

async function emptyPapierkorb() {
  if (!confirm('Papierkorb leeren?')) return;

  try {
    await ipcRenderer.invoke('email:emptyPapierkorb');
    emails = emails.filter(e => !e.isPapierkorb && e.kategorie !== 'papierkorb');
    updateCategoryCounts();
    renderEmailList();
    showToast('Papierkorb geleert');
  } catch (error) {
    console.error('Error emptying papierkorb:', error);
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
  console.log('[UI] showImapSetup called');
  console.log('[UI] accountOptions:', elements.accountOptions);
  console.log('[UI] imapSetup:', elements.imapSetup);
  elements.accountOptions.classList.add('hidden');
  elements.imapSetup.classList.remove('hidden');

  // Focus auf E-Mail Feld setzen
  setTimeout(() => {
    const emailInput = document.getElementById('imapEmail');
    console.log('[UI] imapEmail input:', emailInput);
    if (emailInput) {
      emailInput.focus();
    }
  }, 100);
}

async function connectGmail() {
  elements.gmailSetup.classList.add('hidden');
  elements.accountLoadingState.classList.remove('hidden');

  try {
    const result = await ipcRenderer.invoke('google-auth-connect');

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

// ============================================
// OpenAI API Key Management
// ============================================

async function saveOpenAIApiKey() {
  const input = document.getElementById('openaiApiKeyInput');
  const status = document.getElementById('apiKeyStatus');
  const apiKey = input?.value?.trim();

  if (!apiKey) {
    status.textContent = 'Bitte gib einen API Key ein';
    status.className = 'api-key-status error';
    return;
  }

  if (!apiKey.startsWith('sk-')) {
    status.textContent = 'Ungültiger Key (muss mit sk- beginnen)';
    status.className = 'api-key-status error';
    return;
  }

  try {
    status.textContent = 'Speichere...';
    status.className = 'api-key-status';

    await ipcRenderer.invoke('email:setClassifierApiKey', apiKey);

    status.textContent = '✓ API Key gespeichert!';
    status.className = 'api-key-status success';

    // Maske Input nach Speichern
    input.value = apiKey.substring(0, 7) + '...' + apiKey.substring(apiKey.length - 4);
    input.type = 'text';

    showToast('OpenAI API Key gespeichert', 'success');
    console.log('[API KEY] OpenAI API Key erfolgreich gesetzt');
  } catch (error) {
    console.error('[API KEY] Fehler:', error);
    status.textContent = 'Fehler: ' + error.message;
    status.className = 'api-key-status error';
  }
}

async function loadOpenAIApiKey() {
  const input = document.getElementById('openaiApiKeyInput');
  const status = document.getElementById('apiKeyStatus');

  if (!input) return;

  try {
    // Prüfe ob ein Key im Classifier gesetzt ist
    const stats = await ipcRenderer.invoke('email:classifierStats');

    // Wenn GPT-Kosten > 0, dann ist ein Key gesetzt
    if (stats?.stats?.gptKosten > 0) {
      input.placeholder = 'Key bereits gesetzt (sk-...)';
      status.textContent = '✓ API Key ist konfiguriert';
      status.className = 'api-key-status success';
    } else {
      status.textContent = 'Kein API Key konfiguriert - GPT-Klassifizierung deaktiviert';
      status.className = 'api-key-status error';
    }
  } catch (error) {
    console.error('[API KEY] Fehler beim Laden:', error);
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

// =============================================================================
// DEBUG MODAL - GPT GEDANKEN
// =============================================================================

function openDebugModal() {
  elements.debugModal?.classList.remove('hidden');
  renderDebugLog();
}

function closeDebugModal() {
  elements.debugModal?.classList.add('hidden');
}

function clearDebugLog() {
  debugLog = [];
  renderDebugLog();
  updateDebugButton();
}

function addDebugEntry(email, classification) {
  const entry = {
    timestamp: new Date(),
    from: email.from?.address || email.from || 'Unbekannt',
    fromName: email.from?.name || email.fromName || '',
    subject: email.subject || '(Kein Betreff)',
    kategorie: classification.kategorie || 'info',
    confidence: classification.confidence || 0,
    gedanken: classification.gedanken || '',
    stufe: classification.stufe || 0,
    schnell: classification.schnell || false
  };

  // Am Anfang einfügen (neueste zuerst)
  debugLog.unshift(entry);

  // Max 50 Einträge behalten
  if (debugLog.length > 50) {
    debugLog = debugLog.slice(0, 50);
  }

  updateDebugButton();

  // Wenn Modal offen ist, sofort aktualisieren
  if (!elements.debugModal?.classList.contains('hidden')) {
    renderDebugLog();
  }
}

function updateDebugButton() {
  if (debugLog.length > 0) {
    elements.debugToggleBtn?.classList.add('has-entries');
  } else {
    elements.debugToggleBtn?.classList.remove('has-entries');
  }
}

function renderDebugLog() {
  if (!elements.debugLog) return;

  if (debugLog.length === 0) {
    elements.debugLog.innerHTML = `
      <div class="debug-empty">
        <div class="debug-empty-icon">🧠</div>
        <p>Noch keine Klassifizierungen.</p>
        <p>Starte die KI-Analyse um die Gedanken zu sehen.</p>
      </div>
    `;
    return;
  }

  elements.debugLog.innerHTML = debugLog.map(entry => {
    const stufeLabel = entry.stufe === 0 ? 'DOMAIN' : entry.stufe === 1 ? 'HEADER' : 'INHALT';
    const kategorieDisplay = KATEGORIE_MAP[entry.kategorie]?.name || entry.kategorie;

    return `
      <div class="debug-entry stufe-${entry.stufe}">
        <div class="debug-entry-header">
          <span class="debug-entry-stufe">STUFE ${entry.stufe}: ${stufeLabel}</span>
          <span class="debug-entry-kategorie ${entry.kategorie}">${kategorieDisplay}</span>
          <span class="debug-entry-confidence">${entry.confidence}% sicher</span>
        </div>
        <div class="debug-entry-email">
          <div class="debug-entry-from">${entry.fromName ? entry.fromName + ' ' : ''}&lt;${entry.from}&gt;</div>
          <div class="debug-entry-subject">${entry.subject}</div>
        </div>
        ${entry.gedanken ? `<div class="debug-entry-gedanken">${entry.gedanken}</div>` : ''}
      </div>
    `;
  }).join('');
}

// =============================================================================
// KI-GEDANKEN BOX (FEEDBACK FEATURE)
// =============================================================================

let showKIGedankenEnabled = true;
let kiFeedbackStore = null;

function initKIFeedback() {
  // Lade Einstellung
  const Store = require('electron-store');
  kiFeedbackStore = new Store({ name: 'ki-feedback' });
  showKIGedankenEnabled = kiFeedbackStore.get('settings.showKIGedanken', true);
}

function showKIGedankenBox(email) {
  // Prüfe ob in Einstellungen deaktiviert
  if (!showKIGedankenEnabled) {
    hideKIGedankenBox();
    return;
  }

  // Nur bei Essenz und Wichtig anzeigen
  const kategorie = email.kategorie || emailClassifications[email.id]?.kategorie;
  if (!['essenz', 'wichtig'].includes(kategorie)) {
    hideKIGedankenBox();
    return;
  }

  // Hole Gedanken aus Klassifizierung
  const classification = emailClassifications[email.id];
  const gedanken = classification?.gedanken || email.gedanken;

  if (!gedanken) {
    hideKIGedankenBox();
    return;
  }

  // Box anzeigen
  const box = document.getElementById('kiGedankenBox');
  if (!box) return;

  box.classList.remove('hidden', 'hiding');
  box.dataset.emailId = email.id;

  // Gedanken einfügen
  document.getElementById('kiGedankenText').textContent = gedanken;

  // Reset Feedback UI
  resetKIFeedbackUI();
}

function hideKIGedankenBox() {
  const box = document.getElementById('kiGedankenBox');
  if (!box || box.classList.contains('hidden')) return;

  box.classList.add('hiding');
  setTimeout(() => {
    box.classList.add('hidden');
    box.classList.remove('hiding');
  }, 300);
}

function resetKIFeedbackUI() {
  // Buttons zurücksetzen
  document.querySelectorAll('#kiFeedbackButtons .feedback-btn').forEach(btn => {
    btn.classList.remove('selected');
  });

  // Textfeld verstecken
  const feedbackInput = document.getElementById('feedbackInput');
  if (feedbackInput) {
    feedbackInput.classList.add('hidden');
    feedbackInput.classList.remove('visible');
  }

  // Textarea leeren
  const textarea = document.getElementById('feedbackTextarea');
  if (textarea) textarea.value = '';

  // Success verstecken
  const success = document.getElementById('feedbackSuccess');
  if (success) success.classList.add('hidden');

  // Buttons wieder anzeigen
  const buttons = document.getElementById('kiFeedbackButtons');
  if (buttons) buttons.style.display = 'flex';
}

function feedbackPositive() {
  const box = document.getElementById('kiGedankenBox');
  const emailId = box?.dataset.emailId;
  if (!emailId) return;

  saveFeedback(emailId, { type: 'positive', message: null });
  showFeedbackSuccess();
}

function feedbackNegative() {
  document.querySelector('#feedbackNegativeBtn')?.classList.add('selected');
  showFeedbackInput();
}

function showFeedbackInput() {
  const feedbackInput = document.getElementById('feedbackInput');
  if (feedbackInput) {
    feedbackInput.classList.remove('hidden');
    feedbackInput.classList.add('visible');
  }
  document.getElementById('feedbackTextarea')?.focus();
}

function submitFeedback() {
  const box = document.getElementById('kiGedankenBox');
  const emailId = box?.dataset.emailId;
  const message = document.getElementById('feedbackTextarea')?.value.trim();

  if (!emailId) return;

  if (!message) {
    document.getElementById('feedbackTextarea')?.focus();
    showToast('Bitte erkläre der KI warum', 'warning');
    return;
  }

  saveFeedback(emailId, { type: 'negative', message: message });
  showFeedbackSuccess();
}

function saveFeedback(emailId, feedback) {
  if (!kiFeedbackStore) initKIFeedback();

  const email = emails.find(e => e.id === emailId) || currentEmail;
  const classification = emailClassifications[emailId];

  const feedbackData = {
    emailId: emailId,
    absender: email?.from || '',
    absenderName: email?.fromName || '',
    absenderDomain: extractDomain(email?.from || ''),
    betreff: email?.subject || '',
    kiKategorie: classification?.kategorie || email?.kategorie || '',
    kiGedanken: classification?.gedanken || '',
    feedbackType: feedback.type,
    userErklärung: feedback.message,
    timestamp: new Date().toISOString()
  };

  // Speichern
  const allFeedback = kiFeedbackStore.get('feedbackList', []);
  allFeedback.push(feedbackData);

  // Max 100 Feedbacks behalten
  if (allFeedback.length > 100) {
    allFeedback.splice(0, allFeedback.length - 100);
  }

  kiFeedbackStore.set('feedbackList', allFeedback);

  console.log('[FEEDBACK] Gespeichert:', feedbackData);
}

function showFeedbackSuccess() {
  // Buttons verstecken
  const buttons = document.getElementById('kiFeedbackButtons');
  if (buttons) buttons.style.display = 'none';

  // Textarea verstecken
  const feedbackInput = document.getElementById('feedbackInput');
  if (feedbackInput) feedbackInput.classList.add('hidden');

  // Success anzeigen
  const success = document.getElementById('feedbackSuccess');
  if (success) success.classList.remove('hidden');

  // Nach 1.5s Box ausblenden
  setTimeout(() => {
    hideKIGedankenBox();
  }, 1500);
}

function extractDomain(email) {
  if (!email) return '';
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

function toggleKIGedanken(enabled) {
  showKIGedankenEnabled = enabled;
  if (!kiFeedbackStore) initKIFeedback();
  kiFeedbackStore.set('settings.showKIGedanken', enabled);

  if (!enabled) {
    hideKIGedankenBox();
  }
}

function getFeedbackForPrompt() {
  if (!kiFeedbackStore) initKIFeedback();

  const allFeedback = kiFeedbackStore.get('feedbackList', []);

  // Nur negative Feedbacks mit Erklärung für GPT
  const relevantFeedback = allFeedback
    .filter(f => f.feedbackType === 'negative' && f.userErklärung)
    .slice(-20) // Letzte 20
    .map(f => {
      if (f.absenderName) {
        return `- "${f.absenderName}" (${f.absenderDomain}): ${f.userErklärung}`;
      } else {
        return `- E-Mails von "${f.absenderDomain}": ${f.userErklärung}`;
      }
    });

  if (relevantFeedback.length === 0) return '';

  return `\nWICHTIG - Das habe ich aus vorherigem Feedback gelernt:\n${relevantFeedback.join('\n')}\n\nBerücksichtige dieses Feedback bei der Klassifizierung.\n`;
}

// Event Listeners für KI-Feedback
function setupKIFeedbackListeners() {
  document.getElementById('feedbackPositiveBtn')?.addEventListener('click', feedbackPositive);
  document.getElementById('feedbackNegativeBtn')?.addEventListener('click', feedbackNegative);
  document.getElementById('feedbackExplainBtn')?.addEventListener('click', showFeedbackInput);
  document.getElementById('feedbackSubmitBtn')?.addEventListener('click', submitFeedback);

  // Bei Antworten/Archivieren Box ausblenden
  document.getElementById('replyBtn')?.addEventListener('click', hideKIGedankenBox);
  document.getElementById('archiveBtn')?.addEventListener('click', hideKIGedankenBox);

  // Settings Toggle
  const toggle = document.getElementById('showKIGedankenToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      toggleKIGedanken(toggle.classList.contains('active'));
    });
  }

  // === NEUE FEEDBACK BAR LISTENERS ===

  // Ja Button - positives Feedback
  document.getElementById('feedbackJaBtn')?.addEventListener('click', () => {
    if (!currentEmail) return;
    saveFeedbackNew(currentEmail.id, { type: 'positive' });
    showFeedbackToast('✓ Danke!');
  });

  // Nein Button - zeigt Textfeld
  document.getElementById('feedbackNeinBtn')?.addEventListener('click', () => {
    document.getElementById('feedbackInputContainer')?.classList.remove('hidden');
    document.getElementById('feedbackTextareaNew')?.focus();
  });

  // Feedback Text Button - zeigt Textfeld
  document.getElementById('feedbackTextBtn')?.addEventListener('click', () => {
    document.getElementById('feedbackInputContainer')?.classList.remove('hidden');
    document.getElementById('feedbackTextareaNew')?.focus();
  });

  // Feedback Submit Button
  document.getElementById('feedbackSubmitNewBtn')?.addEventListener('click', () => {
    if (!currentEmail) return;
    const textarea = document.getElementById('feedbackTextareaNew');
    const message = textarea?.value?.trim();
    if (!message) {
      showToast('Bitte erkläre warum', 'warning');
      return;
    }

    saveFeedbackNew(currentEmail.id, {
      type: 'negative',
      message: message
    });

    textarea.value = '';
    document.getElementById('feedbackInputContainer')?.classList.add('hidden');
    showFeedbackToast('✓ Feedback gespeichert!');
  });

  // Verschieben Dropdown Toggle
  document.getElementById('verschiebenBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('kategorieDropdown');
    dropdown?.classList.toggle('hidden');
  });

  // Dropdown Items
  document.querySelectorAll('#kategorieDropdown .dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!currentEmail) return;
      const neueKategorie = item.dataset.kategorie;
      const alteKategorie = currentEmail.kategorie || 'normal';

      // E-Mail Kategorie ändern
      currentEmail.kategorie = neueKategorie;

      // Feedback speichern (KI lernt)
      saveFeedbackNew(currentEmail.id, {
        type: 'korrektur',
        von: alteKategorie,
        zu: neueKategorie
      });

      // Liste aktualisieren
      updateCategoryCounts();
      renderEmailList();

      // Dropdown schließen
      document.getElementById('kategorieDropdown')?.classList.add('hidden');

      showFeedbackToast(`✓ Verschoben nach ${formatKategorieName(neueKategorie)}`);
    });
  });

  // Dropdown schließen bei Klick außerhalb
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('kategorieDropdown');
    const btn = document.getElementById('verschiebenBtn');
    if (!dropdown?.contains(e.target) && e.target !== btn) {
      dropdown?.classList.add('hidden');
    }
  });

  // KI-Analyse Button (S-Icon)
  document.getElementById('kiAnalyseBtn')?.addEventListener('click', showKIAnalyse);

  // KI-Analyse schließen
  document.getElementById('kiAnalyseCloseBtn')?.addEventListener('click', hideKIAnalyse);
}

// === NEUE FEEDBACK FUNKTIONEN ===

function saveFeedbackNew(emailId, feedback) {
  if (!currentEmail) return;

  try {
    const feedbackData = {
      emailId,
      absenderEmail: currentEmail.from,
      absenderName: currentEmail.fromName,
      absenderDomain: currentEmail.from?.split('@')[1] || '',
      betreff: currentEmail.subject,
      kategorie: currentEmail.kategorie || 'normal',
      feedbackType: feedback.type,
      userErklärung: feedback.message || null,
      korrekturVon: feedback.von || null,
      korrekturZu: feedback.zu || null,
      timestamp: new Date().toISOString()
    };

    // An Main-Prozess senden
    ipcRenderer.invoke('feedback:save', feedbackData).catch(err => {
      console.warn('Feedback speichern fehlgeschlagen:', err);
    });

    console.log('[FEEDBACK] Gespeichert:', feedbackData);
  } catch (e) {
    console.error('[FEEDBACK] Fehler:', e);
  }
}

function showFeedbackToast(message) {
  // Entferne vorherige Toasts
  document.querySelectorAll('.feedback-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'feedback-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2000);
}

function formatKategorieName(kat) {
  const names = {
    essenz: 'Essenz',
    wichtig: 'Wichtig',
    normal: 'Normal',
    info: 'Info',
    newsletter: 'Newsletter',
    papierkorb: 'Papierkorb',
    werbung: 'Werbung'
  };
  return names[kat] || kat;
}

// === KI-ANALYSE AUF KLICK ===

async function showKIAnalyse() {
  if (!currentEmail) return;

  const box = document.getElementById('kiAnalyseBox');
  const kategorie = document.getElementById('kiKategorie');
  const begruendung = document.getElementById('kiBegruendung');
  const sicherheit = document.getElementById('kiSicherheit');

  if (!box) return;

  // Box anzeigen mit Loading
  box.classList.remove('hidden');
  kategorie.textContent = formatKategorieIcon(currentEmail.kategorie || 'normal');
  begruendung.textContent = 'Analysiere...';
  sicherheit.textContent = '-';

  // Prüfe ob bereits Gedanken vorhanden
  if (currentEmail.kiGedanken) {
    begruendung.textContent = currentEmail.kiGedanken;
    sicherheit.textContent = (currentEmail.kiSicherheit || '-') + '%';
    return;
  }

  // GPT fragen
  try {
    const result = await ipcRenderer.invoke('email:getKIAnalyse', {
      from: { address: currentEmail.from, name: currentEmail.fromName },
      subject: currentEmail.subject,
      text: currentEmail.body || currentEmail.snippet || ''
    });

    if (result && result.gedanken) {
      currentEmail.kiGedanken = result.gedanken;
      currentEmail.kiSicherheit = result.sicherheit || result.confidence;
      currentEmail.kategorie = result.kategorie;

      kategorie.textContent = formatKategorieIcon(result.kategorie);
      begruendung.textContent = result.gedanken;
      sicherheit.textContent = (result.sicherheit || result.confidence || '-') + '%';
    } else {
      begruendung.textContent = 'Keine Analyse verfügbar';
    }
  } catch (err) {
    console.error('[KI-ANALYSE] Fehler:', err);
    begruendung.textContent = 'Fehler bei der Analyse';
  }
}

function hideKIAnalyse() {
  document.getElementById('kiAnalyseBox')?.classList.add('hidden');
}

function formatKategorieIcon(kat) {
  const icons = {
    essenz: '🔴 Essenz',
    wichtig: '🟠 Wichtig',
    normal: '🔵 Normal',
    info: 'ℹ️ Info',
    newsletter: '📰 Newsletter',
    papierkorb: '🗑️ Papierkorb',
    werbung: '📢 Werbung'
  };
  return icons[kat] || kat;
}

// =============================================================================
// KI-REGELN VERWALTUNG
// =============================================================================

let currentEditRegelId = null;

// Regeln laden und anzeigen
async function loadKIRegeln() {
  try {
    const result = await ipcRenderer.invoke('regeln:getAll');
    const regeln = result.regeln || [];
    renderKIRegeln(regeln);
  } catch (err) {
    console.error('[KI-REGELN] Fehler beim Laden:', err);
  }
}

// Regeln in der Liste rendern
function renderKIRegeln(regeln) {
  const container = document.getElementById('kiRegelnListe');
  if (!container) return;

  if (regeln.length === 0) {
    container.innerHTML = '<div class="ki-regeln-empty">Noch keine Regeln gelernt.</div>';
    return;
  }

  container.innerHTML = regeln.map((regel, index) => `
    <div class="ki-regel-item" data-id="${regel.id}">
      <div class="ki-regel-header">
        <div class="ki-regel-nummer">${index + 1}</div>
        <div class="ki-regel-content">
          <div class="ki-regel-text">${escapeHtml(regel.text)}</div>
          <div class="ki-regel-kategorie">
            → <span class="ki-regel-kategorie-badge ${regel.kategorie}">${formatKategorieName(regel.kategorie).toUpperCase()}</span>
          </div>
        </div>
        <div class="ki-regel-actions">
          <button class="ki-regel-btn edit" onclick="editRegel(${regel.id})" title="Bearbeiten">✏️</button>
          <button class="ki-regel-btn delete" onclick="confirmDeleteRegel(${regel.id})" title="Löschen">🗑️</button>
        </div>
      </div>
      <div class="ki-regel-meta">
        <span>📅 ${formatRegelDate(regel.erstelltAm)}</span>
        <span>✓ ${regel.anwendungen || 0}x angewendet</span>
        <span>${regel.quelle === 'feedback' ? '🤖 Aus Feedback' : '✏️ Manuell'}</span>
      </div>
    </div>
  `).join('');
}

function formatRegelDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('de-DE');
}

// Modal für neue Regel öffnen
function openAddRegelModal() {
  currentEditRegelId = null;
  document.getElementById('regelModalTitle').textContent = '➕ Neue Regel';
  document.getElementById('regelTextInput').value = '';
  document.getElementById('regelKategorieSelect').value = 'wichtig';
  document.getElementById('regelModal').classList.remove('hidden');
}

// Modal für Regel bearbeiten öffnen
async function editRegel(regelId) {
  try {
    const result = await ipcRenderer.invoke('regeln:getAll');
    const regel = (result.regeln || []).find(r => r.id === regelId);
    if (!regel) return;

    currentEditRegelId = regelId;
    document.getElementById('regelModalTitle').textContent = '✏️ Regel bearbeiten';
    document.getElementById('regelTextInput').value = regel.text;
    document.getElementById('regelKategorieSelect').value = regel.kategorie;
    document.getElementById('regelModal').classList.remove('hidden');
  } catch (err) {
    console.error('[KI-REGELN] Fehler beim Laden:', err);
  }
}

// Regel speichern (neu oder bearbeiten)
async function saveRegel() {
  const text = document.getElementById('regelTextInput').value.trim();
  const kategorie = document.getElementById('regelKategorieSelect').value;

  if (!text) {
    showToast('Bitte gib eine Bedingung ein', 'warning');
    return;
  }

  try {
    if (currentEditRegelId) {
      // Bearbeiten
      await ipcRenderer.invoke('regeln:update', currentEditRegelId, text, kategorie);
      showToast('Regel aktualisiert!');
    } else {
      // Neue Regel
      await ipcRenderer.invoke('regeln:add', text, kategorie, 'manuell');
      showToast('Regel hinzugefügt!');
    }

    closeRegelModal();
    loadKIRegeln();
  } catch (err) {
    console.error('[KI-REGELN] Fehler beim Speichern:', err);
    showToast('Fehler beim Speichern', 'error');
  }
}

// Regel Modal schließen
function closeRegelModal() {
  document.getElementById('regelModal').classList.add('hidden');
  currentEditRegelId = null;
}

// Einzelne Regel löschen - Bestätigung
let deleteRegelId = null;

function confirmDeleteRegel(regelId) {
  deleteRegelId = regelId;
  document.getElementById('deleteRegelModal').classList.remove('hidden');
}

async function deleteRegel() {
  if (!deleteRegelId) return;

  try {
    await ipcRenderer.invoke('regeln:delete', deleteRegelId);
    showToast('Regel gelöscht!');
    document.getElementById('deleteRegelModal').classList.add('hidden');
    deleteRegelId = null;
    loadKIRegeln();
  } catch (err) {
    console.error('[KI-REGELN] Fehler beim Löschen:', err);
    showToast('Fehler beim Löschen', 'error');
  }
}

function closeDeleteRegelModal() {
  document.getElementById('deleteRegelModal').classList.add('hidden');
  deleteRegelId = null;
}

// Alle Regeln löschen
function openDeleteAllRegelnModal() {
  document.getElementById('deleteAllRegelnModal').classList.remove('hidden');
}

async function deleteAllRegeln() {
  try {
    await ipcRenderer.invoke('regeln:deleteAll');
    showToast('Alle Regeln gelöscht!');
    document.getElementById('deleteAllRegelnModal').classList.add('hidden');
    loadKIRegeln();
  } catch (err) {
    console.error('[KI-REGELN] Fehler beim Löschen:', err);
    showToast('Fehler beim Löschen', 'error');
  }
}

function closeDeleteAllRegelnModal() {
  document.getElementById('deleteAllRegelnModal').classList.add('hidden');
}

// Event Listeners für KI-Regeln
function setupKIRegelnListeners() {
  // Neue Regel Button
  document.getElementById('addRegelBtn')?.addEventListener('click', openAddRegelModal);

  // Alle löschen Button
  document.getElementById('deleteAllRegelnBtn')?.addEventListener('click', openDeleteAllRegelnModal);

  // Regel Modal
  document.getElementById('closeRegelModalBtn')?.addEventListener('click', closeRegelModal);
  document.getElementById('cancelRegelBtn')?.addEventListener('click', closeRegelModal);
  document.getElementById('saveRegelBtn')?.addEventListener('click', saveRegel);

  // Delete Regel Modal
  document.getElementById('closeDeleteRegelBtn')?.addEventListener('click', closeDeleteRegelModal);
  document.getElementById('cancelDeleteRegelBtn')?.addEventListener('click', closeDeleteRegelModal);
  document.getElementById('confirmDeleteRegelBtn')?.addEventListener('click', deleteRegel);

  // Delete All Modal
  document.getElementById('closeDeleteAllRegelnBtn')?.addEventListener('click', closeDeleteAllRegelnModal);
  document.getElementById('cancelDeleteAllRegelnBtn')?.addEventListener('click', closeDeleteAllRegelnModal);
  document.getElementById('confirmDeleteAllRegelnBtn')?.addEventListener('click', deleteAllRegeln);

  // Regeln laden wenn Settings geöffnet werden
  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    setTimeout(loadKIRegeln, 100);
  });
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
