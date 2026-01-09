/**
 * Intelligentes E-Mail-Klassifizierungssystem
 *
 * Mehrstufiges, selbstlernendes System das mit minimalen GPT-Kosten maximale Genauigkeit erreicht.
 *
 * Flow:
 * 100 E-Mails → Stufe 1 (70 sofort, 0€) → Stufe 2 (25 klassifiziert, ~0.003€)
 *            → Stufe 3 (5 klassifiziert, ~0.005€) → Essenz (8-12 wichtige E-Mails)
 *
 * Kosten: ~100 E-Mails für 1 Cent!
 */

const Stufe1Classifier = require('./stufe1');
const Stufe2Classifier = require('./stufe2');
const Stufe3Classifier = require('./stufe3');
const EmailLearner = require('./learner');

// Kategorie-Definitionen
const KATEGORIEN = {
  ESSENZ: {
    id: 'essenz',
    name: 'Essenz',
    icon: '🔴',
    color: '#ef4444',
    sichtbar: true,
    beschreibung: 'Muss gelesen werden, Aktion nötig'
  },
  WICHTIG: {
    id: 'wichtig',
    name: 'Wichtig',
    icon: '🟠',
    color: '#f97316',
    sichtbar: true,
    beschreibung: 'Sollte gelesen werden'
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
    sichtbar: false, // Optional
    beschreibung: 'Automatische Benachrichtigungen'
  },
  NEWSLETTER: {
    id: 'newsletter',
    name: 'Newsletter',
    icon: '📰',
    color: '#8b5cf6',
    sichtbar: false, // Optional
    beschreibung: 'Abonnierte Newsletter'
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

// Aktions-Tags
const TAGS = {
  ANTWORT_NÖTIG: { id: 'ANTWORT_NÖTIG', name: 'Antwort nötig', icon: '↩️', color: '#ef4444' },
  TERMIN: { id: 'TERMIN', name: 'Termin', icon: '📅', color: '#10b981' },
  GELD: { id: 'GELD', name: 'Geld', icon: '💰', color: '#f59e0b' },
  DEADLINE: { id: 'DEADLINE', name: 'Deadline', icon: '⏰', color: '#ef4444' },
  FRAGE: { id: 'FRAGE', name: 'Frage', icon: '❓', color: '#8b5cf6' },
  ENTSCHEIDUNG: { id: 'ENTSCHEIDUNG', name: 'Entscheidung', icon: '⚖️', color: '#06b6d4' },
  AUTO_ANTWORT: { id: 'AUTO_ANTWORT', name: 'Auto-Antwort', icon: '🤖', color: '#6b7280' }
};

class IntelligentEmailClassifier {
  constructor(options = {}) {
    this.stufe1 = new Stufe1Classifier();
    this.stufe2 = new Stufe2Classifier();
    this.stufe3 = new Stufe3Classifier();
    this.learner = new EmailLearner(this.stufe1);

    this.options = {
      enableGPT: true,
      enableLearning: true,
      minConfidenceStufe1: 80,
      minConfidenceStufe2: 75,
      ...options
    };

    this.stats = {
      stufe1: 0,
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

  setMyEmails(emails) {
    this.stufe1.setMyEmails(emails);
  }

  // Haupt-Klassifizierungsfunktion
  async klassifiziere(email) {
    this.stats.total++;

    // Wende gelernte Regeln an
    const gelernteRegeln = this.learner.anwendenGelernteRegeln(email);

    // ========== STUFE 1: Lokal (0ms, 0€) ==========
    const stufe1 = this.stufe1.klassifiziere(email);

    // Kombiniere mit gelernten Regeln
    if (gelernteRegeln.empfehlung.confidence > 50) {
      stufe1.confidence = Math.max(stufe1.confidence, gelernteRegeln.empfehlung.confidence);
      if (gelernteRegeln.empfehlung.score > 30) {
        stufe1.reasons.push('Gelerntes Muster');
      }
    }

    if (!stufe1.needsGPT || !this.options.enableGPT) {
      this.stats.stufe1++;
      return this.finalize(email, stufe1);
    }

    // ========== STUFE 2: Betreff-GPT (~100ms, ~0.0001€) ==========
    const stufe2 = await this.stufe2.klassifiziere(email, stufe1);

    if (!stufe2.needsGPT) {
      this.stats.stufe2++;
      this.stats.gptKosten += 0.0001;
      return this.finalize(email, stufe2);
    }

    // ========== STUFE 3: Volltext-GPT (~300ms, ~0.001€) ==========
    const stufe3 = await this.stufe3.klassifiziere(email, stufe2);

    this.stats.stufe3++;
    this.stats.gptKosten += 0.001;
    return this.finalize(email, stufe3);
  }

  // Batch-Klassifizierung für mehrere E-Mails
  async klassifiziereBatch(emails) {
    const results = [];
    const needsStufe2 = [];
    const needsStufe2Indices = [];

    // Stufe 1 für alle
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const stufe1 = this.stufe1.klassifiziere(email);

      if (!stufe1.needsGPT || !this.options.enableGPT) {
        this.stats.stufe1++;
        results[i] = this.finalize(email, stufe1);
      } else {
        needsStufe2.push(email);
        needsStufe2Indices.push(i);
        results[i] = null; // Placeholder
      }
    }

    // Stufe 2 für unsichere (Batch)
    if (needsStufe2.length > 0) {
      const stufe1Results = needsStufe2Indices.map(i => {
        return this.stufe1.klassifiziere(emails[i]);
      });

      const stufe2Results = await this.stufe2.batchKlassifiziere(needsStufe2, stufe1Results);

      for (let j = 0; j < needsStufe2.length; j++) {
        const originalIndex = needsStufe2Indices[j];
        const email = needsStufe2[j];
        const stufe2 = stufe2Results[j];

        if (!stufe2.needsGPT) {
          this.stats.stufe2++;
          this.stats.gptKosten += 0.0001;
          results[originalIndex] = this.finalize(email, stufe2);
        } else {
          // Stufe 3 für diese E-Mail
          const stufe3 = await this.stufe3.klassifiziere(email, stufe2);
          this.stats.stufe3++;
          this.stats.gptKosten += 0.001;
          results[originalIndex] = this.finalize(email, stufe3);
        }
      }
    }

    return results;
  }

  // Finalisiere Klassifizierung
  finalize(email, result) {
    // Lern-System informieren
    if (this.options.enableLearning) {
      this.learner.trackKlassifizierung(email, result);
    }

    // Tags berechnen
    const tags = this.berechneTags(email, result);

    // Kategorie-Info hinzufügen
    const kategorieInfo = KATEGORIEN[result.kategorie.toUpperCase()] || KATEGORIEN.NORMAL;

    return {
      id: email.id || email.messageId,
      kategorie: result.kategorie,
      kategorieInfo,
      confidence: result.confidence,
      tags,
      tagsInfo: tags.map(t => TAGS[t] || { id: t, name: t }),
      zusammenfassung: result.zusammenfassung,
      aktion: result.aktion,
      deadline: result.deadline,
      autoAntwortMöglich: result.autoAntwortMöglich,
      autoAntwortVorschlag: result.autoAntwortVorschlag,
      stufe: result.stufe,
      reasons: result.reasons || [],
      gptKosten: this.berechneKosten(result.stufe)
    };
  }

  berechneTags(email, result) {
    const tags = new Set(result.tags || []);

    // Zusätzliche Tags basierend auf Analyse
    const subject = (email.subject || '').toLowerCase();
    const text = (email.text || email.body || '').toLowerCase();

    // ANTWORT_NÖTIG
    if (result.erwartetAntwort || /antwort|reply|rückmeldung/i.test(subject)) {
      tags.add('ANTWORT_NÖTIG');
    }

    // TERMIN
    if (/termin|meeting|call|besprechung/i.test(subject) ||
        /\d{1,2}\.\d{1,2}\.\d{2,4}.*\d{1,2}:\d{2}/.test(text)) {
      tags.add('TERMIN');
    }

    // GELD
    if (/rechnung|invoice|zahlung|payment|€|CHF/i.test(subject)) {
      tags.add('GELD');
    }

    // DEADLINE
    if (result.deadline || /deadline|frist|bis zum|spätestens/i.test(subject)) {
      tags.add('DEADLINE');
    }

    // FRAGE
    if (result.istFrage || /\?/.test(subject)) {
      tags.add('FRAGE');
    }

    // AUTO_ANTWORT
    if (result.autoAntwortMöglich) {
      tags.add('AUTO_ANTWORT');
    }

    return Array.from(tags);
  }

  berechneKosten(stufe) {
    switch (stufe) {
      case 1: return 0;
      case 2: return 0.0001;
      case 3: return 0.001;
      default: return 0;
    }
  }

  // === LEARNING INTERFACE ===

  // User korrigiert Kategorie manuell
  korrigiereKategorie(email, alteKategorie, neueKategorie) {
    if (this.options.enableLearning) {
      this.learner.trackManuelleKorrektur(email, alteKategorie, neueKategorie);
    }
  }

  // User öffnet E-Mail
  emailGeöffnet(email) {
    if (this.options.enableLearning) {
      this.learner.trackGeöffnet(email);
    }
  }

  // User antwortet
  emailBeantwortet(email) {
    if (this.options.enableLearning) {
      this.learner.trackBeantwortet(email);
    }
  }

  // User löscht ohne zu lesen
  emailGelöschtOhneLesen(email) {
    if (this.options.enableLearning) {
      this.learner.trackGelöschtOhneLesen(email);
    }
  }

  // === CONFIG INTERFACE ===

  addToVIP(email) {
    this.stufe1.addToVIPs(email);
  }

  addToFamily(email) {
    this.stufe1.addToFamily(email);
  }

  addToCustomers(email) {
    this.stufe1.addToCustomers(email);
  }

  addToWhitelist(email) {
    this.stufe1.addToWhitelist(email);
  }

  addToBlacklist(email) {
    this.stufe1.addToBlacklist(email);
  }

  // === STATS ===

  getStats() {
    return {
      ...this.stats,
      learning: this.learner.getLernfortschritt(),
      kostenGesamt: `${(this.stats.gptKosten * 100).toFixed(2)} Cent`
    };
  }

  getEssenz(emails, klassifizierungen) {
    // Filtere nur ESSENZ und WICHTIG E-Mails
    return klassifizierungen
      .map((k, i) => ({ ...k, email: emails[i] }))
      .filter(k => k.kategorie === 'essenz' || k.kategorie === 'wichtig')
      .sort((a, b) => {
        // Essenz vor Wichtig
        if (a.kategorie !== b.kategorie) {
          return a.kategorie === 'essenz' ? -1 : 1;
        }
        // Nach Confidence sortieren
        return b.confidence - a.confidence;
      });
  }

  // === EXPORT ===

  exportLearningData() {
    return this.learner.exportData();
  }

  importLearningData(data) {
    this.learner.importData(data);
  }

  resetLearning() {
    this.learner.reset();
  }
}

// Exportiere alles
module.exports = {
  IntelligentEmailClassifier,
  KATEGORIEN,
  TAGS,
  Stufe1Classifier,
  Stufe2Classifier,
  Stufe3Classifier,
  EmailLearner
};
