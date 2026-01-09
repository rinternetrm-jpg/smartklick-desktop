/**
 * Intelligentes E-Mail-Klassifizierungssystem v2
 *
 * KEINE starren Regeln, KEINE Whitelist/Blacklist
 * GPT entscheidet basierend auf 4 Fragen:
 * 1. Ist das ein echter Mensch oder automatisch?
 * 2. Erwartet jemand eine Antwort/Aktion?
 * 3. Geht es um Geld?
 * 4. Ist es zeitkritisch?
 *
 * Flow:
 * Alle E-Mails → Stufe 2 (Betreff+Absender an GPT, ~0.0001€)
 *             → Bei Unsicherheit: Stufe 3 (Volltext an GPT, ~0.001€)
 */

const Stufe2Classifier = require('./stufe2');
const Stufe3Classifier = require('./stufe3');

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
  NEWSLETTER: {
    id: 'newsletter',
    name: 'Newsletter',
    icon: '📰',
    color: '#8b5cf6',
    sichtbar: false,
    beschreibung: 'Newsletter/Marketing'
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
    this.stufe2 = new Stufe2Classifier();
    this.stufe3 = new Stufe3Classifier();

    this.options = {
      enableGPT: true,
      ...options
    };

    this.stats = {
      stufe2: 0,
      stufe3: 0,
      total: 0,
      gptKosten: 0
    };
  }

  // Konfiguration
  setOpenAIKey(apiKey) {
    this.stufe2.setApiKey(apiKey);
    this.stufe3.setApiKey(apiKey);
  }

  // Haupt-Klassifizierungsfunktion für einzelne E-Mail
  async klassifiziere(email) {
    this.stats.total++;

    if (!this.options.enableGPT) {
      return this.finalize(email, {
        kategorie: 'info',
        confidence: 50,
        stufe: 0,
        error: 'GPT deaktiviert'
      });
    }

    // ========== STUFE 2: Betreff + Absender an GPT ==========
    const stufe2 = await this.stufe2.klassifiziere(email);
    this.stats.stufe2++;
    this.stats.gptKosten += 0.0001;

    // Wenn sicher genug, fertig
    if (!stufe2.needsMoreText) {
      return this.finalize(email, stufe2);
    }

    // ========== STUFE 3: Volltext an GPT (nur bei Unsicherheit) ==========
    const stufe3 = await this.stufe3.klassifiziere(email, stufe2);
    this.stats.stufe3++;
    this.stats.gptKosten += 0.001;

    return this.finalize(email, stufe3);
  }

  // Batch-Klassifizierung für mehrere E-Mails
  async klassifiziereBatch(emails) {
    if (!this.options.enableGPT) {
      return emails.map(email => this.finalize(email, {
        kategorie: 'info',
        confidence: 50,
        stufe: 0,
        error: 'GPT deaktiviert'
      }));
    }

    const results = [];
    const needsMoreText = [];
    const needsMoreTextIndices = [];

    // Stufe 2 für alle (Batch)
    const stufe2Results = await this.stufe2.batchKlassifiziere(emails);
    this.stats.gptKosten += 0.0001 * emails.length;

    for (let i = 0; i < emails.length; i++) {
      const stufe2 = stufe2Results[i];
      this.stats.stufe2++;

      if (!stufe2.needsMoreText) {
        results[i] = this.finalize(emails[i], stufe2);
      } else {
        needsMoreText.push(emails[i]);
        needsMoreTextIndices.push(i);
        results[i] = null; // Placeholder
      }
    }

    // Stufe 3 für unsichere (einzeln, da Volltext)
    for (let j = 0; j < needsMoreText.length; j++) {
      const originalIndex = needsMoreTextIndices[j];
      const email = needsMoreText[j];
      const stufe2 = stufe2Results[originalIndex];

      const stufe3 = await this.stufe3.klassifiziere(email, stufe2);
      this.stats.stufe3++;
      this.stats.gptKosten += 0.001;

      results[originalIndex] = this.finalize(email, stufe3);
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
      tags,
      tagsInfo: tags.map(t => TAGS[t] || { id: t, name: t }),
      mensch: result.mensch,
      aktion: result.aktion,
      geld: result.geld,
      dringend: result.dringend,
      zusammenfassung: result.zusammenfassung,
      grund: result.grund,
      jaCount: result.jaCount || 0,
      stufe: result.stufe,
      gptKosten: this.berechneKosten(result.stufe)
    };
  }

  berechneKosten(stufe) {
    switch (stufe) {
      case 2: return 0.0001;
      case 3: return 0.001;
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
  Stufe2Classifier,
  Stufe3Classifier
};
