/**
 * STUFE 3: Volltext-GPT-Analyse (nur bei Unsicherheit)
 *
 * Wird NUR aufgerufen wenn Stufe 2 unsicher war.
 * Analysiert den kompletten E-Mail-Text mit denselben 4 Fragen.
 */

const OpenAI = require('openai');
const Store = require('electron-store');

class Stufe3Classifier {
  constructor() {
    this.store = new Store({ name: 'email-classifier-config' });
    this.openai = null;
    this.initOpenAI();
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

  // Kürze Text auf max. 1000 Zeichen (wichtigste Teile)
  truncateText(text, maxLength = 1000) {
    if (!text || text.length <= maxLength) return text;

    // Nimm Anfang und Ende (oft wichtigste Infos)
    const halfLength = Math.floor(maxLength / 2);
    const start = text.substring(0, halfLength);
    const end = text.substring(text.length - halfLength);

    return start + '\n...[gekürzt]...\n' + end;
  }

  async klassifiziere(email, stufe2Result) {
    if (!this.openai) {
      console.warn('OpenAI API Key nicht konfiguriert');
      return {
        ...stufe2Result,
        stufe: 3,
        error: 'API Key fehlt'
      };
    }

    const from = email.from || {};
    const absenderName = from.name || '';
    const absenderEmail = from.address || '';
    const subject = email.subject || '';
    const body = this.truncateText(email.text || email.body || '');

    const prompt = `Analysiere diese E-Mail mit Volltext.

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}
INHALT: ${body}

SPAM/WERBUNG erkennen:
- "Deals", "Sale", "Knaller", "Rabatt", "% Rabatt" = SPAM
- "Konzert kommt", "Tribute to", Events = NEWSLETTER
- Marketing wie "Kennen Sie...", "Entdecken Sie..." = SPAM
- Eventim, MediaMarkt, 1&1 Marketing, Shops = SPAM/NEWSLETTER

INFO (automatisch, keine Antwort nötig):
- WordPress, IONOS, Hostinger = INFO
- Google/GitHub Sicherheitswarnungen = INFO
- Bestellbestätigungen, Versandstatus = INFO
- noreply@, notification@ = INFO

ESSENZ nur wenn BEIDES zutrifft:
1. Echter Mensch schreibt PERSÖNLICH (nicht automatisch generiert)
2. Erwartet konkrete Antwort/Aktion von mir

Kategorien:
- ESSENZ = Mensch erwartet persönliche Antwort
- WICHTIG = Könnte Antwort brauchen, nicht sicher
- INFO = Automatische Benachrichtigung
- NEWSLETTER = Marketing, Updates, Events
- SPAM = Werbung, unerwünscht

JSON: {"kat":"info|essenz|wichtig|newsletter|spam","conf":0-100,"sum":"Was will die Mail?"}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100, // Kompakteres JSON
        temperature: 0.1
      });

      const content = response.choices[0].message.content.trim();

      // Parse JSON
      let jsonStr = content;
      if (content.includes('```')) {
        jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }

      const result = JSON.parse(jsonStr);

      // Kategorie aus "kat" oder "kategorie" lesen
      const kategorie = (result.kat || result.kategorie || 'info').toLowerCase();
      const confidence = result.conf || result.confidence || 80;

      return {
        kategorie,
        confidence: Math.max(confidence, 75), // Stufe 3 sollte sicher sein
        zusammenfassung: result.sum || result.zusammenfassung,
        stufe: 3
      };

    } catch (error) {
      console.error('Stufe 3 GPT Fehler:', error.message);

      // Fallback: Stufe 2 Ergebnis verwenden
      return {
        ...stufe2Result,
        stufe: 3,
        error: error.message
      };
    }
  }
}

module.exports = Stufe3Classifier;
