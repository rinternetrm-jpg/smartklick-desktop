/**
 * STUFE 4: Selbstlernendes System
 * Das System lernt aus dem Benutzerverhalten!
 */

const Store = require('electron-store');

class EmailLearner {
  constructor(stufe1Classifier) {
    this.store = new Store({ name: 'email-learning' });
    this.stufe1 = stufe1Classifier;
    this.initStats();
  }

  initStats() {
    // Initialisiere Statistiken wenn nicht vorhanden
    if (!this.store.has('stats')) {
      this.store.set('stats', {
        totalClassified: 0,
        korrekturen: 0,
        korrekturen_details: [],
        absenderScores: {},
        muster: {},
        lastUpdated: new Date().toISOString()
      });
    }
  }

  // === TRACKING METHODEN ===

  // User verschiebt E-Mail manuell in andere Kategorie
  trackManuelleKorrektur(email, alteKategorie, neueKategorie) {
    const from = email.from || {};
    const absenderEmail = from.address?.toLowerCase() || '';

    console.log(`Lerne: ${absenderEmail} von ${alteKategorie} → ${neueKategorie}`);

    // Speichere Absender-Präferenz
    if (neueKategorie === 'essenz' || neueKategorie === 'wichtig') {
      this.stufe1.addToWhitelist(absenderEmail);
      this.erhöheWichtigkeit(absenderEmail, 50);
    }

    if (neueKategorie === 'spam') {
      this.stufe1.addToBlacklist(absenderEmail);
      this.erhöheSpamScore(absenderEmail, 50);
    }

    // Speichere Betreff-Muster
    if (email.subject) {
      this.speichereMuster(email.subject, neueKategorie);
    }

    // Statistik aktualisieren
    const stats = this.store.get('stats');
    stats.korrekturen++;
    stats.korrekturen_details.push({
      von: alteKategorie,
      zu: neueKategorie,
      absender: absenderEmail,
      betreff: email.subject,
      zeit: new Date().toISOString()
    });

    // Nur letzte 1000 Korrekturen behalten
    if (stats.korrekturen_details.length > 1000) {
      stats.korrekturen_details = stats.korrekturen_details.slice(-1000);
    }

    stats.lastUpdated = new Date().toISOString();
    this.store.set('stats', stats);
  }

  // User öffnet E-Mail
  trackGeöffnet(email) {
    const from = email.from || {};
    const absenderEmail = from.address?.toLowerCase() || '';

    // E-Mails die geöffnet werden sind wichtiger
    this.erhöheWichtigkeit(absenderEmail, 5);
  }

  // User antwortet auf E-Mail
  trackBeantwortet(email) {
    const from = email.from || {};
    const absenderEmail = from.address?.toLowerCase() || '';

    // Absender auf die geantwortet wird sind wichtig
    this.erhöheWichtigkeit(absenderEmail, 20);

    // Nach 3 Antworten → automatisch Whitelist
    const antwortCount = this.getAntwortCount(absenderEmail);
    if (antwortCount >= 3) {
      this.stufe1.addToWhitelist(absenderEmail);
      console.log(`Auto-Whitelist: ${absenderEmail} (${antwortCount} Antworten)`);
    }
  }

  // User löscht ohne zu lesen
  trackGelöschtOhneLesen(email) {
    const from = email.from || {};
    const absenderEmail = from.address?.toLowerCase() || '';

    this.erhöheSpamScore(absenderEmail, 10);

    // Nach 5x löschen → Blacklist
    const löschCount = this.getLöschCount(absenderEmail);
    if (löschCount >= 5) {
      this.stufe1.addToBlacklist(absenderEmail);
      console.log(`Auto-Blacklist: ${absenderEmail} (${löschCount}x gelöscht)`);
    }
  }

  // Klassifizierung erfolgreich abgeschlossen
  trackKlassifizierung(email, result) {
    const stats = this.store.get('stats');
    stats.totalClassified++;
    stats.lastUpdated = new Date().toISOString();
    this.store.set('stats', stats);
  }

  // === SCORE METHODEN ===

  erhöheWichtigkeit(absenderEmail, punkte) {
    if (!absenderEmail) return;

    const scores = this.store.get('stats.absenderScores', {});
    if (!scores[absenderEmail]) {
      scores[absenderEmail] = { wichtigkeit: 0, spam: 0, antworten: 0, gelöscht: 0 };
    }

    scores[absenderEmail].wichtigkeit += punkte;
    scores[absenderEmail].antworten = (scores[absenderEmail].antworten || 0) + 1;
    this.store.set('stats.absenderScores', scores);
  }

  erhöheSpamScore(absenderEmail, punkte) {
    if (!absenderEmail) return;

    const scores = this.store.get('stats.absenderScores', {});
    if (!scores[absenderEmail]) {
      scores[absenderEmail] = { wichtigkeit: 0, spam: 0, antworten: 0, gelöscht: 0 };
    }

    scores[absenderEmail].spam += punkte;
    scores[absenderEmail].gelöscht = (scores[absenderEmail].gelöscht || 0) + 1;
    this.store.set('stats.absenderScores', scores);
  }

  getAntwortCount(absenderEmail) {
    const scores = this.store.get('stats.absenderScores', {});
    return scores[absenderEmail]?.antworten || 0;
  }

  getLöschCount(absenderEmail) {
    const scores = this.store.get('stats.absenderScores', {});
    return scores[absenderEmail]?.gelöscht || 0;
  }

  getAbsenderScore(absenderEmail) {
    const scores = this.store.get('stats.absenderScores', {});
    return scores[absenderEmail] || { wichtigkeit: 0, spam: 0, antworten: 0, gelöscht: 0 };
  }

  // === MUSTER-ERKENNUNG ===

  extrahiereMuster(betreff) {
    const muster = [];

    // Normalisiere Betreff
    const normalized = betreff.toLowerCase()
      .replace(/^(re|fwd|aw|wg):\s*/gi, '')
      .replace(/[^\wäöüß\s]/g, ' ')
      .trim();

    // Einzelne Wörter (>3 Zeichen)
    const wörter = normalized.split(/\s+/).filter(w => w.length > 3);
    muster.push(...wörter);

    // Bigrams (2-Wort-Kombinationen)
    for (let i = 0; i < wörter.length - 1; i++) {
      muster.push(`${wörter[i]} ${wörter[i + 1]}`);
    }

    // Struktur-Muster
    if (/^re:/i.test(betreff)) muster.push('PATTERN:RE');
    if (/^fwd:/i.test(betreff)) muster.push('PATTERN:FWD');
    if (/^aw:/i.test(betreff)) muster.push('PATTERN:AW');
    if (/\d+/.test(betreff)) muster.push('PATTERN:HAS_NUMBER');
    if (/[A-Z]{3,}/.test(betreff)) muster.push('PATTERN:HAS_CAPS');
    if (/!/.test(betreff)) muster.push('PATTERN:HAS_EXCLAMATION');
    if (/\?/.test(betreff)) muster.push('PATTERN:HAS_QUESTION');
    if (/€|\$|CHF/.test(betreff)) muster.push('PATTERN:HAS_CURRENCY');

    return [...new Set(muster)]; // Duplikate entfernen
  }

  speichereMuster(betreff, kategorie) {
    const muster = this.extrahiereMuster(betreff);
    const gespeicherteMuster = this.store.get('stats.muster', {});

    for (const m of muster) {
      if (!gespeicherteMuster[m]) {
        gespeicherteMuster[m] = {};
      }
      gespeicherteMuster[m][kategorie] = (gespeicherteMuster[m][kategorie] || 0) + 1;
    }

    this.store.set('stats.muster', gespeicherteMuster);
  }

  // Berechne Score basierend auf gelernten Mustern
  berechneGelerntenScore(betreff) {
    const muster = this.extrahiereMuster(betreff);
    const gespeicherteMuster = this.store.get('stats.muster', {});
    const scores = {
      essenz: 0,
      wichtig: 0,
      normal: 0,
      info: 0,
      newsletter: 0,
      spam: 0
    };

    for (const m of muster) {
      const stats = gespeicherteMuster[m];
      if (stats) {
        for (const [kat, count] of Object.entries(stats)) {
          if (scores.hasOwnProperty(kat)) {
            scores[kat] += count * 5; // Gewichtung
          }
        }
      }
    }

    return scores;
  }

  // Gelernte Muster auf E-Mail anwenden
  anwendenGelernteRegeln(email) {
    const from = email.from || {};
    const absenderEmail = from.address?.toLowerCase() || '';

    // Absender-Score prüfen
    const absenderScore = this.getAbsenderScore(absenderEmail);

    // Betreff-Muster prüfen
    const betreffScore = email.subject ? this.berechneGelerntenScore(email.subject) : {};

    return {
      absender: absenderScore,
      betreff: betreffScore,
      empfehlung: this.berechneEmpfehlung(absenderScore, betreffScore)
    };
  }

  berechneEmpfehlung(absenderScore, betreffScore) {
    // Kombiniere Absender- und Betreff-Scores
    const combined = {
      essenz: (betreffScore.essenz || 0) + (absenderScore.wichtigkeit > 50 ? 30 : 0),
      wichtig: (betreffScore.wichtig || 0) + (absenderScore.wichtigkeit > 20 ? 20 : 0),
      normal: betreffScore.normal || 0,
      info: betreffScore.info || 0,
      newsletter: betreffScore.newsletter || 0,
      spam: (betreffScore.spam || 0) + (absenderScore.spam > 30 ? 40 : 0)
    };

    // Finde höchsten Score
    let maxKat = 'normal';
    let maxScore = 0;

    for (const [kat, score] of Object.entries(combined)) {
      if (score > maxScore) {
        maxScore = score;
        maxKat = kat;
      }
    }

    return {
      kategorie: maxKat,
      score: maxScore,
      confidence: Math.min(maxScore * 2, 100)
    };
  }

  // === STATISTIK METHODEN ===

  getStats() {
    return this.store.get('stats');
  }

  getLernfortschritt() {
    const stats = this.store.get('stats');
    const muster = this.store.get('stats.muster', {});
    const absenderScores = this.store.get('stats.absenderScores', {});

    return {
      totalClassified: stats.totalClassified,
      korrekturen: stats.korrekturen,
      gelernteAbsender: Object.keys(absenderScores).length,
      gelernteMuster: Object.keys(muster).length,
      whitelist: this.stufe1?.whitelist?.length || 0,
      blacklist: this.stufe1?.blacklist?.length || 0,
      genauigkeit: stats.totalClassified > 0
        ? Math.round(((stats.totalClassified - stats.korrekturen) / stats.totalClassified) * 100)
        : 100,
      lastUpdated: stats.lastUpdated
    };
  }

  // Letzte Korrekturen anzeigen
  getLetzteKorrekturen(limit = 10) {
    const stats = this.store.get('stats');
    return stats.korrekturen_details.slice(-limit).reverse();
  }

  // Top-Muster anzeigen
  getTopMuster(kategorie, limit = 10) {
    const muster = this.store.get('stats.muster', {});
    const kategorieRanking = [];

    for (const [m, stats] of Object.entries(muster)) {
      if (stats[kategorie]) {
        kategorieRanking.push({ muster: m, count: stats[kategorie] });
      }
    }

    return kategorieRanking
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // Daten exportieren
  exportData() {
    return {
      stats: this.store.get('stats'),
      whitelist: this.stufe1?.whitelist || [],
      blacklist: this.stufe1?.blacklist || [],
      family: this.stufe1?.familyList || [],
      customers: this.stufe1?.customerList || [],
      vips: this.stufe1?.vipList || [],
      exportDate: new Date().toISOString()
    };
  }

  // Daten importieren
  importData(data) {
    if (data.stats) {
      this.store.set('stats', data.stats);
    }
    if (data.whitelist && this.stufe1) {
      for (const email of data.whitelist) {
        this.stufe1.addToWhitelist(email);
      }
    }
    if (data.blacklist && this.stufe1) {
      for (const email of data.blacklist) {
        this.stufe1.addToBlacklist(email);
      }
    }
    if (data.family && this.stufe1) {
      for (const email of data.family) {
        this.stufe1.addToFamily(email);
      }
    }
    if (data.customers && this.stufe1) {
      for (const email of data.customers) {
        this.stufe1.addToCustomers(email);
      }
    }
    if (data.vips && this.stufe1) {
      for (const email of data.vips) {
        this.stufe1.addToVIPs(email);
      }
    }
  }

  // Alle Lerndaten zurücksetzen
  reset() {
    this.store.clear();
    this.initStats();
    console.log('Alle Lerndaten zurückgesetzt');
  }
}

module.exports = EmailLearner;
