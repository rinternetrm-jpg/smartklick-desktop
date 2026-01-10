/**
 * E-Mail-Klassifizierungssystem v4.0 - LOGIK STATT REGELN
 *
 * PHILOSOPHIE: GPT entscheidet mit VERSTAND, nicht mit Keyword-Listen!
 *
 * NUR DIESE REGELN BLEIBEN (weil zu kritisch):
 * 1. RECHNUNG → direkt (Rechnungen sind immer wichtig)
 * 2. TERMIN → direkt (Kalender-Logik)
 * 3. DRINGLICHKEIT → direkt ESSENZ/WICHTIG (Vollstreckung, Mahnung, Inkasso)
 * 4. EIGENE EMAIL → PAPIERKORB
 * 5. ALTER > 90 Tage → PAPIERKORB
 * 6. ALTER > 30 Tage → PAPIERKORB
 *
 * ALLES ANDERE → GPT analysiert mit Logik:
 * - GPT erkennt Marketing-Sprache, Emojis, Newsletter
 * - GPT unterscheidet echte INFO von Werbung
 * - GPT braucht keine Domain/Keyword-Listen
 * - GPT denkt: "Ist das Werbung oder echte Info?"
 *
 * WICHTIGE REGEL FÜR GPT:
 * Im Zweifel = WERBUNG (die meisten Firmen-Mails sind Marketing)
 */

const Store = require('electron-store');

// =============================================================================
// ALTERS-KONSTANTEN
// =============================================================================

const AGE_LIMITS = {
  ARCHIV: 90,      // > 90 Tage: PAPIERKORB
  VERALTET: 30,    // > 30 Tage: Max. VERALTET
  INFO_MAX: 7,     // > 7 Tage: INFO → PAPIERKORB
  ALT: 14,         // > 14 Tage: Max. NORMAL
  AKTUELL: 7       // > 7 Tage: Max. WICHTIG
};

// =============================================================================
// STUFE 1: RECHNUNG PATTERNS (erweitert)
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
  /ihre.*ionos.*rechnung/i,
  // NEU: Kontoauszüge und Downloads
  /monatsauszug/i,
  /kontoauszug/i,
  /zum\s*abruf\s*bereit/i,
  /auszug.*bereit/i,
  /dokument.*abruf/i,
  /download.*bereit/i,
  /ihr.*auszug/i,
  /monatliche.*abrechnung/i
];

// =============================================================================
// STUFE 2: TERMIN PATTERNS & DOMAINS
// =============================================================================

const TERMIN_PATTERNS = [
  // Meeting mit Namen = IMMER Termin!
  /^meeting\s+\w+/i,           // "Meeting Roland", "Meeting Michael"
  /meeting\s+mit\s+/i,         // "Meeting mit Roland"
  /meeting\s+&\s+/i,           // "Meeting Roland & Michael"
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
  // Calendar
  /calendar.*invite/i,
  /google.*calendar/i,
  /einladung.*kalender/i,
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
// STUFE 3: DRINGLICHKEITS-SIGNALE (JETZT VOR DOMAINS!)
// =============================================================================

const DRINGLICHKEIT_SIGNALE = {
  RECHTLICH: [
    /vollstreckung/i,
    /letzte\s*mahnung/i,
    /mahnung/i,
    /inkasso/i,
    /incasso/i,                    // Auch englisch/international
    /anwalt/i,
    /gericht/i,
    /klage/i,
    /pfändung/i,
    /mahnbescheid/i,
    /zwangsvollstreckung/i,
    /forderung/i,
    /zahlungsaufforderung/i
  ],

  PERSOENLICH: [
    /bitte\s*(um\s*)?(an)?rufen/i,
    /rückruf/i,
    /ruf.*an/i,
    /melde\s*dich/i,
    /kann\s*dich\s*nicht\s*erreichen/i,
    /dringend/i,
    /urgent/i,
    /wichtig.*antwort/i,
    /antwort.*erforderlich/i
  ],

  FINANZIELL: [
    /fehlgeschlagen/i,
    /abgelehnt/i,
    /gesperrt/i,
    /sperrung/i,
    /kreditkarte.*fehl/i,
    /einzug.*fehl/i,
    /zahlung.*fehl/i,
    /konto.*gesperrt/i,
    /lastschrift.*fehl/i,
    // Kündigung = WICHTIG!
    /kündigung/i,
    /gekündigt/i,
    /bestätigung.*kündigung/i,
    /kündigung.*erforderlich/i
  ],

  FRISTEN: [
    /frist/i,
    /deadline/i,
    /läuft\s*ab/i,
    /endet\s*(heute|morgen)/i,
    /ablauf/i
  ]
};

// WICHTIG: "letzte chance" ist KEIN Dringlichkeits-Signal!
// Das ist fast immer Marketing-Sprache

// Signale die auch im ABSENDER erkannt werden (z.B. incasso@)
const ABSENDER_SIGNALE = [
  /incasso/i,
  /inkasso/i,
  /mahnung/i,
  /anwalt/i,
  /gericht/i,
  /vollstreckung/i
];

// =============================================================================
// STUFE 6: DOMAIN-LISTEN
// =============================================================================

// WERBUNG-Domains - IMMER Werbung
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
  // Reise & Hotels
  'booking.com', 'expedia.', 'trivago.',
  'holidaycheck.', 'tui.com', 'lastminute.',
  'radisson.', 'rewards.radisson', 'hilton.', 'marriott.',
  'opodo.', 'opodoprime.', 'satama.',
  // Sport/Entertainment/Streaming
  'wow.', 'dazn.', 'sky.', 'netflix.', 'waipu.',
  // Software/Tech Marketing
  'elegantthemes.', 'pinegrow.', 'unmeshdinda.',
  'prezi.', 'emclient.', 'neuroflash.', 'mindverse.',
  'vibeventure.', 'jtl-software.', 'shopware.',
  'vuetify.', 'seobility.', 'wpovernight.',
  // Hosting-Werbung (nicht Service-Mails!)
  'ionos-info', 'info.ionos',
  // Kostüme/Party
  'maskworld.', 'funidelia.', 'kostüm',
  // Auto/Reise
  'sixt.', 'miles-and-more.', 'lufthansa.',
  // Sonstige Werbung
  'groupon.', 'mydealz.', 'sparwelt.',
  'check24.', 'verivox.', 'contabo.',
  'tfbank.', 'stage-entertainment.', 'huk24.',
  // Spendenorganisationen (Marketing)
  'funzone', 'elegance', 'unicef', 'wwf',
  'greenpeace', 'amnesty', 'caritas',
  // Labelbox, Product Updates (Marketing)
  'labelbox.', 'giata.'
];

// WERBUNG-Keywords im Betreff - überschreibt alles außer RECHNUNG/TERMIN!
const WERBUNG_KEYWORDS = [
  // Rabatte & Deals
  /\d+%\s*(rabatt|off|sparen)/i,  // "10% Rabatt", "50% off"
  /rabatt/i,                      // Rabatt allgemein
  /\d+\s*€\s*(sparen|rabatt)/i,   // "200 € sparen"
  /bonuspunkte/i,                 // "3.000 Bonuspunkte"
  /aktionscode/i,                 // "8 neue Aktionscodes"
  /gutschein/i,                   // Gutschein
  /angebot/i,                     // "Top-Angebote"
  /sparen\s*sie/i,                // "Sparen Sie"
  /gratis/i,                      // Gratis
  // Sales Events
  /cyber\s*monday/i,              // Cyber Monday
  /black\s*friday/i,              // Black Friday
  /sale\s*(ends|endet)/i,         // "Sale ends"
  /deal/i,                        // "Deal", "Winterdeal"
  /giveaway/i,                    // Giveaway
  /gewinnen/i,                    // "gewinnen", "2x AirPods gewinnen"
  // Dringlichkeit (Marketing-Fake)
  /nur\s*noch\s*\d+\s*stunden/i,  // "Nur noch wenige Stunden"
  /nur\s*heute/i,                 // "Nur heute"
  /letzte\s*chance/i,             // "Letzte Chance" (Marketing!)
  /last\s*chance/i,               // English version
  /ends\s*(today|soon|in)/i,      // "Ends today", "Ends soon"
  /endet\s*(heute|morgen|bald)/i, // "Endet heute"
  /läuft\s*ab/i,                  // "läuft ab" (wenn Marketing-Kontext)
  /jetzt\s*sichern/i,             // "Jetzt sichern"
  /beeil\s*dich/i,                // "Beeil dich!"
  // Personalisierung (Marketing)
  /wir\s*haben\s*sie.*vermisst/i, // "wir haben Sie vermisst"
  /vermisst.*sie/i,               // "vermisst"
  /kennen\s*sie\s*den/i,          // "Kennen Sie den..."
  /exklusiv\s*für\s*sie/i,        // "Exklusiv für Sie"
  /nur\s*für\s*member/i,          // "Nur für Member"
  /ihr.*geschenk/i,               // "Ihr Geschenk wartet"
  /warten?\s*auf\s*(sie|dich)/i,  // "wartet auf Sie"
  // Weihnachts-/Advents-Marketing
  /adventszeit/i,                 // "Adventszeit"
  /weihnachts/i,                  // "Weihnachts-Deal"
  /türchen\s*nr/i,                // "Türchen Nr. 11"
  /adventskalender/i,             // Adventskalender
  // Streaming/Entertainment Werbung
  /staffel\s*\d+/i,               // "Staffel 8" (TV-Werbung)
  /kommt\s*snart/i,               // "kommer snart" (Netflix)
  /coming\s*soon/i,               // "coming soon"
  /bundesliga/i,                  // Sport-Werbung
  /derby/i,                       // Sport-Werbung
  // Newsletter/Marketing Sprache
  /introducing/i,                 // "Introducing..."
  /sneak\s*peek/i,                // "Sneak Peek"
  /first\s*look/i,                // "First Look"
  /new\s*features/i,              // "New Features"
  /product\s*release/i,           // Product Updates (Marketing)
  /best\s*\w+\s*in\s*\d{4}/i,     // "Best Themes in 2026"
  // Sonstiges
  /kostümideen/i,                 // "Kostümideen für dich"
  /rhythm/i,                      // "Find your winter rhythm"
  /highlights\s*\d{4}/i           // "Highlights 2026"
];

// NEWSLETTER-Domains
const NEWSLETTER_DOMAINS = [
  'newsletter.', 'news.', 'update.', 'digest.',
  'eventim.', 'ticketmaster.', 'eventbrite.',
  'substack.com', 'mailchimp.com', 'sendinblue.',
  'finanzen.net', 'traderfox.',
  'kadewe.', 'breuninger.'
];

// INFO-Domains - NUR echte System-Benachrichtigungen!
// STRENGER: Nur DHL-Tracking, GitHub, etc.
const INFO_DOMAINS = [
  // Versand-Tracking (echte Info!)
  'dhl.de', 'dpd.de', 'ups.com', 'fedex.com',
  'hermes.de', 'gls-group.',
  // Tech-Notifications
  'github.com', 'gitlab.com',
  // Automatische System-Mails
  'daemon.', 'postmaster.', 'mailer-daemon.'
];

// PAPIERKORB-Domains - Direkt in den Papierkorb
const PAPIERKORB_DOMAINS = [
  'sina.', 'spam.', 'junk.', 'bulk.'
];

// PAPIERKORB-Keywords im Betreff
const PAPIERKORB_KEYWORDS = [
  // Spam Reports
  /spambericht/i,                 // "Täglicher Spambericht"
  /spam\s*report/i,               // Spam Report
  /junk\s*mail/i,                 // Junk Mail
  /undelivered/i,                 // Undelivered
  /delivery\s*failed/i,           // Delivery failed
  // WordPress Spam-Kommentare
  /bitte\s*moderiere.*hello\s*world/i,  // "[site] Bitte moderiere: „Hello world!""
  /please\s*moderate.*hello\s*world/i,  // English version
  /\[.*\]\s*bitte\s*moderiere/i,  // "[sitename] Bitte moderiere: ..."
  /hello\s*world/i                // "Hello world!" allgemein (fast immer Spam)
];

// MIXED-Domains - GPT muss entscheiden
const MIXED_DOMAINS = [
  'ionos.de', '1und1.de', '1and1.', 'hosteurope.de',
  'strato.', 'hetzner.',
  'wise.com', 'paypal.com', 'stripe.com',
  'sparkasse.', 'volksbank.', 'commerzbank.',
  'postbank.', 'ing.', 'dkb.',
  'linkedin.com', 'xing.com',
  'google.com'
];

// Eigene E-Mail-Adressen
const MY_EMAILS = [
  'r.internet.rm@gmail.com',
  'roland@romuswiss.ch',
  'r.mueller@siteschrift.de'
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
// WERBUNG & PAPIERKORB KEYWORD CHECKS
// =============================================================================

function isWerbungKeyword(subject) {
  return matchesPatterns(subject, WERBUNG_KEYWORDS);
}

function isPapierkorbKeyword(subject) {
  return matchesPatterns(subject, PAPIERKORB_KEYWORDS);
}

/**
 * Erkennt Emoji-Spam in Betreffzeilen
 * Viele Emojis = Marketing-Mail
 */
function hasExcessiveEmojis(subject) {
  if (!subject) return false;
  // Emoji-Regex für die meisten Unicode-Emojis
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;
  const emojis = subject.match(emojiRegex) || [];
  // 2+ Emojis = Marketing
  return emojis.length >= 2;
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
  if (TERMIN_DOMAINS.some(d => fromDomain.includes(d))) {
    return true;
  }
  return matchesPatterns(subject, TERMIN_PATTERNS);
}

function extractTerminDate(subject, body) {
  const text = `${subject} ${body || ''}`;

  const germanDate = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (germanDate) {
    const [, day, month, year] = germanDate;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

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
      return {
        kategorie: 'termine',
        confidence: 95,
        gedanken: `Termin-Einladung. Der Termin ist am ${terminDatum.toLocaleDateString('de-DE')}.`,
        stufe: 2,
        terminDatum: terminDatum,
        final: true
      };
    }

    if (diffDays >= -1) {
      return {
        kategorie: 'termine',
        confidence: 92,
        gedanken: `ACHTUNG: Der Termin war gestern! Möglicherweise verpasst.`,
        stufe: 2,
        terminDatum: terminDatum,
        warnung: 'Dieser Termin war gestern!',
        final: true
      };
    }

    // Termin vorbei → PAPIERKORB
    return {
      kategorie: 'papierkorb',
      confidence: 90,
      gedanken: `Termin (${terminDatum.toLocaleDateString('de-DE')}) ist vorbei.`,
      stufe: 2,
      final: true
    };
  }

  // Kein Datum gefunden
  if (emailAge <= 7) {
    return {
      kategorie: 'termine',
      confidence: 85,
      gedanken: `Termin-Einladung, ${emailAge} Tage alt.`,
      stufe: 2,
      final: true
    };
  }

  // > 7 Tage alt ohne Datum → PAPIERKORB
  return {
    kategorie: 'papierkorb',
    confidence: 80,
    gedanken: `Alte Termin-Mail (${emailAge} Tage) ohne Datum.`,
    stufe: 2,
    final: true
  };
}

// =============================================================================
// STUFE 3: DRINGLICHKEITS-SIGNALE (KRITISCH: VOR DOMAINS!)
// =============================================================================

function hasDringlichkeitsSignal(subject, fromAddress = '') {
  // 1. Prüfe Betreff
  for (const [typ, patterns] of Object.entries(DRINGLICHKEIT_SIGNALE)) {
    for (const pattern of patterns) {
      if (pattern.test(subject)) {
        return { hasSignal: true, typ, pattern: pattern.toString(), source: 'subject' };
      }
    }
  }

  // 2. Prüfe Absender-Adresse (z.B. incasso@cornercard.ch)
  if (fromAddress) {
    for (const pattern of ABSENDER_SIGNALE) {
      if (pattern.test(fromAddress)) {
        return { hasSignal: true, typ: 'RECHTLICH', pattern: pattern.toString(), source: 'sender' };
      }
    }
  }

  return { hasSignal: false };
}

// =============================================================================
// STUFE 6/7: DOMAIN CHECK
// =============================================================================

function checkDomain(from, age) {
  const domain = extractDomain(from).toLowerCase();
  const email = extractEmail(from).toLowerCase();

  // PAPIERKORB-Domains
  if (matchesDomain(from, PAPIERKORB_DOMAINS)) {
    return {
      kategorie: 'papierkorb',
      confidence: 95,
      gedanken: `"${domain}" gehört in den Papierkorb.`,
      stufe: 6,
      final: true
    };
  }

  // WERBUNG
  if (matchesDomain(from, WERBUNG_DOMAINS)) {
    return {
      kategorie: 'werbung',
      confidence: 92,
      gedanken: `"${domain}" ist Werbung.`,
      stufe: 6,
      final: true
    };
  }

  // NEWSLETTER
  if (matchesDomain(from, NEWSLETTER_DOMAINS)) {
    return {
      kategorie: 'newsletter',
      confidence: 90,
      gedanken: `"${domain}" ist ein Newsletter.`,
      stufe: 6,
      final: true
    };
  }

  // INFO - NUR wenn < 7 Tage alt!
  if (matchesDomain(from, INFO_DOMAINS)) {
    if (age > AGE_LIMITS.INFO_MAX) {
      return {
        kategorie: 'papierkorb',
        confidence: 88,
        gedanken: `Info von "${domain}" ist ${age} Tage alt → Papierkorb.`,
        stufe: 7,
        final: true
      };
    }
    return {
      kategorie: 'info',
      confidence: 88,
      gedanken: `Aktuelle System-Benachrichtigung von "${domain}".`,
      stufe: 7,
      final: true
    };
  }

  // Prefix-Check - STRENGER!
  // NUR echte System-Prefixe, NICHT "info@"!
  const localPart = email.split('@')[0];
  const systemPrefixes = ['noreply', 'no-reply', 'mailer-daemon', 'postmaster', 'daemon'];
  if (systemPrefixes.some(p => localPart === p || localPart.startsWith(p + '.'))) {
    if (age > AGE_LIMITS.INFO_MAX) {
      return {
        kategorie: 'papierkorb',
        confidence: 85,
        gedanken: `System-Mail "${localPart}@..." ist ${age} Tage alt → Papierkorb.`,
        stufe: 7,
        final: true
      };
    }
    return {
      kategorie: 'info',
      confidence: 85,
      gedanken: `System-Mail von "${localPart}@...".`,
      stufe: 7,
      final: true
    };
  }

  // MIXED - GPT entscheidet
  if (matchesDomain(from, MIXED_DOMAINS)) {
    return {
      kategorie: null,
      needsGPT: true,
      reason: 'MIXED_DOMAIN',
      stufe: 6
    };
  }

  // Unbekannt - GPT entscheidet
  return {
    kategorie: null,
    needsGPT: true,
    reason: 'UNKNOWN_DOMAIN',
    stufe: 6
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
// STUFE 10: ALTERS-LIMIT ANWENDEN
// =============================================================================

function applyAgeLimit(kategorie, emailDate) {
  const age = getAgeInDays(emailDate);

  // Diese Kategorien ignorieren das Alter
  if (['rechnung', 'werbung', 'newsletter', 'termine', 'papierkorb'].includes(kategorie)) {
    return { kategorie, wasLimited: false, ageInDays: age };
  }

  // INFO älter als 7 Tage → PAPIERKORB
  if (kategorie === 'info' && age > AGE_LIMITS.INFO_MAX) {
    return {
      kategorie: 'papierkorb',
      wasLimited: true,
      originalKategorie: 'info',
      ageInDays: age
    };
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
    console.log(`[AGE-LIMIT] ${kategorie} → ${newKategorie} (${age} Tage alt)`);
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
DRINGLICHKEITS-SIGNAL IM BETREFF: "{signal}"

ABSENDER: {from}
BETREFF: {subject}
ALTER: {age} Tage
INHALT (erste 300 Zeichen):
{content}

PRÜFE GENAU - WER schreibt wirklich?

1. Echter Mensch (vorname.nachname@firma.de)?
   - "Hey, ich erreiche dich nicht..." → ESSENZ
   - Wartet auf meine Antwort? → ESSENZ

2. Rechtlich/Finanziell ernst?
   - Echte Mahnung mit Betrag? → ESSENZ
   - Inkasso/Anwalt? → ESSENZ
   - Bank meldet Problem? → WICHTIG

3. Oder doch nur Marketing?
   - "Letzte Chance auf Rabatt" → WERBUNG
   - "Rufen Sie unsere Hotline an" → WERBUNG/INFO
   - Automatische Benachrichtigung → INFO

Kategorien:
- essenz: Echter Mensch wartet, Rechtliches, echte Geldprobleme
- wichtig: Sollte heute gelesen werden
- normal: Kann gelesen werden
- info: Echte System-Benachrichtigung (max 7 Tage relevant!)
- newsletter: Abonnierte Updates
- werbung: Marketing
- papierkorb: Irrelevant, alt, Müll

JSON Antwort:
{
  "kategorie": "...",
  "sicherheit": 0-100,
  "gedanken": "Kurze Begründung"
}
`;

const GPT_PROMPT_NUR_HEADER = `
ABSENDER: {from}
BETREFF: {subject}
ALTER: {age} Tage

Wer schreibt - Mensch oder Maschine?
- Echter Mensch mit echtem Anliegen?
- Oder Marketing/Automatik?

Kategorien:
- essenz: Echter Mensch wartet, dringend
- wichtig: Sollte heute gelesen werden
- normal: Kann gelesen werden
- info: System-Benachrichtigung (nur wenn aktuell!)
- newsletter: Abonnierte Updates
- werbung: Marketing
- papierkorb: Irrelevant

JSON:
{
  "kategorie": "...",
  "sicherheit": 0-100,
  "gedanken": "Begründung"
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
   * Haupt-Klassifizierungsfunktion v3.1
   *
   * KRITISCHER FIX: Signal-Check jetzt VOR Domain-Check!
   * "Vollstreckung" = IMMER wichtig, egal von welcher Domain!
   */
  klassifiziere(email) {
    const subject = email.subject || '';
    const fromAddress = email.from?.address || email.from || '';
    const emailDate = email.date;
    const fromDomain = extractDomain(fromAddress);
    const age = getAgeInDays(emailDate);
    const content = (email.text || email.html || '').substring(0, 300);

    console.log(`[CLASSIFY] === ${subject.substring(0, 50)}... ===`);
    console.log(`[CLASSIFY] Von: ${fromAddress}, Alter: ${age} Tage`);

    // ========== STUFE 1: RECHNUNG ==========
    if (isRechnung(subject)) {
      console.log(`[CLASSIFY] → RECHNUNG (Stufe 1)`);
      return {
        kategorie: 'rechnung',
        confidence: 95,
        gedanken: `Rechnung/Auszug erkannt.`,
        stufe: 1,
        schnell: true,
        final: true
      };
    }

    // ========== STUFE 2: TERMIN ==========
    if (isTermin(email, fromDomain, subject)) {
      const result = handleTermin(email);
      console.log(`[CLASSIFY] → ${result.kategorie} (Stufe 2 - Termin)`);
      return result;
    }

    // ========== STUFE 3: DRINGLICHKEITS-SIGNALE (VOR DOMAINS!) ==========
    // KRITISCH: Bei Signalen DIREKT klassifizieren, nicht GPT fragen!
    const signalResult = hasDringlichkeitsSignal(subject, fromAddress);
    if (signalResult.hasSignal) {
      // RECHTLICH oder PERSOENLICH = ESSENZ (wenn < 14 Tage alt)
      if (signalResult.typ === 'RECHTLICH' || signalResult.typ === 'PERSOENLICH') {
        const kategorie = age <= 14 ? 'essenz' : (age <= 30 ? 'wichtig' : 'normal');
        console.log(`[CLASSIFY] ⚠️ SIGNAL RECHTLICH/PERSOENLICH → ${kategorie.toUpperCase()}`);
        return {
          kategorie: kategorie,
          confidence: 95,
          gedanken: `DRINGEND: "${signalResult.pattern}" erkannt (${signalResult.source}). ${age} Tage alt.`,
          stufe: 3,
          schnell: true,
          final: true,
          signal: signalResult
        };
      }

      // FINANZIELL oder FRISTEN = WICHTIG (wenn < 14 Tage alt)
      if (signalResult.typ === 'FINANZIELL' || signalResult.typ === 'FRISTEN') {
        const kategorie = age <= 14 ? 'wichtig' : (age <= 30 ? 'normal' : 'veraltet');
        console.log(`[CLASSIFY] ⚠️ SIGNAL FINANZIELL/FRISTEN → ${kategorie.toUpperCase()}`);
        return {
          kategorie: kategorie,
          confidence: 92,
          gedanken: `WICHTIG: "${signalResult.pattern}" erkannt (${signalResult.source}). ${age} Tage alt.`,
          stufe: 3,
          schnell: true,
          final: true,
          signal: signalResult
        };
      }
    }

    // ========== STUFE 4: EIGENE EMAIL ==========
    if (isMyOwnEmail(fromAddress)) {
      console.log(`[CLASSIFY] → PAPIERKORB (eigene Test-Mail)`);
      return {
        kategorie: 'papierkorb',
        confidence: 100,
        gedanken: 'Eigene Test-Mail.',
        stufe: 4,
        schnell: true,
        final: true
      };
    }

    // ========== STUFE 5: ALTER > 90 Tage ==========
    if (age > AGE_LIMITS.ARCHIV) {
      console.log(`[CLASSIFY] → PAPIERKORB (${age} Tage alt - ARCHIV)`);
      return {
        kategorie: 'papierkorb',
        confidence: 100,
        gedanken: `E-Mail ist ${age} Tage alt - Archiv.`,
        stufe: 5,
        schnell: true,
        final: true
      };
    }

    // ========== STUFE 6: ALTER > 30 Tage → PAPIERKORB ==========
    if (age > AGE_LIMITS.VERALTET) {
      console.log(`[CLASSIFY] → PAPIERKORB (${age} Tage alt - VERALTET)`);
      return {
        kategorie: 'papierkorb',
        confidence: 90,
        gedanken: `E-Mail ist ${age} Tage alt - veraltet.`,
        stufe: 7,
        schnell: true,
        final: true
      };
    }

    // ========== STUFE 7: WEITER ZU GPT (Stufe 1/2) ==========
    // Kein Match in Stufe 0-6 → null zurückgeben damit GPT gefragt wird
    console.log(`[CLASSIFY] → Keine Regel matched, weiter zu GPT`);

    // WICHTIG: null zurückgeben, NICHT ein Objekt!
    // Sonst wird alles auf "info" gesetzt weil kategorie: null || 'info' = 'info'
    return null;
  }

  /**
   * STUFE 10: Alters-Limit auf GPT-Ergebnis anwenden
   */
  applyAgeLimitToResult(result, emailDate) {
    const ageResult = applyAgeLimit(result.kategorie, emailDate);

    if (ageResult.wasLimited) {
      console.log(`[CLASSIFY] Stufe 10: ${result.kategorie} → ${ageResult.kategorie}`);
    }

    return {
      ...result,
      kategorie: ageResult.kategorie,
      originalKategorie: ageResult.wasLimited ? result.kategorie : null,
      wasLimited: ageResult.wasLimited,
      ageInDays: ageResult.ageInDays
    };
  }

  getSenderHistory(email) {
    try {
      return this.senderHistoryStore.get(`senders.${email.replace(/\./g, '_')}`);
    } catch (e) {
      return null;
    }
  }

  updateSenderHistory(email, subject, kategorie) {
    try {
      const key = `senders.${email.replace(/\./g, '_')}`;
      let sender = this.senderHistoryStore.get(key) || {
        email: email,
        totalEmails: 0,
        categories: {},
        recentSubjects: []
      };

      sender.totalEmails++;
      sender.categories[kategorie] = (sender.categories[kategorie] || 0) + 1;
      sender.lastEmailDate = new Date().toISOString();
      sender.lastCategory = kategorie;

      sender.recentSubjects.unshift({
        subject: subject.substring(0, 100),
        date: new Date().toISOString(),
        kategorie
      });
      sender.recentSubjects = sender.recentSubjects.slice(0, 10);

      sender.urgencyScore = this.calculateUrgencyScore(sender);

      this.senderHistoryStore.set(key, sender);
      return sender;
    } catch (e) {
      console.error('[SENDER-HISTORY] Error:', e);
      return null;
    }
  }

  calculateUrgencyScore(sender) {
    let score = 50;

    const subjectCounts = {};
    sender.recentSubjects.forEach(s => {
      const key = s.subject.toLowerCase().substring(0, 50);
      subjectCounts[key] = (subjectCounts[key] || 0) + 1;
    });
    const maxRepeats = Math.max(...Object.values(subjectCounts), 0);
    if (maxRepeats >= 4) score += 35;
    else if (maxRepeats >= 3) score += 25;
    else if (maxRepeats >= 2) score += 15;

    const wichtig = (sender.categories.essenz || 0) + (sender.categories.wichtig || 0);
    const ratio = wichtig / Math.max(sender.totalEmails, 1);
    score += ratio * 30;

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCount = sender.recentSubjects.filter(s => new Date(s.date) > oneWeekAgo).length;
    if (recentCount >= 4) score += 20;
    else if (recentCount >= 2) score += 10;

    return Math.min(Math.round(score), 100);
  }

  getGPTPromptWithContent() {
    return GPT_PROMPT_MIT_INHALT;
  }

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
  PAPIERKORB_DOMAINS,
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
