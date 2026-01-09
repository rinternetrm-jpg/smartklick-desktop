/**
 * STUFE 1: Lokale Regeln (Sofort, Keine Kosten)
 * Klassifiziert E-Mails anhand von Absender und Betreff ohne GPT
 */

const Store = require('electron-store');

// Absender-Kategorien
const AbsenderKategorien = {
  // VIP - Immer wichtig (ESSENZ)
  vip: {
    domains: [
      'romuswiss.ch'
    ],
    keywords_im_namen: [
      'CEO', 'Chef', 'Geschäftsführer', 'Director', 'Managing',
      'Bank', 'Finanzamt', 'Behörde', 'Gericht', 'Amt',
      'Anwalt', 'Notar', 'Arzt', 'Praxis', 'Klinik',
      'Polizei', 'Steuer', 'Versicherung'
    ]
  },

  // SPAM - Sofort aussortieren
  spam: {
    domains: [
      'marketing.', 'promo.', 'newsletter.',
      'mailchimp.com', 'sendgrid.net', 'mailgun.org',
      'constantcontact.com', 'hubspot.com', 'klaviyo.com',
      'amazonses.com', 'sendpulse.com', 'mailjet.com',
      'sendinblue.com', 'getresponse.com', 'aweber.com'
    ],
    absender_patterns: [
      /^noreply@/i,
      /^no-reply@/i,
      /^newsletter@/i,
      /^marketing@/i,
      /^promo@/i,
      /^info@(?!romuswiss)/i,
      /^support@(?!romuswiss)/i,
      /^team@/i,
      /^hello@/i,
      /^news@/i,
      /^updates@/i,
      /^notifications@/i
    ]
  },

  // GREYLIST - Wahrscheinlich Newsletter/Info
  greylist: {
    domains: [
      'linkedin.com', 'xing.com', 'facebook.com',
      'twitter.com', 'instagram.com', 'youtube.com',
      'github.com', 'gitlab.com', 'bitbucket.org',
      'notion.so', 'slack.com', 'trello.com',
      'dropbox.com', 'google.com', 'microsoft.com',
      'apple.com', 'amazon.com', 'paypal.com'
    ]
  }
};

// Betreff-Regeln
const BetreffRegeln = {
  // ESSENZ - Sofort wichtig
  essenz: {
    keywords: [
      // Dringlichkeit
      'dringend', 'urgent', 'asap', 'sofort', 'wichtig',
      'eilig', 'kritisch', 'notfall', 'emergency', 'priorität',

      // Geld
      'rechnung', 'invoice', 'zahlung', 'payment',
      'mahnung', 'überfällig', 'overdue', 'fällig',
      'überweisung', 'transfer', 'konto', 'bank',

      // Sicherheit
      'sicherheit', 'security', 'warnung', 'warning',
      'verdächtig', 'suspicious', 'unauthorized',
      'passwort', 'password', 'verifizierung', 'verification',

      // Termine
      'termin', 'meeting', 'besprechung', 'call',
      'morgen', 'heute', 'tomorrow', 'today',

      // Arbeit
      'projekt', 'project', 'deadline', 'frist',
      'vertrag', 'contract', 'angebot', 'proposal',
      'unterschrift', 'signature', 'genehmigung', 'approval'
    ],
    patterns: [
      /^re:\s/i,              // Antwort auf deine Mail
      /fwd:.*dringend/i,      // Weiterleitung mit dringend
      /\d{1,2}\.\d{1,2}\.\d{2,4}/, // Datum im Betreff
      /\d{1,2}:\d{2}/,        // Uhrzeit im Betreff
      /bis\s+(zum\s+)?\d{1,2}\./i, // "bis zum 15."
    ]
  },

  // SPAM - Sofort aussortieren
  spam: {
    keywords: [
      // Werbung
      'unsubscribe', 'abmelden', 'abbestellen',
      'newsletter', 'sale', 'rabatt', 'discount',
      'angebot', 'offer', 'deal', 'gutschein', 'coupon',
      'gratis', 'free', 'kostenlos', 'gewinn', 'winner',
      'prize', 'lottery', 'jackpot',

      // Phishing
      'verify your account', 'bestätigen sie',
      'click here', 'klicken sie hier',
      'limited time', 'begrenzte zeit',
      'act now', 'jetzt handeln',
      'suspended', 'gesperrt',

      // Marketing
      'don\'t miss', 'nicht verpassen',
      'exclusive', 'exklusiv',
      'last chance', 'letzte chance',
      'only today', 'nur heute',
      'special offer', 'sonderangebot'
    ],
    patterns: [
      /\$\d+/,                    // Dollarzeichen mit Betrag
      /€\d+/,                     // Euro mit Betrag
      /\d+%\s*(off|rabatt|sparen)/i, // Prozent Rabatt
      /!\s*$/,                    // Endet mit !
      /!!+/,                      // Mehrere !!
      /[A-Z]{5,}/,                // SCHREIEN IN CAPS
      /🎉|🎁|💰|🔥|⚡|💥/,        // Werbe-Emojis
    ]
  },

  // INFO - Automatische Mails
  info: {
    keywords: [
      'bestätigung', 'confirmation', 'confirmed',
      'bestellung', 'order', 'ordered',
      'versand', 'shipping', 'tracking', 'shipped',
      'lieferung', 'delivery', 'delivered',
      'registrierung', 'registration', 'registered',
      'willkommen', 'welcome',
      'update', 'aktualisierung',
      'benachrichtigung', 'notification',
      'summary', 'zusammenfassung',
      'report', 'bericht', 'weekly', 'monthly',
      'receipt', 'quittung', 'beleg'
    ],
    patterns: [
      /order\s*#?\d+/i,
      /bestellung\s*#?\d+/i,
      /tracking\s*#?\d+/i,
      /ticket\s*#?\d+/i,
      /case\s*#?\d+/i,
      /ref[\.\-\s]*#?\d+/i,
    ]
  }
};

class Stufe1Classifier {
  constructor() {
    this.store = new Store({ name: 'email-classifier-config' });
    this.loadCustomRules();
  }

  loadCustomRules() {
    // Lade benutzerdefinierte Whitelist/Blacklist
    this.whitelist = this.store.get('whitelist', []);
    this.blacklist = this.store.get('blacklist', []);
    this.familyList = this.store.get('family', []);
    this.customerList = this.store.get('customers', []);
    this.vipList = this.store.get('vips', []);
  }

  // Absender-Prüfungen
  isVIP(from) {
    const email = from.address?.toLowerCase() || '';
    const name = from.name?.toLowerCase() || '';

    // In VIP-Liste?
    if (this.vipList.some(v => email.includes(v.toLowerCase()))) {
      return true;
    }

    // VIP Domain?
    if (AbsenderKategorien.vip.domains.some(d => email.includes(d))) {
      return true;
    }

    // VIP Keywords im Namen?
    if (AbsenderKategorien.vip.keywords_im_namen.some(k => name.includes(k.toLowerCase()))) {
      return true;
    }

    return false;
  }

  isFamily(from) {
    const email = from.address?.toLowerCase() || '';
    return this.familyList.some(f => email.includes(f.toLowerCase()));
  }

  isCustomer(from) {
    const email = from.address?.toLowerCase() || '';
    return this.customerList.some(c => email.includes(c.toLowerCase()));
  }

  isWhitelisted(from) {
    const email = from.address?.toLowerCase() || '';
    return this.whitelist.some(w => email.includes(w.toLowerCase()));
  }

  isBlacklisted(from) {
    const email = from.address?.toLowerCase() || '';
    return this.blacklist.some(b => email.includes(b.toLowerCase()));
  }

  isSpamDomain(from) {
    const email = from.address?.toLowerCase() || '';
    return AbsenderKategorien.spam.domains.some(d => email.includes(d));
  }

  isNoReply(from) {
    const email = from.address?.toLowerCase() || '';
    return AbsenderKategorien.spam.absender_patterns.some(p => p.test(email));
  }

  isGreylistDomain(from) {
    const email = from.address?.toLowerCase() || '';
    return AbsenderKategorien.greylist.domains.some(d => email.includes(d));
  }

  isDirectRecipient(email) {
    const myEmails = this.store.get('myEmails', []);
    const to = email.to || [];
    return to.some(t => myEmails.some(my => t.address?.toLowerCase().includes(my.toLowerCase())));
  }

  isOnlyCC(email) {
    const myEmails = this.store.get('myEmails', []);
    const to = email.to || [];
    const cc = email.cc || [];

    const inTo = to.some(t => myEmails.some(my => t.address?.toLowerCase().includes(my.toLowerCase())));
    const inCC = cc.some(c => myEmails.some(my => c.address?.toLowerCase().includes(my.toLowerCase())));

    return !inTo && inCC;
  }

  // Betreff-Prüfungen
  matchesEssenzKeywords(subject) {
    const subjectLower = subject.toLowerCase();
    return BetreffRegeln.essenz.keywords.filter(k => subjectLower.includes(k));
  }

  matchesEssenzPatterns(subject) {
    return BetreffRegeln.essenz.patterns.filter(p => p.test(subject));
  }

  matchesSpamKeywords(subject) {
    const subjectLower = subject.toLowerCase();
    return BetreffRegeln.spam.keywords.filter(k => subjectLower.includes(k));
  }

  matchesSpamPatterns(subject) {
    return BetreffRegeln.spam.patterns.filter(p => p.test(subject));
  }

  matchesInfoKeywords(subject) {
    const subjectLower = subject.toLowerCase();
    return BetreffRegeln.info.keywords.filter(k => subjectLower.includes(k));
  }

  matchesInfoPatterns(subject) {
    return BetreffRegeln.info.patterns.filter(p => p.test(subject));
  }

  // Haupt-Scoring-Funktion
  scoreEmail(email) {
    const score = {
      essenz: 0,
      wichtig: 0,
      normal: 0,
      info: 0,
      newsletter: 0,
      spam: 0,
      confidence: 0,
      reasons: []
    };

    const from = email.from || {};
    const subject = email.subject || '';

    // === ABSENDER SCORING ===

    // Blacklist → Sofort Spam
    if (this.isBlacklisted(from)) {
      score.spam += 150;
      score.reasons.push('Blacklist');
    }

    // Whitelist → Wichtig
    if (this.isWhitelisted(from)) {
      score.wichtig += 80;
      score.reasons.push('Whitelist');
    }

    // VIP Absender → +100 Essenz
    if (this.isVIP(from)) {
      score.essenz += 100;
      score.reasons.push('VIP Absender');
    }

    // Familie → +80 Essenz
    if (this.isFamily(from)) {
      score.essenz += 80;
      score.reasons.push('Familie');
    }

    // Kunde → +60 Wichtig
    if (this.isCustomer(from)) {
      score.wichtig += 60;
      score.reasons.push('Kunde');
    }

    // Spam-Domain → +100 Spam
    if (this.isSpamDomain(from)) {
      score.spam += 100;
      score.reasons.push('Spam-Domain');
    }

    // NoReply → +50 Info/Newsletter
    if (this.isNoReply(from)) {
      score.info += 30;
      score.newsletter += 30;
      score.reasons.push('NoReply Absender');
    }

    // Greylist Domain → +30 Info
    if (this.isGreylistDomain(from)) {
      score.info += 30;
      score.reasons.push('Service-Benachrichtigung');
    }

    // === BETREFF SCORING ===

    // Essenz Keywords
    const essenzKeywords = this.matchesEssenzKeywords(subject);
    for (const keyword of essenzKeywords) {
      score.essenz += 30;
      score.reasons.push(`Betreff: "${keyword}"`);
    }

    // Essenz Patterns
    const essenzPatterns = this.matchesEssenzPatterns(subject);
    for (const pattern of essenzPatterns) {
      score.essenz += 25;
      score.reasons.push('Betreff-Muster erkannt');
    }

    // Spam Keywords
    const spamKeywords = this.matchesSpamKeywords(subject);
    for (const keyword of spamKeywords) {
      score.spam += 25;
      score.reasons.push(`Spam-Wort: "${keyword}"`);
    }

    // Spam Patterns
    const spamPatterns = this.matchesSpamPatterns(subject);
    for (const pattern of spamPatterns) {
      score.spam += 20;
      score.reasons.push('Spam-Muster erkannt');
    }

    // Info Keywords
    const infoKeywords = this.matchesInfoKeywords(subject);
    for (const keyword of infoKeywords) {
      score.info += 20;
      score.reasons.push(`Info: "${keyword}"`);
    }

    // Info Patterns
    const infoPatterns = this.matchesInfoPatterns(subject);
    for (const pattern of infoPatterns) {
      score.info += 15;
      score.reasons.push('Info-Muster erkannt');
    }

    // Ist eine Antwort (Re:) → +40 Wichtig
    if (/^re:/i.test(subject)) {
      score.wichtig += 40;
      score.essenz += 20;
      score.reasons.push('Antwort auf deine Mail');
    }

    // Ist Weiterleitung (Fwd:) → +20 Normal
    if (/^fwd:/i.test(subject)) {
      score.normal += 20;
      score.reasons.push('Weiterleitung');
    }

    // === ZUSÄTZLICHE SIGNALE ===

    // Direkt an mich (nicht CC/BCC) → +30 Wichtig
    if (this.isDirectRecipient(email)) {
      score.wichtig += 30;
      score.reasons.push('Direkt adressiert');
    }

    // Ich bin nur in CC → -20 Wichtig, +20 Info
    if (this.isOnlyCC(email)) {
      score.wichtig -= 20;
      score.info += 20;
      score.reasons.push('Nur in CC');
    }

    // Anhänge vorhanden → +15 Wichtig
    if (email.attachments?.length > 0) {
      score.wichtig += 15;
      score.reasons.push(`${email.attachments.length} Anhänge`);
    }

    // === CONFIDENCE BERECHNEN ===

    const scores = [
      { cat: 'essenz', val: score.essenz },
      { cat: 'wichtig', val: score.wichtig },
      { cat: 'normal', val: score.normal },
      { cat: 'info', val: score.info },
      { cat: 'newsletter', val: score.newsletter },
      { cat: 'spam', val: score.spam }
    ].sort((a, b) => b.val - a.val);

    const highest = scores[0];
    const secondHighest = scores[1];

    // Confidence = Differenz zwischen Top 2
    if (highest.val > 0) {
      score.confidence = Math.min(100,
        Math.round(((highest.val - secondHighest.val) / highest.val) * 100)
      );
    }

    score.predictedCategory = highest.cat;
    score.allScores = scores;

    return score;
  }

  // Hauptfunktion: Klassifiziere E-Mail
  klassifiziere(email) {
    const score = this.scoreEmail(email);

    // Hohe Confidence (>80%) → Fertig
    if (score.confidence >= 80) {
      return {
        kategorie: score.predictedCategory,
        confidence: score.confidence,
        reasons: score.reasons,
        stufe: 1,
        needsGPT: false,
        scores: score.allScores
      };
    }

    // Klarer Spam (Score > 100) → Fertig
    if (score.spam > 100) {
      return {
        kategorie: 'spam',
        confidence: 95,
        reasons: score.reasons,
        stufe: 1,
        needsGPT: false,
        scores: score.allScores
      };
    }

    // VIP/Familie → Immer Essenz, auch bei niedriger Confidence
    if (score.essenz >= 80) {
      return {
        kategorie: 'essenz',
        confidence: 90,
        reasons: score.reasons,
        stufe: 1,
        needsGPT: false,
        scores: score.allScores
      };
    }

    // Unsicher → Weiter zu Stufe 2
    return {
      kategorie: score.predictedCategory,
      confidence: score.confidence,
      reasons: score.reasons,
      stufe: 1,
      needsGPT: true,
      scores: score.allScores
    };
  }

  // Config-Methoden
  addToWhitelist(email) {
    if (!this.whitelist.includes(email.toLowerCase())) {
      this.whitelist.push(email.toLowerCase());
      this.store.set('whitelist', this.whitelist);
    }
  }

  addToBlacklist(email) {
    if (!this.blacklist.includes(email.toLowerCase())) {
      this.blacklist.push(email.toLowerCase());
      this.store.set('blacklist', this.blacklist);
    }
  }

  addToFamily(email) {
    if (!this.familyList.includes(email.toLowerCase())) {
      this.familyList.push(email.toLowerCase());
      this.store.set('family', this.familyList);
    }
  }

  addToCustomers(email) {
    if (!this.customerList.includes(email.toLowerCase())) {
      this.customerList.push(email.toLowerCase());
      this.store.set('customers', this.customerList);
    }
  }

  addToVIPs(email) {
    if (!this.vipList.includes(email.toLowerCase())) {
      this.vipList.push(email.toLowerCase());
      this.store.set('vips', this.vipList);
    }
  }

  setMyEmails(emails) {
    this.store.set('myEmails', emails.map(e => e.toLowerCase()));
  }
}

module.exports = Stufe1Classifier;
