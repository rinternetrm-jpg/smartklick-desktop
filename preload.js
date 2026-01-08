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
    save: (content) => ipcRenderer.invoke('notes-save', content),
    invalidateCache: () => ipcRenderer.invoke('notes-invalidate-cache')
  },

  // Screenshot to Notes
  captureScreenshotNote: () => ipcRenderer.invoke('capture-screenshot-note'),

  // Analyze Page to Notes (AI text summary)
  analyzePageNote: () => ipcRenderer.invoke('analyze-page-note')
});

// Expose platform info
contextBridge.exposeInMainWorld('platform', {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux'
});
