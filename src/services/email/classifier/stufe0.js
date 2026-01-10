/**
 * STUFE 0: Domain-basierte Vorklassifizierung (KEIN GPT!)
 *
 * Schnelle Klassifizierung basierend auf Absender-Domain.
 * Spart GPT-Kosten für offensichtliche Spam/Newsletter/Info.
 */

class Stufe0Classifier {
  constructor() {
    // Meine eigenen E-Mail-Adressen (Tests!)
    this.meineEmails = [
      'r.internet.rm@gmail.com',
      'roland@romuswiss.ch'
    ];

    // Domain-Patterns für sofortige Klassifizierung
    this.domainRules = {
      // SPAM/WERBUNG - Shops & Marketing
      werbung: [
        'mediamarkt.de', 'saturn.de', 'amazon.', 'ebay.',
        'zalando.', 'otto.de', 'lidl.', 'aldi.',
        'marketing.', 'promo.', 'deals.', 'shop.',
        'mail.facebook.com', 'facebookmail.com',
        'linkedin.com', 'twitter.com', 'instagram.com',
        'pinterest.com', 'tiktok.com'
      ],

      // NEWSLETTER
      newsletter: [
        'newsletter.', 'news.', 'update.', 'digest.',
        'eventim.', 'ticketmaster.', 'eventbrite.',
        'substack.com', 'mailchimp.com', 'sendinblue.'
      ],

      // INFO - System/Automatisch
      info: [
        'noreply.', 'no-reply.', 'noreply@', 'no-reply@',
        'notification.', 'notifications.', 'notify.',
        'mailer.', 'postmaster.', 'daemon.',
        'google.com', 'github.com', 'gitlab.com',
        'wordpress.', 'ionos.', 'hostpoint.',
        'paypal.', 'stripe.', 'klarna.',
        'dhl.', 'dpd.', 'ups.', 'fedex.', 'post.ch'
      ],

      // SPAM - Verdächtig
      spam: [
        'promo@', 'offer@', 'deals@', 'sale@',
        'winner@', 'prize@', 'lottery@'
      ]
    };
  }

  /**
   * Prüft ob Absender meine eigene E-Mail ist (= Test)
   */
  istMeineEmail(email) {
    const absender = (email.from?.address || '').toLowerCase();
    return this.meineEmails.some(me => absender === me.toLowerCase());
  }

  /**
   * Prüft Domain-Patterns
   */
  matchesDomain(emailAddress, patterns) {
    const addr = emailAddress.toLowerCase();
    return patterns.some(pattern => {
      if (pattern.includes('@')) {
        return addr.startsWith(pattern);
      }
      return addr.includes(pattern);
    });
  }

  /**
   * Stufe 0: Schnelle Domain-Klassifizierung
   * @returns {object|null} Ergebnis wenn erkannt, null wenn GPT nötig
   */
  klassifiziere(email) {
    const absenderEmail = (email.from?.address || '').toLowerCase();
    const absenderName = email.from?.name || '';
    const subject = email.subject || '';

    // SCHRITT 1: Meine eigene E-Mail = Test
    if (this.istMeineEmail(email)) {
      console.log(`[STUFE0] ${subject?.substring(0, 30)}... → TEST (eigene E-Mail) ✓`);
      return {
        kategorie: 'spam', // Tests weg
        confidence: 100,
        gedanken: `Das ist meine eigene E-Mail (${absenderEmail}). Roland schickt sich selbst Test-Mails.`,
        stufe: 0,
        schnell: true
      };
    }

    // SCHRITT 2: Domain-basierte Klassifizierung
    for (const [kategorie, patterns] of Object.entries(this.domainRules)) {
      if (this.matchesDomain(absenderEmail, patterns)) {
        const grund = this.getGrund(kategorie, absenderEmail);
        console.log(`[STUFE0] ${subject?.substring(0, 30)}... → ${kategorie.toUpperCase()} (Domain) ✓`);
        return {
          kategorie,
          confidence: 95,
          gedanken: grund,
          stufe: 0,
          schnell: true
        };
      }
    }

    // SCHRITT 3: Prefix-Check (noreply@, notification@, etc.)
    const prefixes = {
      info: ['noreply', 'no-reply', 'notification', 'notifications', 'mailer', 'postmaster', 'daemon', 'system', 'alert', 'alerts'],
      newsletter: ['newsletter', 'news', 'updates', 'digest', 'weekly', 'monthly'],
      werbung: ['marketing', 'promo', 'promotions', 'sales', 'offers', 'deals']
    };

    const localPart = absenderEmail.split('@')[0];
    for (const [kategorie, prefixList] of Object.entries(prefixes)) {
      if (prefixList.some(p => localPart.includes(p))) {
        console.log(`[STUFE0] ${subject?.substring(0, 30)}... → ${kategorie.toUpperCase()} (Prefix: ${localPart}) ✓`);
        return {
          kategorie,
          confidence: 90,
          gedanken: `Die E-Mail-Adresse "${absenderEmail}" enthält "${localPart}" - das ist typisch für automatische ${kategorie === 'info' ? 'System-Mails' : kategorie === 'newsletter' ? 'Newsletter' : 'Marketing-Mails'}.`,
          stufe: 0,
          schnell: true
        };
      }
    }

    // Nicht erkannt → GPT muss ran
    console.log(`[STUFE0] ${subject?.substring(0, 30)}... → ? (braucht GPT)`);
    return null;
  }

  getGrund(kategorie, email) {
    switch (kategorie) {
      case 'werbung':
        return `"${email}" ist eine bekannte Werbe/Marketing-Adresse. Das sind automatische Werbemails, kein echter Mensch wartet auf Antwort.`;
      case 'newsletter':
        return `"${email}" ist ein Newsletter-Absender. Das sind abonnierte Updates, keine persönliche Kommunikation.`;
      case 'info':
        return `"${email}" ist eine automatische System-Adresse. Das sind Benachrichtigungen, keine Antwort erwartet.`;
      case 'spam':
        return `"${email}" sieht verdächtig aus. Typische Spam/Phishing-Adresse.`;
      default:
        return `Klassifiziert als ${kategorie} basierend auf der Domain.`;
    }
  }
}

module.exports = Stufe0Classifier;
