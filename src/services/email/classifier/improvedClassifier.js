/**
 * Verbessertes E-Mail-Klassifizierungssystem v2
 *
 * NEUE FEATURES:
 * - Alters-basierte Klassifizierung
 * - Dringlichkeits-Keywords VOR Domain-Check
 * - Neue Kategorien: termine, rechnung, veraltet
 * - Absender-Historie Integration
 */

const Store = require('electron-store');

// =============================================================================
// ALTERS-KONSTANTEN
// =============================================================================

const AGE_THRESHOLDS = {
  SEHR_AKTUELL: 3,      // 0-3 Tage: Kann ESSENZ sein
  AKTUELL: 7,           // 3-7 Tage: Kann ESSENZ/WICHTIG sein
  RELEVANT: 14,         // 1-2 Wochen: Maximal WICHTIG
  ALT: 30,              // 2-4 Wochen: Maximal NORMAL
  VERALTET: 90,         // 1-3 Monate: Nur VERALTET
  ARCHIV: Infinity      // > 3 Monate: Ignorieren
};

// Kategorie-Rang für Alters-Limit
const CATEGORY_RANK = {
  'essenz': 6,
  'wichtig': 5,
  'termine': 4,
  'rechnung': 3,  // Rechnungen ignorieren Alter
  'normal': 2,
  'veraltet': 1,
  'info': 2,
  'newsletter': 1,
  'werbung': 1,
  'spam': 0
};

// =============================================================================
// KEYWORD-PATTERNS
// =============================================================================

// ESSENZ - Sofortige Aktion (nur wenn < 7 Tage alt!)
const ESSENZ_PATTERNS = [
  // Rechtlich/Finanziell dringend
  /vollstreckung/i,
  /letzte\s*mahnung/i,
  /inkasso/i,
  /anwalt/i,
  /gericht/i,
  /klage/i,
  /zwangsvollstreckung/i,
  /pfändung/i,
  /mahnbescheid/i,

  // Persönliche Anfragen
  /bitte\s*(um\s*)?anrufen/i,
  /rückruf/i,
  /ruf.*an/i,
  /kann\s*dich\s*nicht\s*erreichen/i,
  /melde\s*dich/i,
  /dringend/i,
  /urgent/i,

  // Meetings mit Namen (Roland = der User)
  /meeting\s*roland/i,
  /termin\s*roland/i,
  /besprechung\s*roland/i
];

// WICHTIG - Sollte heute gelesen werden (nur wenn < 14 Tage alt!)
const WICHTIG_PATTERNS = [
  // Zahlungsprobleme
  /fehlgeschlagen/i,
  /abgelehnt/i,
  /nicht\s*möglich/i,
  /kreditkarteneinzug/i,
  /einzug\s*fehlgeschlagen/i,
  /zahlung\s*fehlgeschlagen/i,
  /konto\s*nicht\s*gedeckt/i,
  /zahlungserinnerung/i,
  /zahlungsproblem/i,

  // Mahnungen (ohne "letzte")
  /mahnung/i,

  // Fristen
  /letzte\s*chance/i,
  /läuft\s*ab/i,
  /endet\s*heute/i,
  /frist/i,
  /deadline/i,

  // Wichtige Änderungen
  /kündigung/i,
  /gekündigt/i,
  /vertragsänderung/i,
  /sperrung/i,
  /gesperrt/i,
  /deaktiviert/i
];

// RECHNUNG - Alter egal
const RECHNUNG_PATTERNS = [
  /ihre.*rechnung/i,
  /rechnung\s*nr/i,
  /rechnungsnummer/i,
  /invoice/i,
  /zahlungseingang/i,
  /zahlungsbestätigung/i,
  /ihre\s*\d+&?\d*\s*rechnung/i  // "Ihre 1&1 Rechnung"
];

// TERMINE - Zoom, Teams, Kalender
const TERMIN_PATTERNS = [
  // Zoom
  /zoom.*meeting/i,
  /zoom.*einladung/i,
  /join.*zoom/i,

  // Teams
  /teams.*meeting/i,
  /teams.*einladung/i,
  /teams.*besprechung/i,
  /microsoft\s*teams/i,

  // Google
  /calendar.*invite/i,
  /google.*calendar/i,
  /einladung.*kalender/i,

  // Allgemein
  /einladung.*besprechung/i,
  /termin.*einladung/i,
  /meeting.*einladung/i,
  /besprechungsanfrage/i,
  /terminanfrage/i
];

const TERMIN_DOMAINS = [
  'calendar.google.com',
  'teams.microsoft.com',
  'zoom.us',
  'calendly.com',
  'doodle.com'
];

// =============================================================================
// DOMAIN-RULES (NUR wenn keine Dringlichkeit!)
// =============================================================================

const SPAM_DOMAINS = [
  'mediamarkt.de', 'saturn.de', 'amazon.', 'ebay.',
  'zalando.', 'otto.de', 'lidl.', 'aldi.',
  'marketing.', 'promo.', 'deals.', 'shop.',
  'mail.facebook.com', 'facebookmail.com',
  'pinterest.com', 'tiktok.com'
];

const NEWSLETTER_DOMAINS = [
  'newsletter.', 'news.', 'update.', 'digest.',
  'eventim.', 'ticketmaster.', 'eventbrite.',
  'substack.com', 'mailchimp.com', 'sendinblue.'
];

const INFO_DOMAINS = [
  'noreply.', 'no-reply.', 'notification.',
  'github.com', 'gitlab.com', 'wordpress.',
  'dhl.', 'dpd.', 'ups.', 'fedex.', 'post.ch'
];

// MIXED_DOMAINS - Können wichtige Mails enthalten!
// NICHT automatisch als info markieren
const MIXED_DOMAINS = [
  'ionos.de', '1und1.de', 'hosteurope.de',
  'wise.com', 'paypal.com', 'stripe.com',
  'google.com', 'linkedin.com', 'twitter.com', 'instagram.com'
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getAgeInDays(emailDate) {
  if (!emailDate) return 0;
  const now = new Date();
  const email = new Date(emailDate);
  const diffMs = now - email;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getMaxCategoryByAge(emailDate) {
  const ageInDays = getAgeInDays(emailDate);

  if (ageInDays <= AGE_THRESHOLDS.SEHR_AKTUELL) {
    return { maxCategory: 'essenz', ageGroup: 'SEHR_AKTUELL', ageInDays };
  }
  if (ageInDays <= AGE_THRESHOLDS.AKTUELL) {
    return { maxCategory: 'essenz', ageGroup: 'AKTUELL', ageInDays };
  }
  if (ageInDays <= AGE_THRESHOLDS.RELEVANT) {
    return { maxCategory: 'wichtig', ageGroup: 'RELEVANT', ageInDays };
  }
  if (ageInDays <= AGE_THRESHOLDS.ALT) {
    return { maxCategory: 'normal', ageGroup: 'ALT', ageInDays };
  }
  if (ageInDays <= AGE_THRESHOLDS.VERALTET) {
    return { maxCategory: 'veraltet', ageGroup: 'VERALTET', ageInDays };
  }
  return { maxCategory: 'archiv', ageGroup: 'ARCHIV', ageInDays };
}

function applyAgeLimit(kategorie, emailDate, originalKategorie = null) {
  const { maxCategory, ageGroup, ageInDays } = getMaxCategoryByAge(emailDate);

  // Rechnungen, Info, Newsletter, Spam ignorieren Alters-Limit
  if (['rechnung', 'info', 'newsletter', 'werbung', 'spam'].includes(kategorie)) {
    return { kategorie, wasLimited: false, ageGroup, ageInDays };
  }

  // Wenn erkannte Kategorie höher als erlaubt → herabstufen
  if (CATEGORY_RANK[kategorie] > CATEGORY_RANK[maxCategory]) {
    console.log(`[AGE-LIMIT] ${kategorie} → ${maxCategory} (E-Mail ist ${ageInDays} Tage alt, ${ageGroup})`);
    return {
      kategorie: maxCategory,
      wasLimited: true,
      originalKategorie: originalKategorie || kategorie,
      ageGroup,
      ageInDays
    };
  }

  return { kategorie, wasLimited: false, ageGroup, ageInDays };
}

function matchesPatterns(text, patterns) {
  if (!text) return false;
  return patterns.some(pattern => pattern.test(text));
}

function matchesDomain(emailAddress, domains) {
  if (!emailAddress) return false;
  const addr = emailAddress.toLowerCase();
  return domains.some(domain => addr.includes(domain));
}

function extractDomain(email) {
  if (!email) return '';
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

// =============================================================================
// IMPROVED CLASSIFIER CLASS
// =============================================================================

class ImprovedClassifier {
  constructor() {
    this.senderHistoryStore = new Store({ name: 'sender-history' });
  }

  /**
   * Haupt-Klassifizierungsfunktion
   */
  klassifiziere(email) {
    const subject = email.subject || '';
    const fromAddress = email.from?.address || email.from || '';
    const fromName = email.from?.name || '';
    const emailDate = email.date;
    const fromDomain = extractDomain(fromAddress);

    console.log(`[IMPROVED] Klassifiziere: "${subject.substring(0, 50)}..." von ${fromAddress}`);

    // ========== STUFE 0: ALTER PRÜFEN ==========
    const { maxCategory, ageGroup, ageInDays } = getMaxCategoryByAge(emailDate);

    // E-Mail > 3 Monate? → Ignorieren
    if (ageGroup === 'ARCHIV') {
      console.log(`[IMPROVED] E-Mail ist ${ageInDays} Tage alt → ARCHIV/Ignorieren`);
      return {
        kategorie: 'info',  // oder 'archiv' wenn gewünscht
        confidence: 100,
        gedanken: `Diese E-Mail ist ${ageInDays} Tage alt (über 3 Monate). Wenn sie wichtig gewesen wäre, hätte sich das längst geklärt.`,
        stufe: 0,
        schnell: true,
        ageInfo: { ageInDays, ageGroup, wasArchived: true }
      };
    }

    // ========== STUFE 1: TERMIN-CHECK ==========
    if (this.isTermin(email, fromDomain, subject)) {
      const terminResult = this.classifyTermin(email);
      if (terminResult) {
        return terminResult;
      }
    }

    // ========== STUFE 2: DRINGLICHKEITS-CHECK (VOR Domain!) ==========

    // ESSENZ Keywords (nur wenn E-Mail < 7 Tage alt)
    if (matchesPatterns(subject, ESSENZ_PATTERNS)) {
      const ageResult = applyAgeLimit('essenz', emailDate);
      return {
        kategorie: ageResult.kategorie,
        confidence: 95,
        gedanken: ageResult.wasLimited
          ? `Dringendes Keyword gefunden, aber E-Mail ist ${ageResult.ageInDays} Tage alt. War: ESSENZ, jetzt: ${ageResult.kategorie.toUpperCase()}`
          : `Dringendes Keyword im Betreff erkannt. Diese E-Mail erfordert sofortige Aufmerksamkeit!`,
        stufe: 0,
        schnell: true,
        ageInfo: ageResult,
        originalKategorie: ageResult.wasLimited ? 'essenz' : null
      };
    }

    // WICHTIG Keywords (nur wenn E-Mail < 14 Tage alt)
    if (matchesPatterns(subject, WICHTIG_PATTERNS)) {
      const ageResult = applyAgeLimit('wichtig', emailDate);
      return {
        kategorie: ageResult.kategorie,
        confidence: 90,
        gedanken: ageResult.wasLimited
          ? `Wichtiges Keyword gefunden, aber E-Mail ist ${ageResult.ageInDays} Tage alt. War: WICHTIG, jetzt: ${ageResult.kategorie.toUpperCase()}`
          : `Wichtiges Keyword im Betreff erkannt. Diese E-Mail sollte heute gelesen werden.`,
        stufe: 0,
        schnell: true,
        ageInfo: ageResult,
        originalKategorie: ageResult.wasLimited ? 'wichtig' : null
      };
    }

    // RECHNUNG Keywords (Alter egal!)
    if (matchesPatterns(subject, RECHNUNG_PATTERNS)) {
      return {
        kategorie: 'rechnung',
        confidence: 92,
        gedanken: `Rechnung erkannt im Betreff. Rechnungen werden unabhängig vom Alter gespeichert.`,
        stufe: 0,
        schnell: true,
        ageInfo: { ageInDays, ageGroup, wasLimited: false }
      };
    }

    // ========== STUFE 3: ABSENDER-HISTORIE ==========
    const senderHistory = this.getSenderHistory(fromAddress);
    if (senderHistory && senderHistory.urgencyScore > 75) {
      // Dieser Absender ist oft wichtig - nicht automatisch als info markieren!
      console.log(`[IMPROVED] Absender ${fromAddress} hat hohen Urgency-Score: ${senderHistory.urgencyScore}`);
      return null; // GPT entscheiden lassen
    }

    // ========== STUFE 4: DOMAIN-CHECK (nur wenn keine Dringlichkeit) ==========

    // MIXED_DOMAINS - NICHT automatisch als info markieren!
    if (matchesDomain(fromAddress, MIXED_DOMAINS)) {
      console.log(`[IMPROVED] Mixed Domain ${fromDomain} - GPT muss entscheiden`);
      return null; // GPT entscheiden lassen
    }

    // SPAM Domains
    if (matchesDomain(fromAddress, SPAM_DOMAINS)) {
      return {
        kategorie: 'werbung',
        confidence: 90,
        gedanken: `"${fromDomain}" ist eine bekannte Werbe-Domain. Das sind automatische Marketing-Mails.`,
        stufe: 0,
        schnell: true,
        ageInfo: { ageInDays, ageGroup, wasLimited: false }
      };
    }

    // NEWSLETTER Domains
    if (matchesDomain(fromAddress, NEWSLETTER_DOMAINS)) {
      return {
        kategorie: 'newsletter',
        confidence: 88,
        gedanken: `"${fromDomain}" ist ein Newsletter-Absender. Das sind abonnierte Updates.`,
        stufe: 0,
        schnell: true,
        ageInfo: { ageInDays, ageGroup, wasLimited: false }
      };
    }

    // INFO Domains
    if (matchesDomain(fromAddress, INFO_DOMAINS)) {
      return {
        kategorie: 'info',
        confidence: 85,
        gedanken: `"${fromDomain}" ist eine automatische System-Adresse. Das sind Benachrichtigungen.`,
        stufe: 0,
        schnell: true,
        ageInfo: { ageInDays, ageGroup, wasLimited: false }
      };
    }

    // Prefix-Check
    const localPart = fromAddress.split('@')[0].toLowerCase();
    const infoPrefixes = ['noreply', 'no-reply', 'notification', 'mailer', 'postmaster', 'daemon', 'system'];
    if (infoPrefixes.some(p => localPart.includes(p))) {
      return {
        kategorie: 'info',
        confidence: 85,
        gedanken: `Die E-Mail-Adresse enthält "${localPart}" - das ist typisch für automatische System-Mails.`,
        stufe: 0,
        schnell: true,
        ageInfo: { ageInDays, ageGroup, wasLimited: false }
      };
    }

    // ========== NICHT ERKANNT → GPT MUSS RAN ==========
    console.log(`[IMPROVED] Keine schnelle Klassifizierung möglich → GPT`);
    return null;
  }

  /**
   * Prüft ob E-Mail ein Termin ist
   */
  isTermin(email, fromDomain, subject) {
    // Termin-Domain?
    if (TERMIN_DOMAINS.some(d => fromDomain.includes(d))) {
      return true;
    }
    // Termin-Keywords im Betreff?
    return matchesPatterns(subject, TERMIN_PATTERNS);
  }

  /**
   * Klassifiziert Termin-E-Mails
   */
  classifyTermin(email) {
    const subject = email.subject || '';
    const emailDate = email.date;
    const ageInDays = getAgeInDays(emailDate);

    // Versuche Termin-Datum zu extrahieren
    const terminDatum = this.extractTerminDate(subject, email.body);

    if (terminDatum) {
      const now = new Date();
      const diffDays = (terminDatum - now) / (1000 * 60 * 60 * 24);

      if (diffDays >= 0) {
        // Termin liegt in der Zukunft
        return {
          kategorie: 'termine',
          confidence: 92,
          gedanken: `Termin-Einladung erkannt. Der Termin ist am ${terminDatum.toLocaleDateString('de-DE')}.`,
          stufe: 0,
          schnell: true,
          terminInfo: { datum: terminDatum, zukunft: true }
        };
      }
      if (diffDays >= -1) {
        // Termin war gestern - vielleicht verpasst!
        return {
          kategorie: 'termine',
          confidence: 90,
          gedanken: `Termin-Einladung erkannt. ACHTUNG: Der Termin war gestern! Möglicherweise verpasst.`,
          stufe: 0,
          schnell: true,
          terminInfo: { datum: terminDatum, verpasst: true },
          warnung: 'Dieser Termin war gestern!'
        };
      }
      // Termin ist vorbei
      return {
        kategorie: 'info',
        confidence: 88,
        gedanken: `Termin-Einladung, aber der Termin (${terminDatum.toLocaleDateString('de-DE')}) ist bereits vorbei.`,
        stufe: 0,
        schnell: true,
        terminInfo: { datum: terminDatum, vorbei: true }
      };
    }

    // Kein Datum gefunden - nach E-Mail-Alter gehen
    if (ageInDays <= 7) {
      return {
        kategorie: 'termine',
        confidence: 85,
        gedanken: `Termin-Einladung erkannt. E-Mail ist ${ageInDays} Tage alt, Termin könnte noch relevant sein.`,
        stufe: 0,
        schnell: true
      };
    }

    // Alte Termin-Mail
    return {
      kategorie: 'info',
      confidence: 80,
      gedanken: `Termin-Einladung, aber E-Mail ist ${ageInDays} Tage alt. Der Termin ist wahrscheinlich vorbei.`,
      stufe: 0,
      schnell: true
    };
  }

  /**
   * Versucht Termin-Datum aus Betreff/Body zu extrahieren
   */
  extractTerminDate(subject, body) {
    const text = `${subject} ${body || ''}`;

    // Pattern: 15.01.2026 oder 15.1.2026
    const germanDate = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (germanDate) {
      const [, day, month, year] = germanDate;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // Pattern: 2026-01-15
    const isoDate = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoDate) {
      const [, year, month, day] = isoDate;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    return null;
  }

  /**
   * Absender-Historie laden
   */
  getSenderHistory(email) {
    try {
      return this.senderHistoryStore.get(`senders.${email.replace(/\./g, '_')}`);
    } catch (e) {
      return null;
    }
  }

  /**
   * Absender-Historie aktualisieren
   */
  updateSenderHistory(email, subject, kategorie) {
    try {
      const key = `senders.${email.replace(/\./g, '_')}`;
      let sender = this.senderHistoryStore.get(key) || {
        email: email,
        totalEmails: 0,
        categories: {},
        recentSubjects: []
      };

      // Update counts
      sender.totalEmails++;
      sender.categories[kategorie] = (sender.categories[kategorie] || 0) + 1;
      sender.lastEmailDate = new Date().toISOString();

      // Add to recent subjects (keep last 10)
      sender.recentSubjects.unshift({
        subject: subject.substring(0, 100),
        date: new Date().toISOString(),
        kategorie
      });
      sender.recentSubjects = sender.recentSubjects.slice(0, 10);

      // Recalculate urgency score
      sender.urgencyScore = this.calculateUrgencyScore(sender);

      this.senderHistoryStore.set(key, sender);
      return sender;
    } catch (e) {
      console.error('[SENDER-HISTORY] Update error:', e);
      return null;
    }
  }

  /**
   * Urgency Score berechnen
   */
  calculateUrgencyScore(sender) {
    let score = 50;

    // Wiederholte Betreffs
    const subjectCounts = {};
    sender.recentSubjects.forEach(s => {
      const key = s.subject.toLowerCase().substring(0, 50);
      subjectCounts[key] = (subjectCounts[key] || 0) + 1;
    });
    const maxRepeats = Math.max(...Object.values(subjectCounts), 0);
    if (maxRepeats >= 4) score += 35;
    else if (maxRepeats >= 3) score += 25;
    else if (maxRepeats >= 2) score += 15;

    // Historisch wichtige E-Mails
    const wichtig = (sender.categories.essenz || 0) + (sender.categories.wichtig || 0);
    const ratio = wichtig / Math.max(sender.totalEmails, 1);
    score += ratio * 30;

    // Aktivität in letzter Woche
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCount = sender.recentSubjects.filter(s => new Date(s.date) > oneWeekAgo).length;
    if (recentCount >= 4) score += 20;
    else if (recentCount >= 2) score += 10;

    return Math.min(Math.round(score), 100);
  }

  /**
   * Wendet Alters-Limit auf GPT-Ergebnis an
   */
  applyAgeLimitToResult(result, emailDate) {
    return applyAgeLimit(result.kategorie, emailDate, result.kategorie);
  }
}

module.exports = {
  ImprovedClassifier,
  getAgeInDays,
  getMaxCategoryByAge,
  applyAgeLimit,
  AGE_THRESHOLDS,
  ESSENZ_PATTERNS,
  WICHTIG_PATTERNS,
  RECHNUNG_PATTERNS,
  TERMIN_PATTERNS
};
