/**
 * Intelligentes E-Mail-Klassifizierungssystem v4
 *
 * VERBESSERTES System mit Alters-Klassifizierung:
 *
 * STUFE 0: ALTER + DRINGLICHKEIT + DOMAIN (KEIN GPT, sofort)
 *   - E-Mail > 3 Monate → Archiv/Ignorieren
 *   - Dringlichkeits-Keywords (Vollstreckung, Mahnung) → sofort klassifizieren
 *   - Termine (Zoom, Teams) → eigene Kategorie
 *   - Rechnungen → eigene Kategorie
 *   - Bekannte Spam/Newsletter Domains → sofort weg
 *
 * STUFE 1: GPT mit Alter-Info (~0.0001€)
 *   - GPT bekommt E-Mail-Alter mit
 *   - Bei Sicherheit >= 80% → fertig
 *
 * STUFE 2: GPT mit Inhalt + Alter (~0.001€)
 *   - Nur bei Unsicherheit
 *   - Ergebnis wird durch Alters-Limit begrenzt
 */

const Stufe0Classifier = require('./stufe0');
const Stufe1Classifier = require('./stufe2'); // Stufe 1 = alte stufe2.js
const Stufe2Classifier = require('./stufe3'); // Stufe 2 = alte stufe3.js
const { ImprovedClassifier, applyAgeLimit, getAgeInDays } = require('./improvedClassifier');

// Kategorie-Definitionen (erweitert)
const KATEGORIEN = {
  ESSENZ: {
    id: 'essenz',
    name: 'Essenz',
    icon: '🔴',
    color: '#ef4444',
    sichtbar: true,
    beschreibung: 'Sofortige Aktion erforderlich (< 7 Tage alt)'
  },
  WICHTIG: {
    id: 'wichtig',
    name: 'Wichtig',
    icon: '🟠',
    color: '#f97316',
    sichtbar: true,
    beschreibung: 'Sollte heute gelesen werden (< 14 Tage alt)'
  },
  TERMINE: {
    id: 'termine',
    name: 'Termine',
    icon: '📅',
    color: '#0ea5e9',
    sichtbar: true,
    beschreibung: 'Zoom, Teams, Kalendereinladungen'
  },
  RECHNUNG: {
    id: 'rechnung',
    name: 'Rechnung',
    icon: '📄',
    color: '#10b981',
    sichtbar: true,
    beschreibung: 'Alle Rechnungen'
  },
  NORMAL: {
    id: 'normal',
    name: 'Normal',
    icon: '🔵',
    color: '#3b82f6',
    sichtbar: true,
    beschreibung: 'Kann gelesen werden'
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
    beschreibung: 'Abonnierte Updates'
  },
  WERBUNG: {
    id: 'werbung',
    name: 'Werbung',
    icon: '📢',
    color: '#f59e0b',
    sichtbar: false,
    beschreibung: 'Social Media, Shops, Marketing'
  },
  SPAM: {
    id: 'spam',
    name: 'Spam',
    icon: '🗑️',
    color: '#71717a',
    sichtbar: false,
    beschreibung: 'Werbung, unerwünscht'
  },
  VERALTET: {
    id: 'veraltet',
    name: 'Veraltet',
    icon: '⏰',
    color: '#a1a1aa',
    sichtbar: true,
    beschreibung: 'War wichtig, aber älter als 4 Wochen'
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
    this.improvedClassifier = new ImprovedClassifier();
    this.stufe0 = new Stufe0Classifier();
    this.stufe1 = new Stufe1Classifier();
    this.stufe2 = new Stufe2Classifier();

    this.options = {
      enableGPT: true,
      ...options
    };

    this.stats = {
      stufe0: 0,
      stufe0Improved: 0,
      stufe1: 0,
      stufe2: 0,
      total: 0,
      gptKosten: 0,
      byAge: {
        archiv: 0,
        veraltet: 0,
        herabgestuft: 0
      }
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

    // ========== STUFE 0 (NEU): Verbesserter Classifier ==========
    // Prüft: Alter, Dringlichkeits-Keywords, Termine, Rechnungen, Domains
    const improved = this.improvedClassifier.klassifiziere(email);
    if (improved) {
      this.stats.stufe0Improved++;

      // Absender-Historie aktualisieren
      const fromAddress = email.from?.address || email.from || '';
      this.improvedClassifier.updateSenderHistory(fromAddress, email.subject || '', improved.kategorie);

      // Statistiken für Alters-Klassifizierung
      if (improved.ageInfo?.wasArchived) this.stats.byAge.archiv++;
      if (improved.kategorie === 'veraltet') this.stats.byAge.veraltet++;
      if (improved.ageInfo?.wasLimited) this.stats.byAge.herabgestuft++;

      return this.finalize(email, improved);
    }

    // ========== STUFE 0 (ALT): Domain-Check als Fallback ==========
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

    // Wenn sicher genug, Alters-Limit anwenden und fertig
    if (!stufe1.needsMoreText) {
      const ageLimited = applyAgeLimit(stufe1.kategorie, email.date);
      if (ageLimited.wasLimited) {
        this.stats.byAge.herabgestuft++;
        stufe1.kategorie = ageLimited.kategorie;
        stufe1.originalKategorie = ageLimited.originalKategorie;
        stufe1.gedanken += ` (Wegen Alter herabgestuft von ${ageLimited.originalKategorie} auf ${ageLimited.kategorie})`;
      }
      return this.finalize(email, stufe1);
    }

    // ========== STUFE 2: Mit Inhalt an GPT (nur bei Unsicherheit) ==========
    const stufe2 = await this.stufe2.klassifiziere(email, stufe1);
    this.stats.stufe2++;
    this.stats.gptKosten += 0.001;

    // Alters-Limit auf GPT-Ergebnis anwenden
    const ageLimited = applyAgeLimit(stufe2.kategorie, email.date);
    if (ageLimited.wasLimited) {
      this.stats.byAge.herabgestuft++;
      stufe2.kategorie = ageLimited.kategorie;
      stufe2.originalKategorie = ageLimited.originalKategorie;
      stufe2.gedanken += ` (Wegen Alter herabgestuft von ${ageLimited.originalKategorie} auf ${ageLimited.kategorie})`;
    }

    return this.finalize(email, stufe2);
  }

  // Batch-Klassifizierung für mehrere E-Mails
  async klassifiziereBatch(emails) {
    const results = [];

    // Bei Batch: Sequentiell klassifizieren
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const fromAddress = email.from?.address || email.from || '';

      // STUFE 0 (NEU): Verbesserter Classifier zuerst
      const improved = this.improvedClassifier.klassifiziere(email);
      if (improved) {
        this.stats.stufe0Improved++;
        this.improvedClassifier.updateSenderHistory(fromAddress, email.subject || '', improved.kategorie);

        if (improved.ageInfo?.wasArchived) this.stats.byAge.archiv++;
        if (improved.kategorie === 'veraltet') this.stats.byAge.veraltet++;
        if (improved.ageInfo?.wasLimited) this.stats.byAge.herabgestuft++;

        results.push(this.finalize(email, improved));
        continue;
      }

      // Stufe 0 (ALT): Domain-Check als Fallback
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
        // Alters-Limit anwenden
        const ageLimited = applyAgeLimit(stufe1.kategorie, email.date);
        if (ageLimited.wasLimited) {
          this.stats.byAge.herabgestuft++;
          stufe1.kategorie = ageLimited.kategorie;
          stufe1.originalKategorie = ageLimited.originalKategorie;
        }
        results.push(this.finalize(email, stufe1));
        continue;
      }

      // Stufe 2: Mit Inhalt
      const stufe2 = await this.stufe2.klassifiziere(email, stufe1);
      this.stats.stufe2++;
      this.stats.gptKosten += 0.001;

      // Alters-Limit anwenden
      const ageLimited = applyAgeLimit(stufe2.kategorie, email.date);
      if (ageLimited.wasLimited) {
        this.stats.byAge.herabgestuft++;
        stufe2.kategorie = ageLimited.kategorie;
        stufe2.originalKategorie = ageLimited.originalKategorie;
      }

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
