/**
 * E-Mail-Klassifizierungssystem v3
 *
 * GRUNDPRINZIP: DENKEN statt REGELN
 * Keywords sind SIGNALE, keine Entscheidungen!
 *
 * REIHENFOLGE:
 * 1. RECHNUNG (Alter egal)
 * 2. TERMIN (eigene Datum-Logik)
 * 3. BEKANNTE DOMAINS (VOR Keywords!)
 * 4. ALTER > 90 Tage = ARCHIV
 * 5. ABSENDER-HISTORIE
 * 6. DRINGLICHKEITS-SIGNALE erkennen
 * 7. GPT MIT INHALT (bei Signalen)
 * 8. GPT NUR HEADER (ohne Signal)
 * 9. ALTERS-LIMIT anwenden
 */

const Store = require('electron-store');

// =============================================================================
// ALTERS-KONSTANTEN
// =============================================================================

const AGE_LIMITS = {
  ARCHIV: 90,      // > 90 Tage: Ignorieren
  VERALTET: 30,    // > 30 Tage: Max. VERALTET
  ALT: 14,         // > 14 Tage: Max. NORMAL
  AKTUELL: 7       // > 7 Tage: Max. WICHTIG
};

// =============================================================================
// STUFE 1: RECHNUNG PATTERNS
// =============================================================================

const RECHNUNG_PATTERNS = [
  /ihre.*rechnung/i,
  /rechnung\s*(nr|nummer)?\.?\s*\d*/i,
  /rechnungsnummer/i,
  /invoice/i,
  /zahlungseingang/i,
  /zahlungsbestätigung/i,
  /zahlungsbeleg/i,
  /rechnung.*anhang/i,
  /1&1.*rechnung/i,
  /ionos.*rechnung/i,
  /ihre.*1&1.*rechnung/i,
  /ihre.*ionos.*rechnung/i
];

// =============================================================================
// STUFE 2: TERMIN PATTERNS & DOMAINS
// =============================================================================

const TERMIN_PATTERNS = [
  // Zoom
  /zoom.*meeting/i,
  /zoom.*einladung/i,
  /join.*zoom/i,
  /zoom-meeting/i,

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
  /terminanfrage/i,
  /meeting-einladung/i
];

const TERMIN_DOMAINS = [
  'calendar.google.com',
  'teams.microsoft.com',
  'zoom.us',
  'calendly.com',
  'doodle.com'
];

// =============================================================================
// STUFE 3: DOMAIN-LISTEN (KRITISCH: VOR KEYWORDS!)
// =============================================================================

// WERBUNG-Domains - IMMER Werbung, egal welche Keywords!
const WERBUNG_DOMAINS = [
  // Shops
  'mediamarkt.de', 'saturn.de', 'amazon.', 'ebay.',
  'zalando.', 'otto.de', 'lidl.', 'aldi.',
  'nespresso.com', 'ch.nespresso.com',
  'aboutyou.', 'hm.com', 'zara.com',
  'ikea.', 'hornbach.', 'obi.', 'bauhaus.',

  // Marketing
  'marketing.', 'promo.', 'deals.', 'offers.', 'shop.',
  'newsletter.mediamarkt', 'newsletter.saturn',
  'mail.mediamarkt', 'mail.saturn',

  // Social (Werbung)
  'mail.facebook.com', 'facebookmail.com',
  'pinterest.com', 'tiktok.com',

  // Reise-Werbung
  'booking.com', 'expedia.', 'trivago.',
  'holidaycheck.', 'tui.com', 'lastminute.',

  // Sonstige Werbung
  'groupon.', 'mydealz.', 'sparwelt.',
  'check24.', 'verivox.'
];

// NEWSLETTER-Domains
const NEWSLETTER_DOMAINS = [
  'newsletter.', 'news.', 'update.', 'digest.',
  'eventim.', 'ticketmaster.', 'eventbrite.',
  'substack.com', 'mailchimp.com', 'sendinblue.',
  'finanzen.net', 'traderfox.',
  'kadewe.', 'breuninger.'
];

// INFO-Domains - Automatische Benachrichtigungen
const INFO_DOMAINS = [
  // Notifications
  'noreply.', 'no-reply.', 'notification.',
  'mailer.', 'postmaster.', 'daemon.', 'system.',
  'notify.', 'alerts.',

  // Tech
  'github.com', 'gitlab.com', 'wordpress.',
  'accounts.google.com',

  // Versand
  'dhl.', 'dpd.', 'ups.', 'fedex.', 'post.ch',
  'hermes.', 'gls.', 'dhl-news.'
];

// MIXED-Domains - GPT muss entscheiden!
const MIXED_DOMAINS = [
  // Hosting - können wichtige E-Mails haben!
  'ionos.de', '1und1.de', '1and1.', 'hosteurope.de',
  'strato.', 'hetzner.',

  // Finanzen - können wichtig sein!
  'wise.com', 'paypal.com', 'stripe.com',
  'sparkasse.', 'volksbank.', 'commerzbank.',
  'postbank.', 'ing.', 'dkb.',

  // Social (kann wichtig sein)
  'linkedin.com', 'xing.com',

  // Google (mixed)
  'google.com'
];

// Eigene E-Mail-Adressen (werden als SPAM/TEST markiert)
const MY_EMAILS = [
  'r.internet.rm@gmail.com',
  'roland@romuswiss.ch',
  'r.mueller@siteschrift.de'
];

// =============================================================================
// STUFE 6: DRINGLICHKEITS-SIGNALE (NUR erkennen, NICHT entscheiden!)
// =============================================================================

const DRINGLICHKEIT_SIGNALE = {
  RECHTLICH: [
    /vollstreckung/i,
    /letzte\s*mahnung/i,
    /mahnung/i,
    /inkasso/i,
    /anwalt/i,
    /gericht/i,
    /klage/i,
    /pfändung/i,
    /mahnbescheid/i,
    /zwangsvollstreckung/i
  ],

  PERSOENLICH: [
    /bitte\s*(um\s*)?(an)?rufen/i,
    /rückruf/i,
    /ruf.*an/i,
    /melde\s*dich/i,
    /kann\s*dich\s*nicht\s*erreichen/i,
    /dringend/i,
    /urgent/i
  ],

  FINANZIELL: [
    /fehlgeschlagen/i,
    /abgelehnt/i,
    /gesperrt/i,
    /sperrung/i,
    /kreditkarte.*fehl/i,
    /einzug.*fehl/i,
    /zahlung.*fehl/i,
    /konto.*gesperrt/i
  ],

  FRISTEN: [
    /letzte\s*chance/i,
    /frist/i,
    /deadline/i,
    /läuft\s*ab/i,
    /endet\s*(heute|morgen)/i
  ]
};

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

function extractDomain(email) {
  if (!email) return '';
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

function extractEmail(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s<]+@[^\s>]+)/);
  return match ? match[1].toLowerCase() : from.toLowerCase();
}

function matchesPatterns(text, patterns) {
  if (!text) return false;
  return patterns.some(pattern => pattern.test(text));
}

function matchesDomain(emailAddress, domains) {
  if (!emailAddress) return false;
  const addr = emailAddress.toLowerCase();
  const domain = extractDomain(emailAddress);
  return domains.some(d => addr.includes(d) || domain.includes(d));
}

// =============================================================================
// STUFE 1: RECHNUNG CHECK
// =============================================================================

function isRechnung(subject) {
  return matchesPatterns(subject, RECHNUNG_PATTERNS);
}

// =============================================================================
// STUFE 2: TERMIN CHECK & HANDLING
// =============================================================================

function isTermin(email, fromDomain, subject) {
  // Termin-Domain?
  if (TERMIN_DOMAINS.some(d => fromDomain.includes(d))) {
    return true;
  }
  // Termin-Keywords im Betreff?
  return matchesPatterns(subject, TERMIN_PATTERNS);
}

function extractTerminDate(subject, body) {
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

function handleTermin(email) {
  const subject = email.subject || '';
  const body = email.text || email.html || '';
  const emailAge = getAgeInDays(email.date);

  const terminDatum = extractTerminDate(subject, body);

  if (terminDatum) {
    const now = new Date();
    const diffMs = terminDatum - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays >= 0) {
      // Termin liegt in der Zukunft
      return {
        kategorie: 'termine',
        confidence: 95,
        gedanken: `Termin-Einladung erkannt. Der Termin ist am ${terminDatum.toLocaleDateString('de-DE')}.`,
        stufe: 2,
        terminDatum: terminDatum,
        final: true
      };
    }

    if (diffDays >= -1) {
      // Termin war gestern - vielleicht verpasst!
      return {
        kategorie: 'termine',
        confidence: 92,
        gedanken: `Termin-Einladung erkannt. ACHTUNG: Der Termin war gestern! Möglicherweise verpasst.`,
        stufe: 2,
        terminDatum: terminDatum,
        warnung: 'Dieser Termin war gestern!',
        final: true
      };
    }

    if (diffDays < -14) {
      // Termin ist > 14 Tage vorbei → Papierkorb
      return {
        kategorie: 'papierkorb',
        confidence: 90,
        gedanken: `Termin-Einladung, aber der Termin (${terminDatum.toLocaleDateString('de-DE')}) ist über 14 Tage vorbei.`,
        stufe: 2,
        terminDatum: terminDatum,
        final: true
      };
    }

    // Termin ist 1-14 Tage vorbei → Info
    return {
      kategorie: 'info',
      confidence: 88,
      gedanken: `Termin-Einladung, aber der Termin (${terminDatum.toLocaleDateString('de-DE')}) ist bereits vorbei.`,
      stufe: 2,
      terminDatum: terminDatum,
      final: true
    };
  }

  // Kein Datum gefunden - nach E-Mail-Alter gehen
  if (emailAge <= 7) {
    return {
      kategorie: 'termine',
      confidence: 85,
      gedanken: `Termin-Einladung erkannt. E-Mail ist ${emailAge} Tage alt, Termin könnte noch relevant sein.`,
      stufe: 2,
      final: true
    };
  }

  if (emailAge > 14) {
    return {
      kategorie: 'papierkorb',
      confidence: 80,
      gedanken: `Alte Termin-Mail (${emailAge} Tage) ohne erkennbares Datum. Termin ist wahrscheinlich vorbei.`,
      stufe: 2,
      final: true
    };
  }

  // 7-14 Tage alt
  return {
    kategorie: 'info',
    confidence: 78,
    gedanken: `Termin-Mail ist ${emailAge} Tage alt. Der Termin ist wahrscheinlich vorbei.`,
    stufe: 2,
    final: true
  };
}

// =============================================================================
// STUFE 3: DOMAIN CHECK (KRITISCH: VOR KEYWORDS!)
// =============================================================================

function checkDomain(from) {
  const domain = extractDomain(from).toLowerCase();
  const email = extractEmail(from).toLowerCase();

  // WERBUNG - Bekannte Werbe-Domains
  if (matchesDomain(from, WERBUNG_DOMAINS)) {
    return {
      kategorie: 'werbung',
      confidence: 92,
      gedanken: `"${domain}" ist eine bekannte Werbe-Domain. Keywords wie "letzte Chance" sind Marketing-Tricks.`,
      stufe: 3,
      final: true
    };
  }

  // NEWSLETTER
  if (matchesDomain(from, NEWSLETTER_DOMAINS)) {
    return {
      kategorie: 'newsletter',
      confidence: 90,
      gedanken: `"${domain}" ist ein Newsletter-Absender. Das sind abonnierte Updates.`,
      stufe: 3,
      final: true
    };
  }

  // INFO
  if (matchesDomain(from, INFO_DOMAINS)) {
    return {
      kategorie: 'info',
      confidence: 88,
      gedanken: `"${domain}" ist eine automatische System-Adresse. Das sind Benachrichtigungen.`,
      stufe: 3,
      final: true
    };
  }

  // Prefix-Check (noreply, service, etc.)
  const localPart = email.split('@')[0];
  const infoPrefixes = ['noreply', 'no-reply', 'notification', 'mailer', 'postmaster', 'daemon', 'system', 'notify', 'alerts', 'info'];
  if (infoPrefixes.some(p => localPart.includes(p))) {
    return {
      kategorie: 'info',
      confidence: 85,
      gedanken: `Die E-Mail-Adresse enthält "${localPart}" - das ist typisch für automatische System-Mails.`,
      stufe: 3,
      final: true
    };
  }

  // MIXED - GPT muss entscheiden
  if (matchesDomain(from, MIXED_DOMAINS)) {
    return {
      kategorie: null,
      needsGPT: true,
      reason: 'MIXED_DOMAIN',
      stufe: 3
    };
  }

  // Unbekannt - GPT muss entscheiden
  return {
    kategorie: null,
    needsGPT: true,
    reason: 'UNKNOWN_DOMAIN',
    stufe: 3
  };
}

// =============================================================================
// EIGENE E-MAIL CHECK
// =============================================================================

function isMyOwnEmail(from) {
  const email = extractEmail(from).toLowerCase();
  return MY_EMAILS.some(my => email.includes(my.toLowerCase()));
}

// =============================================================================
// STUFE 6: DRINGLICHKEITS-SIGNALE ERKENNEN
// =============================================================================

function hasDringlichkeitsSignal(subject) {
  for (const [typ, patterns] of Object.entries(DRINGLICHKEIT_SIGNALE)) {
    for (const pattern of patterns) {
      if (pattern.test(subject)) {
        return { hasSignal: true, typ, pattern: pattern.toString() };
      }
    }
  }
  return { hasSignal: false };
}

// =============================================================================
// STUFE 9: ALTERS-LIMIT ANWENDEN
// =============================================================================

function applyAgeLimit(kategorie, emailDate) {
  const age = getAgeInDays(emailDate);

  // Diese Kategorien ignorieren das Alter
  if (['rechnung', 'info', 'newsletter', 'werbung', 'spam', 'termine', 'papierkorb'].includes(kategorie)) {
    return { kategorie, wasLimited: false, ageInDays: age };
  }

  let newKategorie = kategorie;
  let wasLimited = false;

  // ESSENZ
  if (kategorie === 'essenz') {
    if (age > 30) {
      newKategorie = 'veraltet';
      wasLimited = true;
    } else if (age > 14) {
      newKategorie = 'normal';
      wasLimited = true;
    } else if (age > 7) {
      newKategorie = 'wichtig';
      wasLimited = true;
    }
  }

  // WICHTIG
  if (kategorie === 'wichtig') {
    if (age > 30) {
      newKategorie = 'veraltet';
      wasLimited = true;
    } else if (age > 14) {
      newKategorie = 'normal';
      wasLimited = true;
    }
  }

  // NORMAL
  if (kategorie === 'normal') {
    if (age > 30) {
      newKategorie = 'veraltet';
      wasLimited = true;
    }
  }

  if (wasLimited) {
    console.log(`[AGE-LIMIT] ${kategorie} → ${newKategorie} (E-Mail ist ${age} Tage alt)`);
  }

  return {
    kategorie: newKategorie,
    wasLimited,
    originalKategorie: wasLimited ? kategorie : null,
    ageInDays: age
  };
}

// =============================================================================
// GPT PROMPTS
// =============================================================================

const GPT_PROMPT_MIT_INHALT = `
Ein Dringlichkeits-Signal wurde im Betreff erkannt: "{signal}"
ABER: Das bedeutet NICHT automatisch dass es wichtig ist!

ABSENDER: {from}
BETREFF: {subject}
ALTER: {age} Tage
INHALT (erste 300 Zeichen):
{content}

Prüfe GENAU:

1. WER schreibt?
   - Echter Mensch (vorname.nachname@firma.de) → Könnte wichtig sein
   - Service/Marketing (service@firma.de, noreply@...) → Wahrscheinlich automatisch
   - Bekannte Werbe-Firma → WERBUNG

2. WAS steht im INHALT?
   Lies den Inhalt und entscheide:
   - "Hey Roland, ich erreiche dich nicht..." → Echter Mensch wartet = ESSENZ
   - "Rufen Sie unsere Hotline an..." → Marketing = WERBUNG
   - "Letzte Mahnung vor Vollstreckung... 37.500€" → Rechtlich = ESSENZ
   - "Letzte Chance auf 20% Rabatt..." → Marketing = WERBUNG
   - "Ihre Kreditkarte wurde abgelehnt" von Bank → WICHTIG
   - "Ihre Kreditkarte wurde abgelehnt" von Shop → INFO

3. Wartet ein ECHTER MENSCH auf meine Antwort?
   - JA, echter Mensch wartet → ESSENZ
   - JA, aber nur Info/Benachrichtigung → WICHTIG oder INFO
   - NEIN, ist Werbung/Marketing → WERBUNG

DENKE WIE EIN MENSCH! Nicht jedes "bitte anrufen" ist wichtig!

Kategorien:
- essenz: Sofortige Aktion nötig (echter Mensch wartet, Rechtliches, Geld)
- wichtig: Sollte heute gelesen werden
- normal: Kann gelesen werden
- info: Automatische Benachrichtigungen
- newsletter: Abonnierte Updates
- werbung: Marketing, Promotions, Angebote
- spam: Unerwünschte Werbung

Antworte NUR mit JSON:
{
  "kategorie": "...",
  "sicherheit": 0-100,
  "gedanken": "Wer schreibt und was will er wirklich?",
  "echterMenschWartet": true/false
}
`;

const GPT_PROMPT_NUR_HEADER = `
Klassifiziere diese E-Mail:

ABSENDER: {from}
BETREFF: {subject}
ALTER: {age} Tage

Denke wie ein Mensch:
- Ist der Absender eine Firma die mir etwas verkaufen will?
- Oder eine echte Person/Institution?
- Klingt der Betreff nach Marketing oder nach echtem Anliegen?

Kategorien:
- essenz: Sofortige Aktion nötig (echter Mensch wartet, Rechtliches, Geld)
- wichtig: Sollte heute gelesen werden
- normal: Kann gelesen werden
- info: Automatische Benachrichtigungen
- newsletter: Abonnierte Updates
- werbung: Marketing, Promotions
- spam: Unerwünschte Werbung

Antworte NUR mit JSON:
{
  "kategorie": "...",
  "sicherheit": 0-100,
  "gedanken": "Kurze Begründung"
}
`;

// =============================================================================
// IMPROVED CLASSIFIER CLASS
// =============================================================================

class ImprovedClassifier {
  constructor() {
    this.senderHistoryStore = new Store({ name: 'sender-history' });
  }

  /**
   * Haupt-Klassifizierungsfunktion v3
   * REIHENFOLGE: Rechnung → Termin → Domain → Alter → Historie → Signal → GPT → Alters-Limit
   */
  klassifiziere(email) {
    const subject = email.subject || '';
    const fromAddress = email.from?.address || email.from || '';
    const fromName = email.from?.name || '';
    const emailDate = email.date;
    const fromDomain = extractDomain(fromAddress);
    const age = getAgeInDays(emailDate);
    const content = (email.text || email.html || '').substring(0, 300);

    console.log(`[CLASSIFY] === E-Mail: ${subject.substring(0, 50)}... ===`);
    console.log(`[CLASSIFY] Absender: ${fromAddress}`);
    console.log(`[CLASSIFY] Alter: ${age} Tage`);

    // ========== STUFE 1: RECHNUNG (VOR Alter-Check!) ==========
    console.log(`[CLASSIFY] Stufe 1 (Rechnung): ${isRechnung(subject)}`);
    if (isRechnung(subject)) {
      console.log(`[CLASSIFY] → RECHNUNG (Stufe 1)`);
      return {
        kategorie: 'rechnung',
        confidence: 95,
        gedanken: `Rechnung erkannt im Betreff. Rechnungen werden unabhängig vom Alter gespeichert.`,
        stufe: 1,
        schnell: true,
        final: true
      };
    }

    // ========== STUFE 2: TERMIN (eigene Datum-Logik!) ==========
    const terminCheck = isTermin(email, fromDomain, subject);
    console.log(`[CLASSIFY] Stufe 2 (Termin): ${terminCheck}`);
    if (terminCheck) {
      const terminResult = handleTermin(email);
      console.log(`[CLASSIFY] → ${terminResult.kategorie} (Stufe 2 - Termin)`);
      return terminResult;
    }

    // ========== STUFE 3: BEKANNTE DOMAINS (VOR Keywords!) ==========
    const domainResult = checkDomain(fromAddress);
    console.log(`[CLASSIFY] Stufe 3 (Domain): ${JSON.stringify(domainResult)}`);
    if (domainResult.final) {
      console.log(`[CLASSIFY] → ${domainResult.kategorie} (Stufe 3 - Domain)`);
      return domainResult;
    }

    // ========== EIGENE E-MAIL CHECK ==========
    if (isMyOwnEmail(fromAddress)) {
      console.log(`[CLASSIFY] → SPAM (Eigene Test-Mail)`);
      return {
        kategorie: 'spam',
        confidence: 100,
        gedanken: 'Eigene Test-Mail erkannt.',
        stufe: 3,
        schnell: true,
        final: true
      };
    }

    // ========== STUFE 4: ALTER > 90 Tage = ARCHIV ==========
    if (age > AGE_LIMITS.ARCHIV) {
      console.log(`[CLASSIFY] → INFO/ARCHIV (> 90 Tage alt)`);
      return {
        kategorie: 'info',
        confidence: 100,
        gedanken: `Diese E-Mail ist ${age} Tage alt (über 3 Monate). Wenn sie wichtig gewesen wäre, hätte sich das längst geklärt.`,
        stufe: 4,
        schnell: true,
        wasArchived: true
      };
    }

    // ========== STUFE 5: ABSENDER-HISTORIE ==========
    const senderHistory = this.getSenderHistory(fromAddress);
    if (senderHistory) {
      // Wenn Absender immer Werbung/Newsletter ist
      if (senderHistory.categories?.werbung > 5 && senderHistory.urgencyScore < 30) {
        console.log(`[CLASSIFY] → WERBUNG (Stufe 5 - Historie: bekannte Werbung)`);
        return {
          kategorie: 'werbung',
          confidence: 88,
          gedanken: `Absender "${fromAddress}" hat in der Vergangenheit hauptsächlich Werbung gesendet.`,
          stufe: 5,
          schnell: true
        };
      }

      // Wenn Absender oft wichtig ist → genauer prüfen mit GPT
      if (senderHistory.urgencyScore > 75) {
        console.log(`[CLASSIFY] Absender ${fromAddress} hat hohen Urgency-Score: ${senderHistory.urgencyScore} → GPT`);
      }
    }

    // ========== STUFE 6: DRINGLICHKEITS-SIGNALE ERKENNEN ==========
    const signalResult = hasDringlichkeitsSignal(subject);
    console.log(`[CLASSIFY] Stufe 6 (Signal): ${JSON.stringify(signalResult)}`);

    // ========== STUFE 7/8: GPT ENTSCHEIDUNG ==========
    // Hier geben wir die Info zurück, dass GPT gebraucht wird
    if (signalResult.hasSignal) {
      // Signal gefunden → GPT mit Inhalt
      console.log(`[CLASSIFY] Signal gefunden: ${signalResult.typ} → GPT muss mit Inhalt entscheiden`);
      return {
        kategorie: null,
        needsGPT: true,
        gptMode: 'WITH_CONTENT',
        signal: signalResult,
        prompt: GPT_PROMPT_MIT_INHALT
          .replace('{signal}', signalResult.pattern)
          .replace('{from}', fromAddress)
          .replace('{subject}', subject)
          .replace('{age}', age)
          .replace('{content}', content),
        stufe: 7
      };
    }

    // Kein Signal → GPT nur mit Header
    console.log(`[CLASSIFY] Kein Signal → GPT muss nur mit Header entscheiden`);
    return {
      kategorie: null,
      needsGPT: true,
      gptMode: 'HEADER_ONLY',
      prompt: GPT_PROMPT_NUR_HEADER
        .replace('{from}', fromAddress)
        .replace('{subject}', subject)
        .replace('{age}', age),
      stufe: 8
    };
  }

  /**
   * Wendet Alters-Limit auf GPT-Ergebnis an (STUFE 9)
   */
  applyAgeLimitToResult(result, emailDate) {
    const ageResult = applyAgeLimit(result.kategorie, emailDate);

    if (ageResult.wasLimited) {
      console.log(`[CLASSIFY] Stufe 9: Alters-Limit angewendet: ${result.kategorie} → ${ageResult.kategorie}`);
    }

    return {
      ...result,
      kategorie: ageResult.kategorie,
      originalKategorie: ageResult.wasLimited ? result.kategorie : null,
      wasLimited: ageResult.wasLimited,
      ageInDays: ageResult.ageInDays
    };
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
      sender.lastCategory = kategorie;

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
   * GPT Prompt für Klassifizierung mit Inhalt
   */
  getGPTPromptWithContent() {
    return GPT_PROMPT_MIT_INHALT;
  }

  /**
   * GPT Prompt für Klassifizierung nur mit Header
   */
  getGPTPromptHeaderOnly() {
    return GPT_PROMPT_NUR_HEADER;
  }
}

module.exports = {
  ImprovedClassifier,
  getAgeInDays,
  applyAgeLimit,
  AGE_LIMITS,
  RECHNUNG_PATTERNS,
  TERMIN_PATTERNS,
  TERMIN_DOMAINS,
  WERBUNG_DOMAINS,
  NEWSLETTER_DOMAINS,
  INFO_DOMAINS,
  MIXED_DOMAINS,
  MY_EMAILS,
  DRINGLICHKEIT_SIGNALE,
  isRechnung,
  isTermin,
  handleTermin,
  checkDomain,
  isMyOwnEmail,
  hasDringlichkeitsSignal,
  extractDomain,
  extractEmail,
  GPT_PROMPT_MIT_INHALT,
  GPT_PROMPT_NUR_HEADER
};
