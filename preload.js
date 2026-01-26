const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  getViewMode: () => ipcRenderer.invoke('get-view-mode'),

  // Window control
  changeViewMode: (mode) => ipcRenderer.send('change-view-mode', mode),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  showPanel: (panelType) => ipcRenderer.send('show-panel', panelType),
  hidePanel: () => ipcRenderer.send('hide-panel'),

  // Click-through for transparent areas
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),

  // Event listeners
  onViewModeChanged: (callback) => {
    ipcRenderer.on('view-mode-changed', (_, mode) => callback(mode));
  },
  onHotkeyPressed: (callback) => {
    ipcRenderer.on('hotkey-pressed', () => callback());
  },

  // Clipboard
  copyToClipboard: (text) => {
    navigator.clipboard.writeText(text);
  },

  // Paste text into active application (via main process)
  pasteText: (text) => ipcRenderer.invoke('paste-text', text),

  // Wake Word Service
  wakeWord: {
    start: () => ipcRenderer.send('wake-word-start'),
    stop: () => ipcRenderer.send('wake-word-stop'),
    getStatus: () => ipcRenderer.invoke('wake-word-status'),
    setThreshold: (threshold) => ipcRenderer.send('wake-word-set-threshold', threshold),
    send: (message) => ipcRenderer.send('wake-word-send', message),

    // Event listeners
    onStatus: (callback) => ipcRenderer.on('wake-word-status', (_, data) => callback(data)),
    onInitialized: (callback) => ipcRenderer.on('wake-word-initialized', (_, data) => callback(data)),
    onState: (callback) => ipcRenderer.on('wake-word-state', (_, data) => callback(data)),
    onDetected: (callback) => ipcRenderer.on('wake-word-detected', (_, data) => callback(data)),
    onTranscription: (callback) => ipcRenderer.on('wake-word-transcription', (_, data) => callback(data)),
    onCommand: (callback) => ipcRenderer.on('wake-word-command', (_, data) => callback(data)),
    onSmartklickResponse: (callback) => ipcRenderer.on('wake-word-smartklick-response', (_, data) => callback(data)),
    onExitReminder: (callback) => ipcRenderer.on('wake-word-exit-reminder', (_, data) => callback(data)),
    onUnknownCommand: (callback) => ipcRenderer.on('wake-word-unknown-command', (_, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('wake-word-error', (_, data) => callback(data))
  },

  // Screen Reading
  screenReading: {
    // Start screen reading - options: { withScroll: boolean, mode: 'summary' | 'learning' }
    start: (options = {}) => ipcRenderer.invoke('start-screen-reading', options),
    cancel: () => ipcRenderer.send('cancel-screen-reading'),

    // Event listeners
    onStarted: (callback) => ipcRenderer.on('screen-reading-started', (_, data) => callback(data)),
    onAnalyzing: (callback) => ipcRenderer.on('screen-reading-analyzing', (_, data) => callback(data)),
    onComplete: (callback) => ipcRenderer.on('screen-reading-complete', (_, data) => callback(data)),
    onCorrections: (callback) => ipcRenderer.on('screen-reading-corrections', (_, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('screen-reading-error', (_, data) => callback(data)),
    onCancelled: (callback) => ipcRenderer.on('screen-reading-cancelled', (_, data) => callback(data))
  },

  // Cursor Feedback - fügt Status-Text an Cursor-Position in Ziel-App ein
  cursorFeedback: {
    showRecording: () => ipcRenderer.invoke('cursor-feedback:show-recording'),
    showProcessing: () => ipcRenderer.invoke('cursor-feedback:show-processing'),
    insertFinal: (text) => ipcRenderer.invoke('cursor-feedback:insert-final', text),
    cancel: () => ipcRenderer.invoke('cursor-feedback:cancel'),
    getStatus: () => ipcRenderer.invoke('cursor-feedback:get-status')
  },

  // Chrome Extension
  extension: {
    getStatus: () => ipcRenderer.invoke('get-extension-status'),
    analyzePage: () => ipcRenderer.invoke('extension-analyze-page'),
    showErrors: (errors) => ipcRenderer.invoke('extension-show-errors', errors),
    applyCorrection: (errorId, correction) => ipcRenderer.invoke('extension-apply-correction', errorId, correction),
    clearAll: () => ipcRenderer.invoke('extension-clear-all'),

    // Event listeners
    onStatus: (callback) => ipcRenderer.on('extension-status', (_, data) => callback(data)),
    onAnalyzing: (callback) => ipcRenderer.on('extension-analyzing', (_, data) => callback(data)),
    onContent: (callback) => ipcRenderer.on('extension-content', (_, data) => callback(data)),
    onErrorClicked: (callback) => ipcRenderer.on('extension-error-clicked', (_, data) => callback(data)),
    onCorrectionApplied: (callback) => ipcRenderer.on('extension-correction-applied', (_, data) => callback(data))
  },

  // Google Services
  google: {
    // Auth
    getAuthStatus: () => ipcRenderer.invoke('google-auth-status'),
    connect: () => ipcRenderer.invoke('google-auth-connect'),
    disconnect: () => ipcRenderer.invoke('google-auth-disconnect'),
    onAuthChanged: (callback) => ipcRenderer.on('google-auth-changed', (_, data) => callback(data)),

    // Calendar
    getTodayEvents: () => ipcRenderer.invoke('google-calendar-today'),
    getWeekEvents: () => ipcRenderer.invoke('google-calendar-week'),
    getMonthEvents: () => ipcRenderer.invoke('google-calendar-month'),
    getUpcomingEvents: (days) => ipcRenderer.invoke('google-calendar-upcoming', days),
    createEvent: (eventData) => ipcRenderer.invoke('google-calendar-create', eventData),
    quickAddEvent: (text) => ipcRenderer.invoke('google-calendar-quick-add', text),

    // Gmail
    getUnreadEmails: () => ipcRenderer.invoke('google-gmail-unread'),
    getRecentEmails: (maxResults) => ipcRenderer.invoke('google-gmail-recent', maxResults),
    searchEmails: (query) => ipcRenderer.invoke('google-gmail-search', query),
    readEmail: (messageId) => ipcRenderer.invoke('google-gmail-read', messageId),
    sendEmail: (to, subject, body) => ipcRenderer.invoke('google-gmail-send', { to, subject, body }),
    replyToEmail: (messageId, body) => ipcRenderer.invoke('google-gmail-reply', { messageId, body }),
    deleteEmail: (messageId) => ipcRenderer.invoke('google-gmail-delete', messageId)
  },

  // Notes Service (JTBT System)
  notes: {
    getAll: (filter, searchQuery) => ipcRenderer.invoke('notes-get-all', filter, searchQuery),
    getStats: () => ipcRenderer.invoke('notes-get-stats'),
    delete: (noteId) => ipcRenderer.invoke('notes-delete', noteId),
    getContent: (noteId) => ipcRenderer.invoke('notes-get-content', noteId),
    openFolder: () => ipcRenderer.invoke('notes-open-folder'),
    openWebview: () => ipcRenderer.invoke('notes-open-webview'),
    toggleWindow: () => ipcRenderer.invoke('notes-toggle-window'),
    isOpen: () => ipcRenderer.invoke('notes-is-open'),
    closeWindow: () => ipcRenderer.invoke('notes-close-window'),
    onWindowClosed: (callback) => ipcRenderer.on('notes-window-closed', () => callback()),
    save: (content) => ipcRenderer.invoke('notes-save', content),
    invalidateCache: () => ipcRenderer.invoke('notes-invalidate-cache')
  },

  // Screenshot to Notes
  captureScreenshotNote: () => ipcRenderer.invoke('capture-screenshot-note'),

  // Analyze Page to Notes (AI text summary)
  analyzePageNote: () => ipcRenderer.invoke('analyze-page-note'),

  // Email Service
  email: {
    openWindow: () => ipcRenderer.invoke('email:openWindow'),
    getRecent: (count) => ipcRenderer.invoke('email:getRecent', count),
    getUnread: () => ipcRenderer.invoke('email:getUnread'),
    getFromSender: (name) => ipcRenderer.invoke('email:getFromSender', name),
    getThread: (threadId) => ipcRenderer.invoke('email:getThread', threadId),
    markAsRead: (id) => ipcRenderer.invoke('email:markAsRead', id),
    star: (id) => ipcRenderer.invoke('email:star', id),
    unstar: (id) => ipcRenderer.invoke('email:unstar', id),
    archive: (id) => ipcRenderer.invoke('email:archive', id),
    delete: (id) => ipcRenderer.invoke('email:delete', id),
    getForBriefing: (max) => ipcRenderer.invoke('email:getForBriefing', max),
    analyze: (emailData) => ipcRenderer.invoke('email:analyze', emailData),
    briefing: (emails) => ipcRenderer.invoke('email:briefing', emails),
    // Reply functions
    generateReply: (data) => ipcRenderer.invoke('email:generateReply', data),
    getQuickReplies: (data) => ipcRenderer.invoke('email:getQuickReplies', data),
    sendReply: (messageId, body) => ipcRenderer.invoke('email:sendReply', messageId, body),
    // Send command to email window
    sendCommand: (command) => ipcRenderer.send('email-command', command),
    // Multi-Account functions
    getAccounts: () => ipcRenderer.invoke('email:getAccounts'),
    removeAccount: (accountId) => ipcRenderer.invoke('email:removeAccount', accountId),
    setDefaultAccount: (accountId) => ipcRenderer.invoke('email:setDefaultAccount', accountId),
    getUnreadCounts: () => ipcRenderer.invoke('email:getUnreadCounts'),
    getEmailsFromAccount: (accountId, max) => ipcRenderer.invoke('email:getEmailsFromAccount', accountId, max),
    getUnifiedInbox: (max) => ipcRenderer.invoke('email:getUnifiedInbox', max)
  },

  // Calendar
  calendar: {
    openWindow: () => ipcRenderer.invoke('calendar:openWindow'),
    getEvents: (start, end) => ipcRenderer.invoke('calendar:getEvents', start, end),
    getTodayEvents: () => ipcRenderer.invoke('calendar:getTodayEvents'),
    getWeekEvents: () => ipcRenderer.invoke('calendar:getWeekEvents')
  },

  // Outlook
  outlook: {
    startAuth: () => ipcRenderer.invoke('outlook:startAuth'),
    setClientId: (clientId) => ipcRenderer.invoke('outlook:setClientId', clientId),
    getClientId: () => ipcRenderer.invoke('outlook:getClientId')
  },

  // IMAP Multi-Account (for 1&1, GMX, Web.de, T-Online, etc.)
  imap: {
    // Provider presets
    getPresets: () => ipcRenderer.invoke('imap:getPresets'),

    // Multi-Account Management
    getAccounts: () => ipcRenderer.invoke('imap:getAccounts'),
    addAccount: (config) => ipcRenderer.invoke('imap:addAccount', config),
    removeAccount: (accountId) => ipcRenderer.invoke('imap:removeAccount', accountId),
    updateAccount: (accountId, updates) => ipcRenderer.invoke('imap:updateAccount', accountId, updates),
    testConnection: (settings) => ipcRenderer.invoke('imap:testConnection', settings),

    // Email Operations (per account)
    getAccountEmails: (accountId, folder, count) => ipcRenderer.invoke('imap:getAccountEmails', accountId, folder, count),
    getEmailContent: (accountId, uid) => ipcRenderer.invoke('imap:getEmailContent', accountId, uid),
    markAsRead: (accountId, uid) => ipcRenderer.invoke('imap:markAsRead', accountId, uid),
    toggleStar: (accountId, uid) => ipcRenderer.invoke('imap:toggleStar', accountId, uid),
    deleteEmail: (accountId, uid) => ipcRenderer.invoke('imap:deleteEmail', accountId, uid),
    getFolders: (accountId) => ipcRenderer.invoke('imap:getFolders', accountId),
    getStandardFolders: (accountId) => ipcRenderer.invoke('imap:getStandardFolders', accountId),

    // Status & Disconnect
    getStatus: () => ipcRenderer.invoke('imap:getStatus'),
    disconnect: () => ipcRenderer.invoke('imap:disconnect'),

    // Legacy single-account (backwards compatibility)
    configure: (settings) => ipcRenderer.invoke('imap:configure', settings),
    getSettings: () => ipcRenderer.invoke('imap:getSettings'),
    test: (settings) => ipcRenderer.invoke('imap:test', settings),
    getEmails: (count) => ipcRenderer.invoke('imap:getEmails', count),
    getUnread: () => ipcRenderer.invoke('imap:getUnread')
  },

  // Analysis Viewer
  analysis: {
    open: (data) => ipcRenderer.invoke('analysis:open', data)
  },

  // Multi-Monitor
  multiMonitor: {
    setEnabled: (enabled) => ipcRenderer.send('multimonitor:set-enabled', enabled),
    getStatus: () => ipcRenderer.invoke('multimonitor:get-status'),
    dockAll: (position) => ipcRenderer.invoke('multimonitor:dock-all', position),
    undockAll: () => ipcRenderer.invoke('multimonitor:undock-all')
  },

  // Docking System
  docking: {
    getStatus: () => ipcRenderer.invoke('docking:getStatus'),
    dock: (edge) => ipcRenderer.invoke('docking:dock', edge),
    undock: () => ipcRenderer.invoke('docking:undock'),
    setSnapThreshold: (threshold) => ipcRenderer.invoke('docking:setSnapThreshold', threshold),
    openSettings: () => ipcRenderer.invoke('docking:openSettings'),

    // Event listeners
    onApproachingEdge: (callback) => ipcRenderer.on('docking-approaching-edge', (_, data) => callback(data)),
    onLeftEdge: (callback) => ipcRenderer.on('docking-left-edge', () => callback()),
    onDocked: (callback) => ipcRenderer.on('docking-docked', (_, data) => callback(data)),
    onUndocked: (callback) => ipcRenderer.on('docking-undocked', () => callback())
  }
});

// Expose platform info
contextBridge.exposeInMainWorld('platform', {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux'
});
