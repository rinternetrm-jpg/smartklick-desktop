/**
 * Intelligentes E-Mail-Klassifizierungssystem v3
 *
 * 3-Stufen-System für maximale Kosteneffizienz:
 *
 * STUFE 0: Domain-Check (KEIN GPT, sofort)
 *   - Bekannte Spam-Domains → sofort weg
 *   - Eigene E-Mails (Tests) → sofort weg
 *   - Newsletter-Domains → sofort sortiert
 *
 * STUFE 1: GPT nur Absender + Betreff (~0.0001€)
 *   - Bei Sicherheit >= 80% → fertig
 *
 * STUFE 2: GPT mit Inhalt (300 Zeichen, ~0.001€)
 *   - Nur bei Unsicherheit
 */

const Stufe0Classifier = require('./stufe0');
const Stufe1Classifier = require('./stufe2'); // Stufe 1 = alte stufe2.js
const Stufe2Classifier = require('./stufe3'); // Stufe 2 = alte stufe3.js

// Kategorie-Definitionen
const KATEGORIEN = {
  ESSENZ: {
    id: 'essenz',
    name: 'Essenz',
    icon: '🔴',
    color: '#ef4444',
    sichtbar: true,
    beschreibung: 'Echter Mensch will etwas von dir'
  },
  WICHTIG: {
    id: 'wichtig',
    name: 'Wichtig',
    icon: '🟠',
    color: '#f97316',
    sichtbar: true,
    beschreibung: 'Sollte angeschaut werden'
  },
  INFO: {
    id: 'info',
    name: 'Info',
    icon: 'ℹ️',
    color: '#6b7280',
    sichtbar: true,
    beschreibung: 'Automatische Benachrichtigungen'
  },
  WERBUNG: {
    id: 'werbung',
    name: 'Werbung',
    icon: '📢',
    color: '#f59e0b',
    sichtbar: false,
    beschreibung: 'Social Media, Shops, Marketing'
  },
  NEWSLETTER: {
    id: 'newsletter',
    name: 'Newsletter',
    icon: '📰',
    color: '#8b5cf6',
    sichtbar: false,
    beschreibung: 'Abonnierte Updates'
  },
  SPAM: {
    id: 'spam',
    name: 'Spam',
    icon: '🗑️',
    color: '#dc2626',
    sichtbar: false,
    beschreibung: 'Werbung, unerwünscht'
  }
};

// Aktions-Tags basierend auf den 4 Fragen
const TAGS = {
  MENSCH: { id: 'MENSCH', name: 'Mensch', icon: '👤', color: '#3b82f6' },
  AKTION: { id: 'AKTION', name: 'Aktion erwartet', icon: '↩️', color: '#ef4444' },
  GELD: { id: 'GELD', name: 'Geld', icon: '💰', color: '#f59e0b' },
  DRINGEND: { id: 'DRINGEND', name: 'Dringend', icon: '⏰', color: '#ef4444' }
};

class IntelligentEmailClassifier {
  constructor(options = {}) {
    this.stufe0 = new Stufe0Classifier();
    this.stufe1 = new Stufe1Classifier();
    this.stufe2 = new Stufe2Classifier();

    this.options = {
      enableGPT: true,
      ...options
    };

    this.stats = {
      stufe0: 0,
      stufe1: 0,
      stufe2: 0,
      total: 0,
      gptKosten: 0
    };
  }

  // Konfiguration
  setOpenAIKey(apiKey) {
    this.stufe1.setApiKey(apiKey);
    this.stufe2.setApiKey(apiKey);
  }

  // Haupt-Klassifizierungsfunktion für einzelne E-Mail
  async klassifiziere(email) {
    this.stats.total++;

    // ========== STUFE 0: Domain-Check (KEIN GPT!) ==========
    const stufe0 = this.stufe0.klassifiziere(email);
    if (stufe0) {
      this.stats.stufe0++;
      return this.finalize(email, stufe0);
    }

    if (!this.options.enableGPT) {
      return this.finalize(email, {
        kategorie: 'info',
        confidence: 50,
        gedanken: 'GPT deaktiviert, keine Klassifizierung möglich.',
        stufe: 0,
        error: 'GPT deaktiviert'
      });
    }

    // ========== STUFE 1: Betreff + Absender an GPT ==========
    const stufe1 = await this.stufe1.klassifiziere(email);
    this.stats.stufe1++;
    this.stats.gptKosten += 0.0001;

    // Wenn sicher genug, fertig
    if (!stufe1.needsMoreText) {
      return this.finalize(email, stufe1);
    }

    // ========== STUFE 2: Mit Inhalt an GPT (nur bei Unsicherheit) ==========
    const stufe2 = await this.stufe2.klassifiziere(email, stufe1);
    this.stats.stufe2++;
    this.stats.gptKosten += 0.001;

    return this.finalize(email, stufe2);
  }

  // Batch-Klassifizierung für mehrere E-Mails
  async klassifiziereBatch(emails) {
    const results = [];

    // Bei Batch: Sequentiell mit Stufe 0 vorfiltern
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];

      // Stufe 0: Domain-Check (KEIN GPT)
      const stufe0 = this.stufe0.klassifiziere(email);
      if (stufe0) {
        this.stats.stufe0++;
        results.push(this.finalize(email, stufe0));
        continue;
      }

      if (!this.options.enableGPT) {
        results.push(this.finalize(email, {
          kategorie: 'info',
          confidence: 50,
          gedanken: 'GPT deaktiviert',
          stufe: 0
        }));
        continue;
      }

      // Stufe 1: Nur Header
      const stufe1 = await this.stufe1.klassifiziere(email);
      this.stats.stufe1++;
      this.stats.gptKosten += 0.0001;

      if (!stufe1.needsMoreText) {
        results.push(this.finalize(email, stufe1));
        continue;
      }

      // Stufe 2: Mit Inhalt
      const stufe2 = await this.stufe2.klassifiziere(email, stufe1);
      this.stats.stufe2++;
      this.stats.gptKosten += 0.001;

      results.push(this.finalize(email, stufe2));
    }

    return results;
  }

  // Finalisiere Klassifizierung
  finalize(email, result) {
    // Tags basierend auf den 4 Fragen
    const tags = [];
    if (result.mensch?.toLowerCase() === 'ja') tags.push('MENSCH');
    if (result.aktion?.toLowerCase() === 'ja') tags.push('AKTION');
    if (result.geld?.toLowerCase() === 'ja') tags.push('GELD');
    if (result.dringend?.toLowerCase() === 'ja') tags.push('DRINGEND');

    // Kategorie-Info hinzufügen
    const kategorieInfo = KATEGORIEN[result.kategorie?.toUpperCase()] || KATEGORIEN.INFO;

    return {
      id: email.id || email.messageId,
      kategorie: result.kategorie || 'info',
      kategorieInfo,
      confidence: result.confidence || 70,
      gedanken: result.gedanken || result.grund || '',
      schnell: result.schnell || false, // Stufe 0 ohne GPT
      tags,
      tagsInfo: tags.map(t => TAGS[t] || { id: t, name: t }),
      stufe: result.stufe,
      gptKosten: this.berechneKosten(result.stufe)
    };
  }

  berechneKosten(stufe) {
    switch (stufe) {
      case 0: return 0;       // Domain-Check
      case 1: return 0.0001;  // Nur Header
      case 2: return 0.001;   // Mit Inhalt
      default: return 0;
    }
  }

  // === STATS ===

  getStats() {
    return {
      ...this.stats,
      kostenGesamt: `${(this.stats.gptKosten * 100).toFixed(2)} Cent`
    };
  }

  getEssenz(emails, klassifizierungen) {
    return klassifizierungen
      .map((k, i) => ({ ...k, email: emails[i] }))
      .filter(k => k.kategorie === 'essenz' || k.kategorie === 'wichtig')
      .sort((a, b) => {
        if (a.kategorie !== b.kategorie) {
          return a.kategorie === 'essenz' ? -1 : 1;
        }
        return b.confidence - a.confidence;
      });
  }

  // Dummy methods für Kompatibilität (werden nicht mehr verwendet)
  setMyEmails() {}
  addToVIP() {}
  addToFamily() {}
  addToCustomers() {}
  addToWhitelist() {}
  addToBlacklist() {}
  korrigiereKategorie() {}
  emailGeöffnet() {}
  emailBeantwortet() {}
  emailGelöschtOhneLesen() {}
  exportLearningData() { return {}; }
  importLearningData() {}
  resetLearning() {}
}

// Exportiere alles
module.exports = {
  IntelligentEmailClassifier,
  KATEGORIEN,
  TAGS,
  Stufe0Classifier,
  Stufe1Classifier,
  Stufe2Classifier
};
