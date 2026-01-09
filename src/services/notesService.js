// Notes Service for Smartklick Desktop - JTBT System
// Fetches notes from server API with user separation
const https = require('https');
const http = require('http');

const NOTES_API_URL = 'https://voice.smartklick.de/notes';

class NotesService {
  constructor() {
    this.cache = null;
    this.cacheTime = null;
    this.cacheDuration = 5000; // 5 seconds cache (shorter for better sync)
    this.userId = null; // User ID for note separation
  }

  // Invalidate cache (call after any change)
  invalidateCache() {
    this.cache = null;
    this.cacheTime = null;
    console.log('[NotesService] Cache invalidated');
  }

  // Set user ID (called from main.js on app start)
  setUserId(userId) {
    this.userId = userId;
    console.log('[NotesService] User ID set:', userId);
  }

  // Get user ID
  getUserId() {
    return this.userId;
  }

  // Build URL with user_id parameter
  buildUrl(endpoint = '') {
    // Handle endpoints that already have query params
    let fullUrl = NOTES_API_URL + endpoint;
    if (this.userId) {
      const separator = endpoint.includes('?') ? '&' : '?';
      fullUrl += `${separator}user_id=${this.userId}`;
    }
    return new URL(fullUrl);
  }

  // Fetch from server
  async fetchFromServer(endpoint = '', method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const url = this.buildUrl(endpoint);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      const protocol = url.protocol === 'https:' ? https : http;
      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // Add user_id to body for POST requests
      if (body && this.userId) {
        body.user_id = this.userId;
      }
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // Get all notes from server
  async getAllNotes() {
    try {
      // Check cache
      if (this.cache && this.cacheTime && Date.now() - this.cacheTime < this.cacheDuration) {
        return this.cache;
      }

      const result = await this.fetchFromServer('?filter=all');
      if (result.success) {
        this.cache = result.notes;
        this.cacheTime = Date.now();
        return result.notes;
      }
      return [];
    } catch (error) {
      console.error('Error fetching notes from server:', error);
      return this.cache || [];
    }
  }

  // Get notes by category
  async getNotesByCategory(category) {
    try {
      const result = await this.fetchFromServer(`?filter=${category}`);
      return result.success ? result.notes : [];
    } catch (error) {
      console.error('Error fetching notes by category:', error);
      return [];
    }
  }

  // Search notes
  async searchNotes(query) {
    try {
      const result = await this.fetchFromServer(`?search=${encodeURIComponent(query)}`);
      return result.success ? result.notes : [];
    } catch (error) {
      console.error('Error searching notes:', error);
      return [];
    }
  }

  // Get today's notes
  async getTodayNotes() {
    try {
      const result = await this.fetchFromServer('?filter=today');
      return result.success ? result.notes : [];
    } catch (error) {
      console.error('Error fetching today notes:', error);
      return [];
    }
  }

  // Save a new note
  async saveNote(content, color = 'default') {
    try {
      const result = await this.fetchFromServer('', 'POST', { content, color });
      if (result.success) {
        // Invalidate cache
        this.cache = null;
        this.cacheTime = null;
        console.log(`Note saved: ${result.note.title} (${result.note.category})`);
      }
      return result;
    } catch (error) {
      console.error('Error saving note:', error);
      return { success: false, error: error.message };
    }
  }

  // Delete a note (soft delete - move to trash)
  async deleteNote(noteId) {
    try {
      const result = await this.fetchFromServer(`/${noteId}`, 'DELETE');
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error deleting note:', error);
      return { success: false, error: error.message };
    }
  }

  // Permanently delete a note
  async deleteNotePermanent(noteId) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/permanent`, 'DELETE');
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error permanently deleting note:', error);
      return { success: false, error: error.message };
    }
  }

  // Toggle pin status
  async togglePin(noteId) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/pin`, 'POST');
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error toggling pin:', error);
      return { success: false, error: error.message };
    }
  }

  // Archive a note
  async archiveNote(noteId) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/archive`, 'POST');
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error archiving note:', error);
      return { success: false, error: error.message };
    }
  }

  // Restore a note from archive/trash
  async restoreNote(noteId) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/restore`, 'POST');
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error restoring note:', error);
      return { success: false, error: error.message };
    }
  }

  // Set note color
  async setNoteColor(noteId, color) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/color`, 'POST', { color });
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error setting note color:', error);
      return { success: false, error: error.message };
    }
  }

  // Set note category
  async setNoteCategory(noteId, category) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/category`, 'POST', { category });
      if (result.success) {
        this.cache = null;
        this.cacheTime = null;
      }
      return result;
    } catch (error) {
      console.error('Error setting note category:', error);
      return { success: false, error: error.message };
    }
  }

  // Get note content
  async getNoteContent(noteId) {
    try {
      const result = await this.fetchFromServer(`/${noteId}/content`);
      return result.success ? result.note : null;
    } catch (error) {
      console.error('Error fetching note content:', error);
      return null;
    }
  }

  // Get stats
  async getStats() {
    try {
      const notes = await this.getAllNotes();
      const today = new Date().toISOString().split('T')[0];

      return {
        total: notes.length,
        links: notes.filter(n => n.category === 'links').length,
        code: notes.filter(n => n.category === 'code').length,
        ideas: notes.filter(n => n.category === 'ideas').length,
        general: notes.filter(n => n.category === 'general').length,
        today: notes.filter(n => n.date && n.date.startsWith(today)).length
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return { total: 0, links: 0, code: 0, ideas: 0, general: 0, today: 0 };
    }
  }

  // Get notes for UI (with formatting)
  async getNotesForUI(filter = 'all', searchQuery = null) {
    try {
      let notes;

      if (searchQuery) {
        notes = await this.searchNotes(searchQuery);
      } else if (filter === 'today') {
        notes = await this.getTodayNotes();
      } else if (filter === 'all') {
        notes = await this.getAllNotes();
      } else {
        notes = await this.getNotesByCategory(filter);
      }

      // Format for UI
      return notes.map(note => ({
        ...note,
        icon: this.getCategoryIcon(note.category),
        relativeTime: this.formatRelativeTime(note.date)
      }));
    } catch (error) {
      console.error('Error getting notes for UI:', error);
      return [];
    }
  }

  // Helper: Category icons
  getCategoryIcon(category) {
    const icons = {
      'links': '🔗',
      'code': '💻',
      'ideas': '💡',
      'general': '📝'
    };
    return icons[category] || '📝';
  }

  // Helper: Format relative time
  formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'gerade eben';
    if (diffMins < 60) return `vor ${diffMins} Min`;
    if (diffHours < 24) return `vor ${diffHours} Std`;
    if (diffDays === 1) return 'gestern';
    if (diffDays < 7) return `vor ${diffDays} Tagen`;

    return date.toLocaleDateString('de-DE');
  }

  // Placeholder for folder (not applicable for server mode)
  getNotesDir() {
    return 'Server: voice.smartklick.de/notes';
  }
}

module.exports = new NotesService();
