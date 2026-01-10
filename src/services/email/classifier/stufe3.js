/**
 * STUFE 2: Inhalt-GPT-Analyse (nur bei Unsicherheit)
 *
 * Wird NUR aufgerufen wenn Stufe 1 unsicher war (< 80% Sicherheit).
 * Analysiert die ersten 300 Zeichen + Anhang-Info.
 */

const OpenAI = require('openai');
const Store = require('electron-store');

class Stufe3Classifier {
  constructor() {
    this.store = new Store({ name: 'email-classifier-config' });
    this.feedbackStore = new Store({ name: 'ki-feedback' });
    this.regelnStore = new Store({ name: 'ki-regeln' });
    this.openai = null;
    this.initOpenAI();
  }

  // Lade Regeln für GPT-Prompt
  getRegelnContext() {
    try {
      const regeln = this.regelnStore.get('regeln', []);
      if (regeln.length === 0) return '';

      let context = '\nGELERNTE REGELN:\n';
      regeln.forEach((r, i) => {
        context += `${i + 1}. ${r.text} → ${r.kategorie.toUpperCase()}\n`;
      });
      context += '\nBerücksichtige diese Regeln IMMER bei der Klassifizierung.\n';

      return context;
    } catch (e) {
      return '';
    }
  }

  // Lade Feedback für GPT-Prompt
  getFeedbackContext() {
    try {
      const allFeedback = this.feedbackStore.get('feedbackList', []);

      // Nur negative Feedbacks mit Erklärung
      const relevantFeedback = allFeedback
        .filter(f => f.feedbackType === 'negative' && f.userErklärung)
        .slice(-15) // Letzte 15
        .map(f => {
          if (f.absenderName) {
            return `- "${f.absenderName}" (${f.absenderDomain}): ${f.userErklärung}`;
          } else {
            return `- E-Mails von "${f.absenderDomain}": ${f.userErklärung}`;
          }
        });

      if (relevantFeedback.length === 0) return '';

      return `\nWICHTIG - Das habe ich aus vorherigem Feedback gelernt:\n${relevantFeedback.join('\n')}\n`;
    } catch (e) {
      return '';
    }
  }

  initOpenAI() {
    const apiKey = this.store.get('openaiApiKey') || process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  setApiKey(apiKey) {
    this.store.set('openaiApiKey', apiKey);
    this.openai = new OpenAI({ apiKey });
  }

  // Kürze Text auf max. 300 Zeichen (nur Anfang)
  truncateText(text, maxLength = 300) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // Anhang-Info als String
  getAttachmentInfo(attachments) {
    if (!attachments || attachments.length === 0) return '';
    const names = attachments.map(a => a.filename || a.name || 'Datei').join(', ');
    return `ANHÄNGE: ${attachments.length} (${names})`;
  }

  async klassifiziere(email, stufe1Result) {
    if (!this.openai) {
      console.warn('[STUFE2] OpenAI API Key nicht konfiguriert');
      return {
        ...stufe1Result,
        stufe: 2,
        error: 'API Key fehlt'
      };
    }

    const from = email.from || {};
    const absenderName = from.name || '';
    const absenderEmail = from.address || '';
    const subject = email.subject || '';

    // Nur erste 300 Zeichen vom Inhalt
    const body = this.truncateText(email.text || email.body || '', 300);
    const attachmentInfo = this.getAttachmentInfo(email.attachments);

    // E-Mail Alter berechnen
    const emailDate = email.date ? new Date(email.date) : new Date();
    const ageInDays = Math.floor((new Date() - emailDate) / (1000 * 60 * 60 * 24));
    const dateStr = emailDate.toLocaleDateString('de-DE');

    // Lade vorheriges Feedback und Regeln
    const feedbackContext = this.getFeedbackContext();
    const regelnContext = this.getRegelnContext();

    // STUFE 2: Mit Inhalt (nur wenn Stufe 1 unsicher war)
    const prompt = `Du bist Roland Müller, ein Schweizer Unternehmer. Stufe 1 war UNSICHER - jetzt mit Inhalt analysieren:

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}
INHALT (erste 300 Zeichen): ${body}
${attachmentInfo}
E-MAIL ALTER: ${ageInDays} Tage alt (vom ${dateStr})

WICHTIG - ALTER DER E-MAIL BEACHTEN:
- E-Mail ist ${ageInDays} Tage alt!
- Wenn > 14 Tage: Wahrscheinlich schon erledigt oder eskaliert
- Wenn > 30 Tage: Definitiv nicht mehr "dringend" oder "essenz"
- "Vollstreckung" von vor 3 Wochen ist NICHT mehr ESSENZ!
- "Meeting Roland" von vor 2 Wochen - das Meeting ist vorbei!
- Rechnungen bleiben IMMER "rechnung" unabhängig vom Alter

WICHTIG - ABSENDER-REGELN:
1. E-Mails von "Roland Müller" an mich selbst sind MEIST Tests
2. ABER: Wenn Inhalt "rückruf", "anrufen", "dringend", "erreichen", "bitte", "nicht erreichen" enthält = WICHTIG!
3. Der INHALT überschreibt die Absender-Regel! Jemand der um Rückruf bittet wartet auf mich!
${regelnContext}${feedbackContext}
Frage: Ist das ein echter Mensch der auf MEINE Antwort wartet?

KATEGORIEN:
- essenz = Sofortige Aktion nötig (NUR wenn < 7 Tage alt!)
- wichtig = Sollte heute gelesen werden (NUR wenn < 14 Tage alt!)
- termine = Zoom/Teams/Kalender Einladungen
- rechnung = Rechnungen und Zahlungsbestätigungen (ignoriert Alter)
- normal = Kann gelesen werden
- info = System-Mails, Bestätigungen, automatisch
- werbung = Shops, Social Media, Marketing
- newsletter = Abonnierte Updates
- spam = Phishing, Betrug, Tests

DENKE LAUT: Erkläre ausführlich warum du so entscheidest (inkl. Alter-Bewertung).

JSON: {"kategorie":"...","gedanken":"Ausführliche Begründung inkl. Alter...","sicherheit":0-100}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 250, // Mehr Platz für Gedanken
        temperature: 0.1
      });

      const content = response.choices[0].message.content.trim();

      // Parse JSON
      let jsonStr = content;
      if (content.includes('```')) {
        jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }

      const result = JSON.parse(jsonStr);

      // Felder auslesen
      const kategorie = (result.kategorie || result.kat || 'info').toLowerCase();
      const sicherheit = result.sicherheit || result.confidence || 85;
      const gedanken = result.gedanken || result.grund || '';

      console.log(`[STUFE2] ${email.subject?.substring(0, 30)}... → ${kategorie} (${sicherheit}%) ✓`);
      if (gedanken) {
        console.log(`[STUFE2] Gedanken: ${gedanken.substring(0, 150)}...`);
      }

      return {
        kategorie,
        confidence: Math.max(sicherheit, 75), // Stufe 2 sollte sicher sein
        gedanken,
        stufe: 2
      };

    } catch (error) {
      console.error('[STUFE2] GPT Fehler:', error.message);

      // Fallback: Stufe 1 Ergebnis verwenden
      return {
        ...stufe1Result,
        stufe: 2,
        error: error.message
      };
    }
  }
}

module.exports = Stufe3Classifier;
