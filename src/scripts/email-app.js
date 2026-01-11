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
let emailLimit = parseInt(localStorage.getItem('emailLimit') ?? '0'); // Standard: 0 (Alle)
let classifierStats = null;
let isClassifying = false;  // Flag um doppelte Klassifizierung zu verhindern
let stopAnalysisRequested = false;  // Flag um Analyse zu stoppen
let debugLog = [];  // Debug-Log für GPT-Gedanken

// Pagination State
let currentPage = 1;
let emailsPerPage = 30;
let visibleEmails = [];  // Aktuell sichtbare E-Mails (für KI-Analyse)

// Image Whitelist - Absender deren Bilder immer geladen werden
let imageWhitelist = JSON.parse(localStorage.getItem('imageWhitelist') || '[]');
let currentEmailHasBlockedImages = false;
let originalEmailHtml = '';  // Original HTML für Bild-Laden

// Contacts - Gespeicherte und abgelehnte Kontakte
let savedContacts = JSON.parse(localStorage.getItem('savedContacts') || '[]');
let dismissedContacts = JSON.parse(localStorage.getItem('dismissedContacts') || '[]');
let currentExtractedContact = null;  // Aktuell extrahierter Kontakt

// Payment Data - Extrahierte Zahlungsdaten
let currentPaymentData = null;

// Kategorie-Mapping für UI
const KATEGORIE_MAP = {
  essenz: { name: 'Essenz', icon: '🔴', color: '#ef4444' },
  wichtig: { name: 'Wichtig', icon: '🟠', color: '#f97316' },
  termine: { name: 'Termine', icon: '📅', color: '#0ea5e9' },
  rechnung: { name: 'Rechnung', icon: '📄', color: '#10b981' },
  info: { name: 'Info', icon: 'ℹ️', color: '#6b7280' },
  newsletter: { name: 'Newsletter', icon: '📰', color: '#8b5cf6' },
  werbung: { name: 'Werbung', icon: '📢', color: '#f59e0b' },
  spam: { name: 'Spam', icon: '🗑️', color: '#71717a' },
  veraltet: { name: 'Veraltet', icon: '⏰', color: '#a1a1aa' }
};

// Kategorie-Normalisierung (normal → info)
function normalizeKategorie(kategorie) {
  if (kategorie === 'normal') return 'info';
  if (kategorie === 'papierkorb') return 'spam';
  return kategorie;
}

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
document.addEventListener('DOMContentLoaded', async () => {
  // Email-Datenbank initialisieren
  await initEmailDatabase();

  initializeElements();
  setupEventListeners();
  setupProgressiveLoadingListeners();
  initKIFeedback();
  setupKIFeedbackListeners();
  setupKIRegelnListeners();
  await loadAccounts();
  // loadEmails wird bereits in loadAccounts() aufgerufen wenn nötig
  // Bei mehreren Konten explizit aufrufen
  if (accounts.length !== 1) {
    loadEmails();
  }
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
    imageBanner: document.getElementById('imageBanner'),
    loadImagesOnceBtn: document.getElementById('loadImagesOnceBtn'),
    loadImagesAlwaysBtn: document.getElementById('loadImagesAlwaysBtn'),
    attachmentsSection: document.getElementById('attachmentsSection'),
    attachmentsList: document.getElementById('attachmentsList'),

    // Contact Card
    contactCard: document.getElementById('contactCard'),
    contactCardTitle: document.getElementById('contactCardTitle'),
    contactCardClose: document.getElementById('contactCardClose'),
    contactAvatar: document.getElementById('contactAvatar'),
    contactInitials: document.getElementById('contactInitials'),
    contactName: document.getElementById('contactName'),
    contactCompany: document.getElementById('contactCompany'),
    contactPosition: document.getElementById('contactPosition'),
    contactDetails: document.getElementById('contactDetails'),
    addContactBtn: document.getElementById('addContactBtn'),
    dismissContactBtn: document.getElementById('dismissContactBtn'),

    // Payment Card
    paymentCard: document.getElementById('paymentCard'),
    paymentCardClose: document.getElementById('paymentCardClose'),
    paymentType: document.getElementById('paymentType'),
    paymentAmount: document.getElementById('paymentAmount'),
    paymentDue: document.getElementById('paymentDue'),
    paymentMinAmount: document.getElementById('paymentMinAmount'),
    paymentMinBox: document.getElementById('paymentMinBox'),
    paymentRecipient: document.getElementById('paymentRecipient'),
    paymentIban: document.getElementById('paymentIban'),
    paymentBic: document.getElementById('paymentBic'),
    paymentReference: document.getElementById('paymentReference'),
    paymentDueDate: document.getElementById('paymentDueDate'),
    timelineReminderDate: document.getElementById('timelineReminderDate'),
    timelineTransferDate: document.getElementById('timelineTransferDate'),
    timelineDueDate: document.getElementById('timelineDueDate'),
    createReminderBtn: document.getElementById('createReminderBtn'),
    preparePaymentBtn: document.getElementById('preparePaymentBtn'),

    // Conversation Card
    conversationCard: document.getElementById('conversationCard'),
    conversationCardClose: document.getElementById('conversationCardClose'),
    conversationCount: document.getElementById('conversationCount'),
    conversationSummaryText: document.getElementById('conversationSummaryText'),
    convStatReceived: document.getElementById('convStatReceived'),
    convStatSent: document.getElementById('convStatSent'),
    convStatResponseTime: document.getElementById('convStatResponseTime'),
    convStatTimespan: document.getElementById('convStatTimespan'),
    topicsList: document.getElementById('topicsList'),
    convTimelineList: document.getElementById('convTimelineList'),
    convQuickReplyBtn: document.getElementById('convQuickReplyBtn'),
    convViewAllBtn: document.getElementById('convViewAllBtn'),
    convArchiveBtn: document.getElementById('convArchiveBtn'),

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
    emailLimitSelect: document.getElementById('emailLimitSelect'),
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
  elements.refreshBtn.addEventListener('click', () => loadEmails(true)); // Force reload
  elements.composeBtn.addEventListener('click', composeNewEmail);

  // Email Actions
  elements.replyBtn.addEventListener('click', openReplyPanel);
  elements.analyzeBtn.addEventListener('click', analyzeCurrentEmail);
  elements.archiveBtn.addEventListener('click', archiveCurrentEmail);
  elements.starBtn.addEventListener('click', starCurrentEmail);
  elements.deleteBtn.addEventListener('click', deleteCurrentEmail);

  // Image Banner Actions
  if (elements.loadImagesOnceBtn) {
    elements.loadImagesOnceBtn.addEventListener('click', () => {
      if (currentEmail) {
        displayEmailContent(currentEmail, true);
        elements.imageBanner.classList.add('hidden');
      }
    });
  }
  if (elements.loadImagesAlwaysBtn) {
    elements.loadImagesAlwaysBtn.addEventListener('click', () => {
      if (currentEmail) {
        addToImageWhitelist(currentEmail);
        displayEmailContent(currentEmail, true);
        elements.imageBanner.classList.add('hidden');
      }
    });
  }

  // Contact Card Actions
  if (elements.contactCardClose) {
    elements.contactCardClose.addEventListener('click', hideContactCard);
  }
  if (elements.addContactBtn) {
    elements.addContactBtn.addEventListener('click', () => {
      if (currentExtractedContact) {
        saveContact(currentExtractedContact);
        hideContactCard();
      }
    });
  }
  if (elements.dismissContactBtn) {
    elements.dismissContactBtn.addEventListener('click', () => {
      if (currentExtractedContact?.email) {
        dismissContact(currentExtractedContact.email);
        hideContactCard();
      }
    });
  }

  // Payment Card Actions
  if (elements.paymentCardClose) {
    elements.paymentCardClose.addEventListener('click', hidePaymentCard);
  }
  if (elements.createReminderBtn) {
    elements.createReminderBtn.addEventListener('click', () => {
      if (currentPaymentData) {
        createPaymentReminder(currentPaymentData);
      }
    });
  }
  if (elements.preparePaymentBtn) {
    elements.preparePaymentBtn.addEventListener('click', () => {
      if (currentPaymentData) {
        preparePayment(currentPaymentData);
      }
    });
  }

  // Conversation Card Actions
  if (elements.conversationCardClose) {
    elements.conversationCardClose.addEventListener('click', hideConversationCard);
  }
  if (elements.convQuickReplyBtn) {
    elements.convQuickReplyBtn.addEventListener('click', generateContextualReply);
  }
  if (elements.convViewAllBtn) {
    elements.convViewAllBtn.addEventListener('click', showAllConversationEmails);
  }
  if (elements.convArchiveBtn) {
    elements.convArchiveBtn.addEventListener('click', archiveConversation);
  }

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

  // Email Limit Select
  if (elements.emailLimitSelect) {
    elements.emailLimitSelect.value = emailLimit.toString();
    elements.emailLimitSelect.addEventListener('change', (e) => {
      emailLimit = parseInt(e.target.value);
      localStorage.setItem('emailLimit', emailLimit.toString());
      console.log('[SETTINGS] E-Mail Limit geändert:', emailLimit === 0 ? 'Alle' : emailLimit);
      // Neu laden mit neuem Limit
      loadEmails();
    });
  }

  elements.autoReplySettingToggle.addEventListener('click', () => {
    autoReplyEnabled = !autoReplyEnabled;
    elements.autoReplySettingToggle.classList.toggle('active', autoReplyEnabled);
    elements.autoReplyToggle.classList.toggle('active', autoReplyEnabled);
  });

  // Clear All Data
  document.getElementById('clearAllDataBtn')?.addEventListener('click', clearAllData);

  // Theme Switcher
  setupThemeSwitcher();

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

  // Komplett neu aufbauen um doppelte Event-Listener zu vermeiden
  dropdown.innerHTML = '';

  // "Alle Konten" Item neu erstellen
  const allItem = document.createElement('div');
  allItem.className = 'account-dropdown-item';
  allItem.dataset.account = 'all';
  allItem.innerHTML = `
    <div class="dropdown-avatar all">✉</div>
    <div class="dropdown-info">
      <div class="dropdown-name">Alle Konten</div>
      <div class="dropdown-email" id="dropdownAllCount">${accounts.length} ${accounts.length === 1 ? 'Konto' : 'Konten'}</div>
    </div>
  `;
  allItem.addEventListener('click', () => selectAccount('all'));
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
}

// =============================================================================
// EMAIL LOADING
// =============================================================================

let isProgressiveLoading = false;
let progressiveLoadingTotal = 0;

// Progressive Loading Event Listener einrichten
function setupProgressiveLoadingListeners() {
  // Batch empfangen
  ipcRenderer.on('email:progressiveBatch', (_, batchData) => {
    console.log(`[EMAIL] Batch ${batchData.batchNumber}: ${batchData.emails.length} E-Mails (${batchData.progress}%)`);

    // E-Mails hinzufügen (nicht ersetzen!)
    emails.push(...batchData.emails);
    progressiveLoadingTotal = batchData.totalCount;

    // UI nach jedem Batch aktualisieren
    updateStats();
    updateCategoryCounts();
    renderEmailList();

    // Progress anzeigen
    updateLoadingProgress(batchData.totalLoaded, batchData.totalCount, batchData.progress);

    // Beim ersten Batch Loading-Overlay ausblenden (E-Mails sind jetzt sichtbar)
    if (batchData.isFirst) {
      hideLoading();
    }
  });

  // Loading abgeschlossen
  ipcRenderer.on('email:progressiveComplete', () => {
    console.log(`[EMAIL] Progressive Loading abgeschlossen: ${emails.length} E-Mails`);
    isProgressiveLoading = false;
    hideLoadingProgress();

    // Automatische Klassifizierung wenn aktiviert
    if (autoClassifyEnabled && emails.length > 0) {
      classifyAllEmails();
    }
  });
}

// Progress-Anzeige aktualisieren
function updateLoadingProgress(loaded, total, percent) {
  let progressBar = document.getElementById('emailLoadingProgress');

  if (!progressBar) {
    // Progress-Bar erstellen
    progressBar = document.createElement('div');
    progressBar.id = 'emailLoadingProgress';
    progressBar.className = 'email-loading-progress';
    progressBar.innerHTML = `
      <div class="progress-bar-container">
        <div class="progress-bar-fill"></div>
      </div>
      <span class="progress-text"></span>
    `;
    document.querySelector('.email-list-header')?.appendChild(progressBar);
  }

  progressBar.querySelector('.progress-bar-fill').style.width = `${percent}%`;
  progressBar.querySelector('.progress-text').textContent = `${loaded} / ${total} E-Mails (${percent}%)`;
  progressBar.classList.add('visible');
}

function hideLoadingProgress() {
  const progressBar = document.getElementById('emailLoadingProgress');
  if (progressBar) {
    progressBar.classList.remove('visible');
    setTimeout(() => progressBar.remove(), 300);
  }
}

// =============================================================================
// EMAIL DATABASE FUNCTIONS
// =============================================================================

/**
 * Initialisiert die Email-Datenbank
 */
async function initEmailDatabase() {
  try {
    const result = await ipcRenderer.invoke('emaildb:init');
    if (result.success) {
      console.log('[EMAIL-DB] Datenbank initialisiert');
    } else {
      console.error('[EMAIL-DB] Init fehlgeschlagen:', result.error);
    }
  } catch (error) {
    console.error('[EMAIL-DB] Init error:', error);
  }
}

/**
 * Speichert E-Mails in der lokalen Datenbank
 */
async function saveEmailsToDatabase(emailList, accountId) {
  if (!emailList || emailList.length === 0) return;

  try {
    const result = await ipcRenderer.invoke('emaildb:saveEmails', emailList, accountId);
    if (result.success) {
      console.log(`[EMAIL-DB] ${result.count} E-Mails gespeichert`);
    }
  } catch (error) {
    console.error('[EMAIL-DB] Save error:', error);
  }
}

/**
 * Holt Konversations-E-Mails aus der Datenbank
 */
async function getConversationFromDatabase(contactEmail, accountId = null) {
  try {
    const result = await ipcRenderer.invoke('emaildb:getConversation', contactEmail, accountId);
    if (result.success) {
      console.log(`[EMAIL-DB] Konversation geladen: ${result.emails.length} E-Mails`);
      return result;
    }
    return { emails: [], stats: {} };
  } catch (error) {
    console.error('[EMAIL-DB] Conversation error:', error);
    return { emails: [], stats: {} };
  }
}

async function loadEmails(forceReload = false) {
  console.log('[EMAIL] loadEmails() gestartet, accounts:', accounts.length, 'limit:', emailLimit, 'selectedAccount:', selectedAccountId, 'forceReload:', forceReload);
  showLoading();

  try {
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

    // IMAP separat behandeln
    if (selectedAccountId === 'imap' || selectedAccountId?.startsWith('imap-')) {
      return loadImapEmails();
    }

    // Progressive Loading wenn "Alle E-Mails" (0) gewählt
    if (emailLimit === 0 && selectedAccountId === 'all') {
      console.log('[EMAIL] Starte Progressive Loading...');
      emails = []; // Reset
      isProgressiveLoading = true;

      // Starte Progressive Loading (läuft async, Events kommen über Listener)
      const result = await ipcRenderer.invoke('email:startProgressiveLoading', 30);
      console.log('[EMAIL] Progressive Loading Ergebnis:', result);

      if (!result.success) {
        console.error('[EMAIL] Progressive Loading fehlgeschlagen:', result.error);
        hideLoading();
      }
      return;
    }

    // Inkrementelles Laden: Wenn wir bereits E-Mails haben und das Limit erhöht wurde
    const existingIds = (!forceReload && emails.length > 0) ? emails.map(e => e.id) : [];
    const isIncremental = existingIds.length > 0;

    if (isIncremental) {
      console.log(`[EMAIL] Inkrementelles Laden: ${existingIds.length} E-Mails bereits vorhanden, lade bis ${emailLimit}`);
    }

    // Standard-Loading (mit Limit)
    console.log('[EMAIL] Standard-Loading mit Limit:', emailLimit);
    let result;
    if (selectedAccountId === 'all') {
      console.log('[EMAIL] Rufe getUnifiedInbox auf...');
      result = await ipcRenderer.invoke('email:getUnifiedInbox', emailLimit, existingIds);
    } else {
      console.log('[EMAIL] Rufe getEmailsFromAccount auf für:', selectedAccountId);
      result = await ipcRenderer.invoke('email:getEmailsFromAccount', selectedAccountId, emailLimit, existingIds);
    }

    console.log('[EMAIL] Ergebnis:', result?.success, 'E-Mails:', result?.emails?.length || 0, 'isIncremental:', result?.isIncremental);

    // Kein Fallback mehr - wenn keine Konten, keine E-Mails
    if (!result || !result.success) {
      console.log('[EMAIL] Keine E-Mails:', result?.error || 'Kein Ergebnis');
      if (!isIncremental) {
        emails = [];
      }
      updateStats();
      updateCategoryCounts();
      renderEmailList();
      hideLoading();
      return;
    }

    if (result.success) {
      const newEmails = result.emails || [];

      // Bei inkrementellem Laden: Neue E-Mails anhängen
      if (result.isIncremental && isIncremental) {
        console.log(`[EMAIL] Inkrementell: ${newEmails.length} neue E-Mails hinzugefügt`);
        emails = [...emails, ...newEmails];
        // Nach Datum sortieren (neueste zuerst)
        emails.sort((a, b) => b.date - a.date);
      } else {
        emails = newEmails;
      }

      console.log(`[EMAIL] E-Mails geladen: ${emails.length} (${newEmails.length} neu)`);

      // Automatische Klassifizierung nur für neue E-Mails
      if (autoClassifyEnabled && newEmails.length > 0) {
        await classifyAllEmails();
      }

      // E-Mails in lokaler Datenbank speichern für Konversations-Übersicht
      if (newEmails.length > 0) {
        saveEmailsToDatabase(newEmails, selectedAccountId || 'all');
      }

      updateStats();
      updateCategoryCounts();
      renderEmailList();
    }
  } catch (error) {
    console.error('[EMAIL] Error loading emails:', error);
    if (emails.length === 0) {
      emails = [];
      updateStats();
      updateCategoryCounts();
      renderEmailList();
    }
  } finally {
    hideLoading();
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
          email.kategorie = normalizeKategorie(classification.kategorie);
          email.confidence = classification.confidence;
          email.tags = classification.tags || [];
          email.zusammenfassung = classification.zusammenfassung;
          email.aktion = classification.aktion;
          email.isImportant = email.kategorie === 'essenz' || email.kategorie === 'wichtig';
          email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
          email.isPapierkorb = email.kategorie === 'spam';
          email.isNewsletter = email.kategorie === 'newsletter';
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
      info: 0,
      werbung: 0,
      newsletter: 0,
      spam: 0,
      veraltet: 0
    };
    // Mapping: Klassifizierungs-Kategorie → Sidebar-Kategorie
    this.categoryMapping = {
      essenz: 'important',
      wichtig: 'important',
      termine: 'termine',
      rechnung: 'rechnung',
      info: 'info',
      werbung: 'werbung',
      newsletter: 'newsletter',
      spam: 'papierkorb',
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
            <div class="summary-stat-number spam" id="summaryPapierkorb">0</div>
            <div class="summary-stat-label">Spam</div>
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
        email.kategorie = normalizeKategorie(classification.kategorie);
        email.confidence = classification.confidence;
        email.tags = classification.tags || [];
        email.zusammenfassung = classification.zusammenfassung;
        email.aktion = classification.aktion;
        email.isImportant = email.kategorie === 'essenz' || email.kategorie === 'wichtig';
        email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
        email.isPapierkorb = email.kategorie === 'spam';
        email.isNewsletter = email.kategorie === 'newsletter';
        email.canAutoReply = classification.autoAntwortMöglich;

        // Animation starten: E-Mail fliegt zur Kategorie
        await this.animateEmailToCategory(email, email.kategorie, i);

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
      newsletter: 'Newsletter',
      sent: 'Gesendet',
      spam: 'Spam'
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
    document.getElementById('summaryInfo').textContent = this.counts.info || 0;
    document.getElementById('summaryNewsletter').textContent = this.counts.newsletter || 0;
    document.getElementById('summaryPapierkorb').textContent = this.counts.spam || 0;

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
    const result = await ipcRenderer.invoke('imap:getEmails', emailLimit);

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

      // E-Mails in Datenbank speichern für Konversations-Verlauf
      if (emails.length > 0) {
        const accountId = selectedAccountId || 'imap';
        console.log(`[EMAIL-DB] Speichere ${emails.length} IMAP E-Mails in DB...`);
        saveEmailsToDatabase(emails, accountId);
      }

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
    console.log('[ACCOUNTS] Loading accounts...');
    const result = await ipcRenderer.invoke('email:getAccounts');
    console.log('[ACCOUNTS] Result:', result);
    if (result.success) {
      accounts = result.accounts || [];
      console.log('[ACCOUNTS] Loaded accounts:', accounts.length, accounts);
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
    case 'inbox':
      // Posteingang: ALLE E-Mails zeigen (außer Spam)
      return emailList.filter(e => e.kategorie !== 'spam');
    case 'info':
      return emailList.filter(e => e.kategorie === 'info');
    case 'werbung':
      return emailList.filter(e => e.kategorie === 'werbung');
    case 'newsletter':
      return emailList.filter(e => e.kategorie === 'newsletter' || e.isNewsletter);
    case 'sent':
      return emailList.filter(e => e.isSent);
    case 'spam':
    case 'papierkorb':
      return emailList.filter(e => e.kategorie === 'spam' || e.kategorie === 'papierkorb' || e.isPapierkorb);
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
  let priorityClass = 'default';
  if (email.kategorie === 'essenz') priorityClass = 'high';
  else if (email.kategorie === 'wichtig') priorityClass = 'medium';
  else if (email.kategorie === 'info' || email.kategorie === 'werbung' || email.kategorie === 'termine' || email.kategorie === 'rechnung') priorityClass = 'default';
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

  // Anhang-Indikator
  if (email.hasAttachments || (email.attachments && email.attachments.length > 0)) {
    const count = email.attachments?.length || 1;
    tags.push(`<span class="email-tag attachment">📎 ${count}</span>`);
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

  // Account-Indikator (bei mehreren Konten)
  let accountHtml = '';
  if (accounts.length > 1 && email.accountEmail) {
    const shortEmail = email.accountEmail.split('@')[0];
    // Provider-spezifische Farben (inkl. IMAP-Provider)
    const providerColors = {
      'gmail': '#ea4335',      // Google Rot
      'outlook': '#0078d4',    // Microsoft Blau
      '1und1': '#0050aa',      // 1&1 Dunkelblau
      'gmx': '#ff6600',        // GMX Orange
      'webde': '#ffcc00',      // Web.de Gelb
      'tonline': '#e20074',    // T-Online Magenta
      'yahoo': '#6001d2',      // Yahoo Lila
      'aol': '#ff0000'         // AOL Rot
    };
    const accountColor = providerColors[email.provider] || '#6b7280';
    accountHtml = `<span class="email-account-badge" style="background: ${accountColor}20; color: ${accountColor}; border: 1px solid ${accountColor}40;" title="${email.accountEmail}">${shortEmail}</span>`;
  }

  item.innerHTML = `
    <div class="email-priority ${priorityClass}"></div>
    <div class="email-content">
      <div class="email-header">
        <span class="email-sender">${escapeHtml(email.fromName || email.from)}</span>
        <span class="email-time">${accountHtml}${confidenceHtml}${email.dateFormatted || formatDate(email.date)}</span>
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
// IMAGE HANDLING
// =============================================================================

/**
 * Prüft ob ein Absender in der Whitelist ist
 */
function isSenderWhitelisted(email) {
  if (!email || !email.from) return false;
  const senderEmail = email.from.toLowerCase();
  const senderDomain = senderEmail.split('@')[1];
  return imageWhitelist.some(entry =>
    entry === senderEmail || entry === senderDomain
  );
}

/**
 * Fügt Absender zur Whitelist hinzu
 */
function addToImageWhitelist(email, useDomain = true) {
  if (!email || !email.from) return;
  const senderEmail = email.from.toLowerCase();
  const entry = useDomain ? senderEmail.split('@')[1] : senderEmail;

  if (!imageWhitelist.includes(entry)) {
    imageWhitelist.push(entry);
    localStorage.setItem('imageWhitelist', JSON.stringify(imageWhitelist));
    console.log(`[IMAGE] Added to whitelist: ${entry}`);
  }
}

/**
 * Verarbeitet E-Mail HTML und blockiert externe Bilder
 */
function processEmailHtml(html, allowImages = false) {
  if (!html) return { html: '', hasBlockedImages: false };

  // Erstelle ein temporäres DOM-Element
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  let hasBlockedImages = false;

  // Finde alle Bilder
  const images = doc.querySelectorAll('img');

  images.forEach(img => {
    const src = img.getAttribute('src') || '';

    // Prüfe ob es ein externes Bild ist (http/https)
    if (src.startsWith('http://') || src.startsWith('https://')) {
      if (!allowImages) {
        hasBlockedImages = true;

        // Erstelle Platzhalter
        const placeholder = doc.createElement('div');
        placeholder.className = 'image-placeholder';
        placeholder.innerHTML = `
          <span class="image-placeholder-icon">🖼️</span>
          <span>Bild blockiert</span>
        `;

        // Ersetze das Bild mit dem Platzhalter
        img.parentNode.replaceChild(placeholder, img);
      }
    }
    // data: URLs und cid: (inline attachments) sind erlaubt
  });

  // Serialisiere zurück zu HTML
  return {
    html: doc.body.innerHTML,
    hasBlockedImages
  };
}

/**
 * Prüft ob Bilder für diese E-Mail-Kategorie blockiert werden sollen
 * Nur Newsletter, Werbung und Spam werden blockiert
 */
function shouldBlockImagesForEmail(email) {
  if (!email) return false;
  const kategorie = (email.kategorie || '').toLowerCase();
  // Nur diese Kategorien blockieren
  const blockCategories = ['newsletter', 'werbung', 'spam', 'papierkorb'];
  return blockCategories.includes(kategorie);
}

/**
 * Zeigt E-Mail Inhalt mit intelligenter Bildverarbeitung an
 * Bilder werden nur bei Newsletter/Werbung/Spam blockiert
 */
function displayEmailContent(email, forceLoadImages = false) {
  // Bilder erlauben wenn: erzwungen, whitelisted, oder wichtige Kategorie
  const shouldBlock = shouldBlockImagesForEmail(email);
  const allowImages = forceLoadImages || isSenderWhitelisted(email) || !shouldBlock;

  if (email.html) {
    if (allowImages) {
      // Bilder normal laden
      elements.detailBody.innerHTML = email.html;
      currentEmailHasBlockedImages = false;
      if (elements.imageBanner) {
        elements.imageBanner.classList.add('hidden');
      }
    } else {
      // Bilder blockieren (nur Newsletter/Werbung/Spam)
      const { html, hasBlockedImages } = processEmailHtml(email.html, false);
      elements.detailBody.innerHTML = html;
      currentEmailHasBlockedImages = hasBlockedImages;
      originalEmailHtml = email.html;

      if (hasBlockedImages && elements.imageBanner) {
        elements.imageBanner.classList.remove('hidden');
      } else if (elements.imageBanner) {
        elements.imageBanner.classList.add('hidden');
      }
    }
  } else {
    elements.detailBody.textContent = email.body || email.snippet || 'Kein Inhalt';
    currentEmailHasBlockedImages = false;
    if (elements.imageBanner) {
      elements.imageBanner.classList.add('hidden');
    }
  }
}

// =============================================================================
// CONTACT EXTRACTION
// =============================================================================

/**
 * Prüft ob ein Kontakt bereits gespeichert oder abgelehnt wurde
 */
function isContactKnown(email) {
  if (!email || !email.from) return true;
  const emailLower = email.from.toLowerCase();
  return savedContacts.some(c => c.email?.toLowerCase() === emailLower) ||
         dismissedContacts.includes(emailLower);
}

/**
 * Extrahiert Kontaktdaten aus E-Mail mittels GPT
 * NUR wenn echte Signatur-Daten gefunden werden (Telefon, Website, Position)
 */
async function extractContactFromEmail(email) {
  if (!email) return null;

  // Bereits bekannt? Nicht erneut extrahieren
  if (isContactKnown(email)) {
    console.log('[CONTACT] Kontakt bereits bekannt:', email.from);
    return null;
  }

  // Nur bei wichtigen Kategorien extrahieren (nicht Newsletter/Spam)
  const skipCategories = ['newsletter', 'werbung', 'spam', 'papierkorb'];
  if (skipCategories.includes(email.kategorie?.toLowerCase())) {
    console.log('[CONTACT] Überspringe Kategorie:', email.kategorie);
    return null;
  }

  // Keine Kontakt-Karte für automatisierte Absender
  const automatedSenders = [
    'noreply', 'no-reply', 'newsletter', 'info@', 'support@', 'service@',
    'notification', 'alert', 'mailer', 'mail@', 'postmaster', 'daemon',
    'donotreply', 'auto', 'system', 'admin@', 'webmaster'
  ];
  const fromLower = (email.from || '').toLowerCase();
  if (automatedSenders.some(s => fromLower.includes(s))) {
    console.log('[CONTACT] Automatisierter Absender, überspringe:', email.from);
    return null;
  }

  console.log('[CONTACT] Extrahiere Kontakt aus:', email.from);

  try {
    const result = await ipcRenderer.invoke('contact:extract', {
      from: email.from,
      fromName: email.fromName,
      subject: email.subject,
      body: email.body || '',
      html: email.html || ''
    });

    if (result && result.success && result.contact) {
      // NUR anzeigen wenn echte Signatur-Daten gefunden wurden
      const contact = result.contact;
      const hasRealData = contact.phone || contact.position ||
                          (contact.website && !contact.website.includes('static-assets') &&
                           !contact.website.includes('cdn') && !contact.website.includes('mail'));

      if (hasRealData) {
        console.log('[CONTACT] Echte Signatur-Daten gefunden:', contact);
        return contact;
      } else {
        console.log('[CONTACT] Keine echten Signatur-Daten, überspringe');
        return null;
      }
    }
  } catch (error) {
    console.error('[CONTACT] Extraction error:', error);
  }

  // KEIN Fallback mehr - nur echte Signaturen anzeigen
  return null;
}

/**
 * Zeigt die Kontakt-Karte an
 */
function showContactCard(contact) {
  if (!contact || !elements.contactCard) return;

  currentExtractedContact = contact;

  // Titel
  const isNew = !savedContacts.some(c => c.email?.toLowerCase() === contact.email?.toLowerCase());
  elements.contactCardTitle.textContent = isNew ? 'Neuer Kontakt erkannt' : 'Kontakt';

  // Initialen
  const initials = getInitials(contact.name || contact.email);
  elements.contactInitials.textContent = initials;

  // Name, Firma, Position
  elements.contactName.textContent = contact.name || contact.email;
  elements.contactCompany.textContent = contact.company || '';
  elements.contactCompany.style.display = contact.company ? 'block' : 'none';
  elements.contactPosition.textContent = contact.position || '';
  elements.contactPosition.style.display = contact.position ? 'block' : 'none';

  // Details aufbauen
  let detailsHtml = '';

  if (contact.email) {
    detailsHtml += `
      <div class="contact-detail-row">
        <span class="contact-detail-icon">📧</span>
        <span class="contact-detail-value"><a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></span>
        <span class="contact-detail-badge">${contact.emailSource || 'Header'}</span>
      </div>
    `;
  }

  if (contact.phone) {
    detailsHtml += `
      <div class="contact-detail-row">
        <span class="contact-detail-icon">📱</span>
        <span class="contact-detail-value"><a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phone)}</a></span>
        <span class="contact-detail-badge">Signatur</span>
      </div>
    `;
  }

  if (contact.website) {
    const url = contact.website.startsWith('http') ? contact.website : 'https://' + contact.website;
    detailsHtml += `
      <div class="contact-detail-row">
        <span class="contact-detail-icon">🌐</span>
        <span class="contact-detail-value"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(contact.website)}</a></span>
        <span class="contact-detail-badge">Signatur</span>
      </div>
    `;
  }

  if (contact.address) {
    detailsHtml += `
      <div class="contact-detail-row">
        <span class="contact-detail-icon">📍</span>
        <span class="contact-detail-value">${escapeHtml(contact.address)}</span>
        <span class="contact-detail-badge">Signatur</span>
      </div>
    `;
  }

  elements.contactDetails.innerHTML = detailsHtml;

  // Karte anzeigen
  elements.contactCard.classList.remove('hidden');
}

/**
 * Versteckt die Kontakt-Karte
 */
function hideContactCard() {
  if (elements.contactCard) {
    elements.contactCard.classList.add('hidden');
  }
  currentExtractedContact = null;
}

/**
 * Speichert den extrahierten Kontakt
 */
function saveContact(contact) {
  if (!contact || !contact.email) return;

  // Prüfen ob bereits vorhanden
  const existingIndex = savedContacts.findIndex(c =>
    c.email?.toLowerCase() === contact.email.toLowerCase()
  );

  if (existingIndex >= 0) {
    // Aktualisieren
    savedContacts[existingIndex] = { ...savedContacts[existingIndex], ...contact };
  } else {
    // Neu hinzufügen
    savedContacts.push({
      ...contact,
      savedAt: new Date().toISOString()
    });
  }

  localStorage.setItem('savedContacts', JSON.stringify(savedContacts));
  console.log('[CONTACT] Gespeichert:', contact.email);
}

/**
 * Lehnt einen Kontakt ab (wird nicht mehr angezeigt)
 */
function dismissContact(email) {
  if (!email) return;
  const emailLower = email.toLowerCase();

  if (!dismissedContacts.includes(emailLower)) {
    dismissedContacts.push(emailLower);
    localStorage.setItem('dismissedContacts', JSON.stringify(dismissedContacts));
    console.log('[CONTACT] Abgelehnt:', email);
  }
}

/**
 * Generiert Initialen aus einem Namen
 */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// =============================================================================
// PAYMENT/INVOICE EXTRACTION
// =============================================================================

/**
 * Prüft ob eine E-Mail eine Rechnung/Zahlungsaufforderung ist
 */
function isInvoiceEmail(email) {
  if (!email) return false;

  // Kategorie-Check
  if (email.kategorie === 'rechnung' || email.kategorie === 'finanzen') {
    return true;
  }

  // Betreff-Keywords
  const invoiceKeywords = [
    'rechnung', 'invoice', 'zahlung', 'payment', 'mahnung',
    'kontoauszug', 'kreditkarte', 'mastercard', 'visa',
    'abbuchung', 'lastschrift', 'überweisung', 'fällig',
    'betrag', 'saldo', 'guthaben', 'schulden', 'rate'
  ];

  const subject = (email.subject || '').toLowerCase();
  const hasInvoiceSubject = invoiceKeywords.some(kw => subject.includes(kw));

  // Bekannte Rechnungs-Absender
  const invoiceSenders = [
    'advanzia', 'barclays', 'paypal', 'klarna', 'amazon',
    'telekom', 'vodafone', 'o2', '1und1', 'ionos',
    'netflix', 'spotify', 'apple', 'google', 'microsoft',
    'versicherung', 'allianz', 'huk', 'ergo', 'axa',
    'stadtwerke', 'strom', 'gas', 'wasser'
  ];

  const from = (email.from || '').toLowerCase();
  const hasInvoiceSender = invoiceSenders.some(s => from.includes(s));

  return hasInvoiceSubject || hasInvoiceSender;
}

/**
 * Extrahiert Zahlungsdaten aus E-Mail
 */
async function extractPaymentData(email) {
  if (!email) return null;

  // Nicht bei Newsletter/Spam
  const skipCategories = ['newsletter', 'werbung', 'spam', 'papierkorb'];
  if (skipCategories.includes(email.kategorie?.toLowerCase())) {
    return null;
  }

  // Prüfen ob Rechnung
  if (!isInvoiceEmail(email)) {
    return null;
  }

  console.log('[PAYMENT] Extrahiere Zahlungsdaten aus:', email.subject);

  try {
    // Server-basierte Extraktion
    const result = await ipcRenderer.invoke('payment:extract', {
      from: email.from,
      subject: email.subject,
      body: email.body || '',
      html: email.html || ''
    });

    if (result && result.success && result.payment) {
      console.log('[PAYMENT] Extrahiert:', result.payment);
      return result.payment;
    }
  } catch (error) {
    console.error('[PAYMENT] Server extraction error:', error);
  }

  // Fallback: Lokale Extraktion
  return extractPaymentLocally(email);
}

/**
 * Lokale Zahlungsdaten-Extraktion
 */
function extractPaymentLocally(email) {
  const text = email.body || '';
  const html = email.html || '';
  const content = text || html.replace(/<[^>]*>/g, ' ');

  const payment = {
    type: 'Rechnung',
    recipient: email.fromName || email.from?.split('@')[0] || 'Unbekannt'
  };

  // IBAN extrahieren (DE, AT, CH, LU, etc.)
  const ibanMatch = content.match(/[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){4,7}\d{1,4}/i);
  if (ibanMatch) {
    payment.iban = ibanMatch[0].replace(/\s/g, '').toUpperCase();
  }

  // BIC extrahieren
  const bicMatch = content.match(/[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?/);
  if (bicMatch && bicMatch[0].length >= 8) {
    payment.bic = bicMatch[0];
  }

  // Betrag extrahieren
  const amountPatterns = [
    /(?:gesamt|total|betrag|summe|saldo)[:\s]*([0-9.,]+)\s*(?:€|EUR)/i,
    /([0-9]+[.,][0-9]{2})\s*(?:€|EUR)/g,
    /(?:€|EUR)\s*([0-9]+[.,][0-9]{2})/g
  ];

  for (const pattern of amountPatterns) {
    const match = content.match(pattern);
    if (match) {
      const amountStr = match[1] || match[0];
      const amount = parseFloat(amountStr.replace(/[^\d,.-]/g, '').replace(',', '.'));
      if (amount > 0 && !payment.amount) {
        payment.amount = amount;
        payment.currency = 'EUR';
      }
    }
  }

  // Mindestbetrag (für Kreditkarten)
  const minMatch = content.match(/(?:mindest|minimum)[:\s]*([0-9.,]+)\s*(?:€|EUR)/i);
  if (minMatch) {
    payment.minimumAmount = parseFloat(minMatch[1].replace(',', '.'));
  }

  // Fälligkeitsdatum
  const datePatterns = [
    /(?:fällig|zahlbar|bis zum|spätestens)[:\s]*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/i,
    /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/g
  ];

  for (const pattern of datePatterns) {
    const match = content.match(pattern);
    if (match) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]);
      let year = parseInt(match[3]);
      if (year < 100) year += 2000;

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        payment.dueDate = new Date(year, month - 1, day);
        break;
      }
    }
  }

  // Verwendungszweck
  const refMatch = content.match(/(?:verwendungszweck|referenz|betreff|kundennummer)[:\s]*([^\n]{5,50})/i);
  if (refMatch) {
    payment.reference = refMatch[1].trim();
  }

  // Typ erkennen
  if (content.toLowerCase().includes('kreditkarte') || content.toLowerCase().includes('mastercard') || content.toLowerCase().includes('visa')) {
    payment.type = 'Kreditkartenabrechnung';
  } else if (content.toLowerCase().includes('mahnung')) {
    payment.type = 'Mahnung';
  } else if (content.toLowerCase().includes('versicherung')) {
    payment.type = 'Versicherungsbeitrag';
  }

  // Nur zurückgeben wenn wir mindestens Betrag oder IBAN haben
  if (payment.amount || payment.iban) {
    return payment;
  }

  return null;
}

/**
 * Zeigt die Zahlungskarte an
 */
function showPaymentCard(payment) {
  if (!payment || !elements.paymentCard) return;

  currentPaymentData = payment;

  // Typ
  elements.paymentType.textContent = payment.type || 'Rechnung';

  // Beträge
  if (payment.amount) {
    elements.paymentAmount.textContent = formatCurrency(payment.amount, payment.currency);
  } else {
    elements.paymentAmount.textContent = '-';
  }

  // Fälligkeit
  if (payment.dueDate) {
    const daysUntil = Math.ceil((new Date(payment.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) {
      elements.paymentDue.textContent = `⚠️ Überfällig!`;
      elements.paymentDue.style.color = '#ef4444';
    } else if (daysUntil <= 3) {
      elements.paymentDue.textContent = `⚠️ Fällig in ${daysUntil} Tag${daysUntil !== 1 ? 'en' : ''}`;
      elements.paymentDue.style.color = '#ef4444';
    } else if (daysUntil <= 7) {
      elements.paymentDue.textContent = `Fällig in ${daysUntil} Tagen`;
      elements.paymentDue.style.color = '#f59e0b';
    } else {
      elements.paymentDue.textContent = `Fällig in ${daysUntil} Tagen`;
      elements.paymentDue.style.color = '';
    }
  } else {
    elements.paymentDue.textContent = '';
  }

  // Mindestbetrag
  if (payment.minimumAmount) {
    elements.paymentMinAmount.textContent = formatCurrency(payment.minimumAmount, payment.currency);
    elements.paymentMinBox.style.display = '';
  } else {
    elements.paymentMinBox.style.display = 'none';
  }

  // Details
  elements.paymentRecipient.textContent = payment.recipient || '-';
  elements.paymentIban.textContent = payment.iban ? formatIban(payment.iban) : '-';
  elements.paymentBic.textContent = payment.bic || '-';
  elements.paymentReference.textContent = payment.reference || '-';
  elements.paymentDueDate.textContent = payment.dueDate ? formatDateShort(new Date(payment.dueDate)) : '-';

  // Timeline berechnen
  if (payment.dueDate) {
    const dueDate = new Date(payment.dueDate);
    const today = new Date();

    // Erinnerung: 7 Tage vor Fälligkeit
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - 7);
    if (reminderDate < today) reminderDate.setTime(today.getTime());

    // Überweisung: 3 Werktage vor Fälligkeit
    const transferDate = new Date(dueDate);
    transferDate.setDate(transferDate.getDate() - 3);
    if (transferDate < today) transferDate.setTime(today.getTime());

    elements.timelineReminderDate.textContent = formatDateShort(reminderDate);
    elements.timelineTransferDate.textContent = formatDateShort(transferDate);
    elements.timelineDueDate.textContent = formatDateShort(dueDate);
  }

  // Karte anzeigen
  elements.paymentCard.classList.remove('hidden');
}

/**
 * Versteckt die Zahlungskarte
 */
function hidePaymentCard() {
  if (elements.paymentCard) {
    elements.paymentCard.classList.add('hidden');
  }
  currentPaymentData = null;
}

/**
 * Erstellt eine Erinnerung für die Zahlung
 */
function createPaymentReminder(payment) {
  if (!payment) return;

  const reminderDate = payment.dueDate
    ? new Date(new Date(payment.dueDate).getTime() - 7 * 24 * 60 * 60 * 1000)
    : new Date();

  const title = `Zahlung: ${payment.recipient || 'Rechnung'}`;
  const body = `Betrag: ${formatCurrency(payment.amount || 0, payment.currency)}\n` +
               `Fällig: ${payment.dueDate ? formatDateShort(new Date(payment.dueDate)) : 'Unbekannt'}\n` +
               `IBAN: ${payment.iban || '-'}`;

  // Hier könnte eine echte Kalender-Integration erfolgen
  // Für jetzt: Desktop-Notification
  ipcRenderer.invoke('notification:show', {
    title: '🔔 Erinnerung erstellt',
    body: `${title}\n${body}`
  }).catch(console.error);

  alert(`Erinnerung erstellt für: ${formatDateShort(reminderDate)}\n\n${title}\n${body}`);
}

/**
 * Bereitet eine Überweisung vor (öffnet Banking-Link oder kopiert Daten)
 */
function preparePayment(payment) {
  if (!payment) return;

  // Überweisungsdaten in die Zwischenablage kopieren
  const paymentText = [
    `Empfänger: ${payment.recipient || '-'}`,
    `IBAN: ${payment.iban || '-'}`,
    `BIC: ${payment.bic || '-'}`,
    `Betrag: ${formatCurrency(payment.amount || 0, payment.currency)}`,
    `Verwendungszweck: ${payment.reference || '-'}`
  ].join('\n');

  navigator.clipboard.writeText(paymentText).then(() => {
    alert('Überweisungsdaten in die Zwischenablage kopiert:\n\n' + paymentText);
  }).catch(() => {
    alert('Überweisungsdaten:\n\n' + paymentText);
  });
}

/**
 * Formatiert einen Betrag als Währung
 */
function formatCurrency(amount, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

/**
 * Formatiert IBAN mit Leerzeichen
 */
function formatIban(iban) {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Formatiert Datum kurz
 */
function formatDateShort(date) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit'
  }).format(date);
}

// =============================================================================
// CONVERSATION OVERVIEW (Konversations-Übersicht)
// =============================================================================

// Aktuelle Konversationsdaten
let currentConversationData = null;

/**
 * Findet alle E-Mails einer Konversation (gleicher Absender/Empfänger)
 */
function getConversationEmails(email) {
  if (!email || !email.from) return [];

  const contactEmail = email.from.toLowerCase();
  const contactDomain = contactEmail.split('@')[1];

  // Finde alle E-Mails mit diesem Kontakt
  return emails.filter(e => {
    const eFrom = (e.from || '').toLowerCase();
    // Von diesem Kontakt empfangen
    if (eFrom === contactEmail || eFrom.endsWith('@' + contactDomain)) {
      return true;
    }
    // An diesen Kontakt gesendet (falls wir gesendete E-Mails haben)
    if (e.isSent && e.to) {
      const eTo = (e.to || '').toLowerCase();
      return eTo === contactEmail || eTo.includes(contactEmail);
    }
    return false;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Analysiert die Konversation und erstellt Statistiken
 * Nutzt zuerst die Datenbank, dann Fallback auf In-Memory
 */
async function analyzeConversation(email) {
  if (!email) return null;

  // Nur bei wichtigen Kategorien anzeigen (nicht Newsletter/Spam)
  const skipCategories = ['newsletter', 'werbung', 'spam', 'papierkorb'];
  if (skipCategories.includes(email.kategorie?.toLowerCase())) {
    return null;
  }

  // Extrahiere Kontakt-Email
  let contactEmail = email.from || '';
  if (contactEmail.includes('<')) {
    const match = contactEmail.match(/<(.+?)>/);
    if (match) contactEmail = match[1];
  }
  contactEmail = contactEmail.toLowerCase().trim();

  if (!contactEmail) return null;

  // Versuche zuerst aus der Datenbank zu laden (enthält ALLE E-Mails)
  let conversationEmails = [];
  let dbStats = null;

  try {
    const dbResult = await getConversationFromDatabase(contactEmail, selectedAccountId);
    if (dbResult.emails && dbResult.emails.length > 0) {
      conversationEmails = dbResult.emails;
      dbStats = dbResult.stats;
      console.log(`[CONVERSATION] DB: ${conversationEmails.length} E-Mails gefunden`);
    }
  } catch (error) {
    console.log('[CONVERSATION] DB-Abfrage fehlgeschlagen, nutze In-Memory');
  }

  // Fallback: In-Memory Array (nur aktuell geladene E-Mails)
  if (conversationEmails.length === 0) {
    conversationEmails = getConversationEmails(email);
  }

  // Mindestens 2 E-Mails für Konversations-Übersicht
  if (conversationEmails.length < 2) {
    console.log('[CONVERSATION] Weniger als 2 E-Mails, keine Übersicht');
    return null;
  }

  console.log('[CONVERSATION] Analysiere Konversation mit', conversationEmails.length, 'E-Mails');

  // Statistiken berechnen
  const received = conversationEmails.filter(e => !e.isSent).length;
  const sent = conversationEmails.filter(e => e.isSent).length;

  // Zeitraum
  const dates = conversationEmails.map(e => new Date(e.date)).filter(d => !isNaN(d));
  const firstDate = dates.length > 0 ? new Date(Math.min(...dates)) : null;
  const lastDate = dates.length > 0 ? new Date(Math.max(...dates)) : null;

  let timespan = '-';
  if (firstDate && lastDate) {
    const days = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24));
    if (days === 0) {
      timespan = 'Heute';
    } else if (days === 1) {
      timespan = '1 Tag';
    } else if (days < 7) {
      timespan = `${days} Tage`;
    } else if (days < 30) {
      const weeks = Math.round(days / 7);
      timespan = `${weeks} Woche${weeks > 1 ? 'n' : ''}`;
    } else {
      const months = Math.round(days / 30);
      timespan = `${months} Monat${months > 1 ? 'e' : ''}`;
    }
  }

  // Durchschnittliche Antwortzeit berechnen (vereinfacht)
  let avgResponseTime = '-';
  if (conversationEmails.length >= 2) {
    const responseTimes = [];
    for (let i = 1; i < conversationEmails.length; i++) {
      const diff = new Date(conversationEmails[i-1].date) - new Date(conversationEmails[i].date);
      if (diff > 0) {
        responseTimes.push(diff);
      }
    }
    if (responseTimes.length > 0) {
      const avgMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const avgHours = Math.round(avgMs / (1000 * 60 * 60));
      if (avgHours < 1) {
        avgResponseTime = '< 1h';
      } else if (avgHours < 24) {
        avgResponseTime = `${avgHours}h`;
      } else {
        const avgDays = Math.round(avgHours / 24);
        avgResponseTime = `${avgDays}d`;
      }
    }
  }

  // Themen extrahieren (aus Betreffzeilen)
  const topics = extractTopicsFromConversation(conversationEmails);

  // KI-Zusammenfassung (lokal oder via Server)
  let summary = await generateConversationSummary(conversationEmails, email);

  return {
    totalEmails: conversationEmails.length,
    received,
    sent,
    timespan,
    avgResponseTime,
    topics,
    summary,
    emails: conversationEmails.slice(0, 10) // Nur die letzten 10 für Timeline
  };
}

/**
 * Extrahiert Themen aus der Konversation
 */
function extractTopicsFromConversation(conversationEmails) {
  const topics = {};

  // Häufige Stoppwörter
  const stopWords = new Set([
    'der', 'die', 'das', 'und', 'oder', 'aber', 'ein', 'eine', 'einer',
    'den', 'dem', 'des', 'für', 'mit', 'von', 'bei', 'nach', 'aus',
    'auf', 'ist', 'sind', 'war', 'hat', 'haben', 'wird', 'werden',
    're:', 'aw:', 'fwd:', 'wg:', 'betr:', 'antw:', 'the', 'and', 'you',
    'your', 'our', 'we', 'to', 'for', 'with', 'from', 'this', 'that'
  ]);

  conversationEmails.forEach(email => {
    // Betreff analysieren
    const subject = (email.subject || '')
      .toLowerCase()
      .replace(/^(re:|aw:|fwd:|wg:|betr:|antw:)\s*/gi, '')
      .trim();

    // Wörter extrahieren
    const words = subject
      .split(/[\s,.:;!?()[\]{}]+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    words.forEach(word => {
      topics[word] = (topics[word] || 0) + 1;
    });

    // Kategorien als Themen
    if (email.kategorie && !['info', 'normal'].includes(email.kategorie)) {
      const katName = KATEGORIE_MAP[email.kategorie]?.name || email.kategorie;
      topics[katName] = (topics[katName] || 0) + 1;
    }
  });

  // Nach Häufigkeit sortieren und Top 5 zurückgeben
  return Object.entries(topics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([topic, count]) => ({ topic: topic.charAt(0).toUpperCase() + topic.slice(1), count }));
}

/**
 * Generiert eine Zusammenfassung der Konversation
 */
async function generateConversationSummary(conversationEmails, currentEmail) {
  // Versuche Server-basierte Zusammenfassung
  try {
    const result = await ipcRenderer.invoke('conversation:summarize', {
      emails: conversationEmails.slice(0, 5).map(e => ({
        subject: e.subject,
        from: e.from,
        date: e.date,
        snippet: e.snippet || e.body?.substring(0, 200),
        isSent: e.isSent
      })),
      currentSubject: currentEmail.subject
    });

    if (result && result.success && result.summary) {
      return result.summary;
    }
  } catch (error) {
    console.warn('[CONVERSATION] Server summary failed:', error);
  }

  // Fallback: Lokale Zusammenfassung
  const count = conversationEmails.length;
  const contactName = currentEmail.fromName || currentEmail.from?.split('@')[0] || 'Kontakt';
  const firstEmail = conversationEmails[conversationEmails.length - 1];
  const lastEmail = conversationEmails[0];

  const firstDate = firstEmail ? formatDateShort(new Date(firstEmail.date)) : '';
  const lastDate = lastEmail ? formatDateShort(new Date(lastEmail.date)) : '';

  return `${count} E-Mails mit ${contactName} seit ${firstDate}. ` +
         `Letzte Nachricht: "${lastEmail?.subject || 'Kein Betreff'}"`;
}

/**
 * Gruppiert E-Mails nach Datum (Heute, Gestern, Letzte Woche, etc.)
 */
function groupEmailsByDate(emails) {
  const groups = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const todayEmails = [];
  const yesterdayEmails = [];
  const thisWeekEmails = [];
  const lastWeekEmails = [];
  const olderEmails = [];

  emails.forEach(email => {
    const emailDate = new Date(email.date);
    const emailDay = new Date(emailDate.getFullYear(), emailDate.getMonth(), emailDate.getDate());

    if (emailDay.getTime() === today.getTime()) {
      todayEmails.push(email);
    } else if (emailDay.getTime() === yesterday.getTime()) {
      yesterdayEmails.push(email);
    } else if (emailDay >= thisWeekStart) {
      thisWeekEmails.push(email);
    } else if (emailDay >= lastWeekStart) {
      lastWeekEmails.push(email);
    } else {
      olderEmails.push(email);
    }
  });

  if (todayEmails.length > 0) {
    groups.push({ label: 'Heute', emails: todayEmails });
  }
  if (yesterdayEmails.length > 0) {
    groups.push({ label: 'Gestern', emails: yesterdayEmails });
  }
  if (thisWeekEmails.length > 0) {
    const label = thisWeekEmails.length > 2 ? `Diese Woche • ${thisWeekEmails.length} E-Mails` : 'Diese Woche';
    groups.push({ label, emails: thisWeekEmails });
  }
  if (lastWeekEmails.length > 0) {
    const label = lastWeekEmails.length > 2 ? `Letzte Woche • ${lastWeekEmails.length} E-Mails` : 'Letzte Woche';
    groups.push({ label, emails: lastWeekEmails });
  }
  if (olderEmails.length > 0) {
    // Gruppiere ältere nach Monat
    const firstOld = olderEmails[olderEmails.length - 1];
    const firstDate = new Date(firstOld.date);
    const monthName = firstDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const label = olderEmails.length > 1 ? `${monthName} • ${olderEmails.length} E-Mails` : `${monthName} • Erste E-Mail`;
    groups.push({ label, emails: olderEmails });
  }

  return groups;
}

/**
 * Zeigt die Konversations-Übersicht an (Mockup Design)
 */
function showConversationCard(data) {
  if (!data) return;

  currentConversationData = data;

  const conversationCard = document.getElementById('conversationCard');
  const conversationSummaryText = document.getElementById('conversationSummaryText');
  const convStatFirstContact = document.getElementById('convStatFirstContact');
  const convStatEmailCount = document.getElementById('convStatEmailCount');
  const convStatResponseTime = document.getElementById('convStatResponseTime');
  const convStatStatus = document.getElementById('convStatStatus');
  const topicsList = document.getElementById('topicsList');
  const convTimelineList = document.getElementById('convTimelineList');
  const timelineCount = document.getElementById('timelineCount');

  if (!conversationCard) return;

  // Zusammenfassung (mit HTML-Unterstützung für strong-Tags)
  if (conversationSummaryText) {
    const summaryHtml = (data.summary || 'Keine Zusammenfassung verfügbar')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    conversationSummaryText.innerHTML = summaryHtml;
  }

  // Statistiken - Mockup Style
  if (convStatFirstContact) {
    // Erster Kontakt aus ältester E-Mail
    const firstEmail = data.emails?.[data.emails.length - 1];
    if (firstEmail?.date) {
      const firstDate = new Date(firstEmail.date);
      convStatFirstContact.textContent = firstDate.toLocaleDateString('de-DE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } else {
      convStatFirstContact.textContent = data.timespan || '-';
    }
  }

  if (convStatEmailCount) {
    // Format: "12 (6↓ 6↑)"
    const received = data.received || 0;
    const sent = data.sent || 0;
    const total = data.totalEmails || (received + sent);
    convStatEmailCount.textContent = `${total} (${received}↓ ${sent}↑)`;
  }

  if (convStatResponseTime) {
    convStatResponseTime.textContent = data.avgResponseTime || '-';
  }

  if (convStatStatus) {
    // Status basierend auf letzter E-Mail
    const lastEmail = data.emails?.[0];
    if (lastEmail) {
      if (!lastEmail.isSent) {
        convStatStatus.textContent = '⏳ Antwort ausstehend';
        convStatStatus.className = 'conv-stat-value warning';
      } else {
        convStatStatus.textContent = '✓ Beantwortet';
        convStatStatus.className = 'conv-stat-value highlight';
      }
    } else {
      convStatStatus.textContent = '-';
      convStatStatus.className = 'conv-stat-value';
    }
  }

  // Themen - Mockup Style mit Status-Dots
  if (topicsList) {
    if (data.topics && data.topics.length > 0) {
      topicsList.innerHTML = data.topics.map((t, i) => {
        // Bestimme Status basierend auf Häufigkeit und Position
        // Neuere/häufigere Themen = pending, ältere = resolved
        const isResolved = i >= Math.ceil(data.topics.length / 2);
        const statusClass = isResolved ? 'resolved' : 'pending';
        const statusText = isResolved ? 'Geklärt' : 'Offen';

        return `
          <div class="topic-item">
            <div class="topic-dot ${statusClass}"></div>
            <span class="topic-text">${escapeHtml(t.topic)}</span>
            <span class="topic-status ${statusClass}">${statusText}</span>
          </div>
        `;
      }).join('');
    } else {
      topicsList.innerHTML = '<div class="topic-item"><span class="topic-text" style="color: var(--text-muted);">Keine Themen erkannt</span></div>';
    }
  }

  // Timeline Count
  if (timelineCount) {
    timelineCount.textContent = data.totalEmails || 0;
  }

  // Timeline - Mit Date-Separators und expandierbaren E-Mails (Mockup Style)
  if (convTimelineList && data.emails && data.emails.length > 0) {
    renderConversationTimeline(convTimelineList, data.emails, false);

    // View-Toggle Event-Handler
    const viewCompact = document.getElementById('viewCompact');
    const viewDetails = document.getElementById('viewDetails');

    if (viewCompact && viewDetails) {
      viewCompact.onclick = () => {
        viewCompact.classList.add('active');
        viewDetails.classList.remove('active');
        renderConversationTimeline(convTimelineList, data.emails, false);
      };
      viewDetails.onclick = () => {
        viewDetails.classList.add('active');
        viewCompact.classList.remove('active');
        renderConversationTimeline(convTimelineList, data.emails, true);
      };
    }
  } else if (convTimelineList) {
    convTimelineList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Keine E-Mails in dieser Konversation</div>';
  }

  // Karte anzeigen
  conversationCard.classList.remove('hidden');
}

/**
 * Rendert die Konversations-Timeline mit expandierbaren E-Mails
 */
function renderConversationTimeline(container, emailList, showAllDetails) {
  const groups = groupEmailsByDate(emailList);
  let html = '';

  groups.forEach(group => {
    // Date Separator
    html += `
      <div class="conv-date-separator">
        <div class="conv-date-line"></div>
        <span class="conv-date-text">${group.label}</span>
        <div class="conv-date-line"></div>
      </div>
    `;

    // Alle E-Mails in dieser Gruppe
    group.emails.forEach((email, idx) => {
      const isSent = email.isSent;
      const isCurrent = currentEmail && email.id === currentEmail.id;
      const date = formatDateShort(new Date(email.date));
      const preview = (email.snippet || email.body || '').substring(0, 60).replace(/\n/g, ' ');
      const bodyText = (email.body || email.snippet || '').substring(0, 500);
      const isExpanded = showAllDetails || (idx === 0 && isCurrent);

      html += `
        <div class="conv-timeline-item${isCurrent ? ' current' : ''}${isExpanded ? ' expanded' : ''}" data-email-id="${email.id}">
          <div class="conv-timeline-item-header">
            <div class="conv-timeline-direction ${isSent ? 'sent' : 'received'}">
              ${isSent ? '📤' : '📥'}
            </div>
            <div class="conv-timeline-content">
              <div class="conv-timeline-subject">${escapeHtml(email.subject || 'Kein Betreff')}</div>
              <div class="conv-timeline-preview">${escapeHtml(preview)}...</div>
            </div>
            <div class="conv-timeline-date">${date}</div>
            <div class="conv-timeline-expand">▼</div>
          </div>
          <div class="conv-timeline-body">
            <div class="conv-timeline-body-text">${escapeHtml(bodyText)}${bodyText.length >= 500 ? '...' : ''}</div>
          </div>
        </div>
      `;
    });
  });

  container.innerHTML = html;

  // Klick-Handler für Timeline-Item-Headers (expand/collapse)
  container.querySelectorAll('.conv-timeline-item-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const item = header.closest('.conv-timeline-item');
      item.classList.toggle('expanded');
    });
  });

  // Doppelklick öffnet die E-Mail
  container.querySelectorAll('.conv-timeline-item').forEach(item => {
    item.addEventListener('dblclick', () => {
      const emailId = item.dataset.emailId;
      const email = emails.find(e => e.id === emailId);
      if (email) {
        selectEmail(email);
      }
    });
  });
}

/**
 * Versteckt die Konversations-Übersicht
 */
function hideConversationCard() {
  const conversationCard = document.getElementById('conversationCard');
  if (conversationCard) {
    conversationCard.classList.add('hidden');
  }
  currentConversationData = null;
}

/**
 * Zeigt alle E-Mails der Konversation an (filtert die Liste)
 */
function showAllConversationEmails() {
  if (!currentConversationData || !currentConversationData.emails) return;

  // TODO: Implementiere Filter-Modus für Konversation
  const emailIds = currentConversationData.emails.map(e => e.id);
  console.log('[CONVERSATION] Show all emails:', emailIds);

  // Für jetzt: Toast-Nachricht
  if (typeof showToast === 'function') {
    showToast(`${currentConversationData.totalEmails} E-Mails in dieser Konversation`);
  }
}

/**
 * Archiviert alle E-Mails der Konversation
 */
function archiveConversation() {
  if (!currentConversationData || !currentConversationData.emails) return;

  const count = currentConversationData.totalEmails || currentConversationData.emails.length;
  console.log('[CONVERSATION] Archive conversation:', currentConversationData.emails.map(e => e.id));

  // TODO: Implementiere Archivierung
  if (typeof showToast === 'function') {
    showToast(`📁 ${count} E-Mails archiviert`);
  }

  // Karte schließen
  hideConversationCard();
}

/**
 * Generiert eine kontextbezogene Antwort basierend auf der Konversation
 */
async function generateContextualReply() {
  if (!currentEmail || !currentConversationData) return;

  // Öffne Reply-Panel
  openReplyPanel();

  // Generiere Antwort mit Konversationskontext
  try {
    const result = await ipcRenderer.invoke('reply:generate', {
      email: {
        from: currentEmail.from,
        subject: currentEmail.subject,
        body: currentEmail.body || currentEmail.snippet
      },
      conversationContext: currentConversationData.emails.slice(0, 3).map(e => ({
        subject: e.subject,
        snippet: e.snippet || e.body?.substring(0, 100),
        isSent: e.isSent
      })),
      style: currentReplyType
    });

    if (result && result.success && result.reply) {
      elements.replyText.value = result.reply;
    }
  } catch (error) {
    console.error('[CONVERSATION] Contextual reply failed:', error);
  }
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

        // Zeige Inhalt mit Bildverarbeitung
        displayEmailContent(email);

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
    // Bereits geladene E-Mail - zeige mit Bildverarbeitung
    displayEmailContent(email);
  }

  // Update action buttons
  elements.starBtn.innerHTML = email.isStarred ? '⭐ Markiert' : '☆ Markieren';

  // Show attachments if any
  if (email.attachments && email.attachments.length > 0) {
    elements.attachmentsSection.classList.remove('hidden');
    elements.attachmentsList.innerHTML = email.attachments.map(att => `
      <div class="attachment-item" onclick="downloadAttachment('${email.id}', '${att.id}', '${escapeHtml(att.filename)}')">
        <span class="attachment-icon">${getAttachmentIcon(att.mimeType)}</span>
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

  // KI-Karten verstecken (werden ggf. neu angezeigt)
  hideContactCard();
  hidePaymentCard();
  hideConversationCard();

  // Kontakt-Extraktion (asynchron im Hintergrund)
  extractContactFromEmail(email).then(contact => {
    if (contact && currentEmail?.id === email.id) {
      showContactCard(contact);
    }
  }).catch(err => {
    console.warn('[CONTACT] Extraction failed:', err);
  });

  // Zahlungsdaten-Extraktion (asynchron im Hintergrund)
  extractPaymentData(email).then(payment => {
    if (payment && currentEmail?.id === email.id) {
      showPaymentCard(payment);
    }
  }).catch(err => {
    console.warn('[PAYMENT] Extraction failed:', err);
  });

  // Konversations-Übersicht (asynchron im Hintergrund)
  analyzeConversation(email).then(conversationData => {
    if (conversationData && currentEmail?.id === email.id) {
      showConversationCard(conversationData);
    }
  }).catch(err => {
    console.warn('[CONVERSATION] Analysis failed:', err);
  });

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
  // Inbox: ALLE E-Mails außer Spam
  const inboxCount = emails.filter(e => e.kategorie !== 'spam').length;
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

  // Spam/Papierkorb
  const spamCount = emails.filter(e => e.kategorie === 'spam' || e.isPapierkorb).length;
  document.getElementById('catPapierkorb').textContent = `${spamCount} E-Mails`;
  elements.papierkorbCount.textContent = spamCount;

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
    termine: 'Termine',
    rechnung: 'Rechnungen',
    info: 'Info',
    werbung: 'Werbung',
    newsletter: 'Newsletter',
    sent: 'Gesendet',
    spam: 'Spam'
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
    info: 0,
    newsletter: 0,
    werbung: 0,
    spam: 0,
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

      const kategorie = email.kategorie || 'info';
      if (data[dayIndex][kategorie] !== undefined) {
        data[dayIndex][kategorie]++;
      } else {
        data[dayIndex].info++;
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
    d.essenz + d.wichtig + d.termine + d.rechnung + d.info + d.newsletter + d.werbung + d.spam + d.veraltet
  ));

  elements.chartBars.innerHTML = data.map((d, i) => {
    const total = d.essenz + d.wichtig + d.termine + d.rechnung + d.info + d.newsletter + d.werbung + d.spam + d.veraltet;
    const scale = 100 / maxTotal;

    return `
      <div class="chart-row">
        <span class="chart-label">${days[i]}</span>
        <div class="chart-bar-container">
          <div class="chart-bar essenz" style="width: ${d.essenz * scale}%" title="Essenz: ${d.essenz}"></div>
          <div class="chart-bar wichtig" style="width: ${d.wichtig * scale}%" title="Wichtig: ${d.wichtig}"></div>
          <div class="chart-bar termine" style="width: ${d.termine * scale}%" title="Termine: ${d.termine}"></div>
          <div class="chart-bar rechnung" style="width: ${d.rechnung * scale}%" title="Rechnung: ${d.rechnung}"></div>
          <div class="chart-bar info" style="width: ${d.info * scale}%" title="Info: ${d.info}"></div>
          <div class="chart-bar newsletter" style="width: ${d.newsletter * scale}%" title="Newsletter: ${d.newsletter}"></div>
          <div class="chart-bar werbung" style="width: ${d.werbung * scale}%" title="Werbung: ${d.werbung}"></div>
          <div class="chart-bar spam" style="width: ${d.spam * scale}%" title="Spam: ${d.spam}"></div>
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
        email.kategorie = normalizeKategorie(classification.kategorie);
        email.confidence = classification.confidence;
        email.tags = classification.tags || [];
        email.zusammenfassung = classification.zusammenfassung;
        email.aktion = classification.aktion;
        email.isImportant = email.kategorie === 'essenz' || email.kategorie === 'wichtig';
        email.needsAction = classification.tags?.includes('ANTWORT_NÖTIG') || classification.aktion === 'antworten';
        email.isPapierkorb = email.kategorie === 'spam';
        email.isNewsletter = email.kategorie === 'newsletter';
        email.canAutoReply = classification.autoAntwortMöglich;

        // Debug-Log Eintrag hinzufügen
        addDebugEntry(emailForClassification, classification);

        // SOFORT Animation für diese E-Mail
        await emailAnalysisAnimation.animateEmailToCategory(email, email.kategorie, i);

        // Update Counts nach jeder E-Mail
        updateCategoryCounts();

        const cacheInfo = classification.cached ? ' [Cache]' : ' [Neu]';
        console.log(`[ANALYZE] ${i + 1}/${totalEmails}: ${email.subject?.substring(0, 30)}... → ${email.kategorie} (Stufe ${classification.stufe})${cacheInfo}`);
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

    // Zeige Classifier-Statistiken wenn verfügbar
    if (classifierStats?.stats) {
      const s = classifierStats.stats;
      console.log('[CLASSIFIER] Gesamt klassifiziert:', s.total || 0);
      console.log('[CLASSIFIER] Stufe 0 (Improved):', s.stufe0Improved || 0);
      console.log('[CLASSIFIER] Stufe 0 (Domain):', s.stufe0 || 0);
      console.log('[CLASSIFIER] Stufe 1 (Header GPT):', s.stufe1 || 0);
      console.log('[CLASSIFIER] Stufe 2 (Inhalt GPT):', s.stufe2 || 0);
      console.log('[CLASSIFIER] Kosten:', s.kostenGesamt || '0.00 Cent');
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
    emails = emails.filter(e => !e.isPapierkorb && e.kategorie !== 'spam');
    updateCategoryCounts();
    renderEmailList();
    showToast('Papierkorb geleert');
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
// Theme Switcher (Dark/Light Mode)
// ============================================

function setupThemeSwitcher() {
  const darkBtn = document.getElementById('themeDarkBtn');
  const lightBtn = document.getElementById('themeLightBtn');
  const themeIcon = document.getElementById('themeIcon');
  const themeDesc = document.getElementById('themeDescription');

  // Gespeichertes Theme laden
  const savedTheme = localStorage.getItem('smartklick-theme') || 'dark';
  applyTheme(savedTheme);

  // Button Event Listener
  darkBtn?.addEventListener('click', () => {
    applyTheme('dark');
    localStorage.setItem('smartklick-theme', 'dark');
  });

  lightBtn?.addEventListener('click', () => {
    applyTheme('light');
    localStorage.setItem('smartklick-theme', 'light');
  });

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      darkBtn?.classList.remove('active');
      lightBtn?.classList.add('active');
      if (themeIcon) themeIcon.textContent = '☀️';
      if (themeDesc) themeDesc.textContent = 'Aktuell: Heller Modus';
    } else {
      document.documentElement.removeAttribute('data-theme');
      darkBtn?.classList.add('active');
      lightBtn?.classList.remove('active');
      if (themeIcon) themeIcon.textContent = '🌙';
      if (themeDesc) themeDesc.textContent = 'Aktuell: Dunkler Modus';
    }
  }
}

// Theme sofort beim Laden anwenden (vor DOMContentLoaded für flackerfreies Laden)
(function() {
  const savedTheme = localStorage.getItem('smartklick-theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

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
      const alteKategorie = currentEmail.kategorie || 'info';

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
      kategorie: currentEmail.kategorie || 'info',
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
    info: 'Info',
    newsletter: 'Newsletter',
    spam: 'Spam',
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
  kategorie.textContent = formatKategorieIcon(currentEmail.kategorie || 'info');
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
    info: 'ℹ️ Info',
    newsletter: '📰 Newsletter',
    spam: '🗑️ Spam',
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

function getAttachmentIcon(mimeType) {
  if (!mimeType) return '📎';
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
  if (mimeType.includes('video')) return '🎬';
  if (mimeType.includes('audio')) return '🎵';
  return '📎';
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
window.downloadAttachment = async (messageId, attachmentId, filename) => {
  try {
    showToast('Lade Anhang herunter...', 'info');
    const result = await ipcRenderer.invoke('email:downloadAttachment', messageId, attachmentId, filename);
    if (result.success) {
      showToast('Anhang gespeichert: ' + result.path);
    } else if (result.error !== 'Abgebrochen') {
      showToast('Fehler: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Fehler beim Download', 'error');
  }
};
