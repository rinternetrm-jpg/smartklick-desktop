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

    const prompt = `Du bist ein E-Mail-Assistent. Die vorherige Analyse war unsicher. Analysiere jetzt den VOLLTEXT.

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}

INHALT:
${body}

---

Beantworte diese 4 Fragen definitiv mit Ja oder Nein:

1. MENSCH? Schreibt hier ein echter Mensch persönlich an mich? (Keine automatische Nachricht, kein System, kein Newsletter)
2. AKTION? Wird von mir eine Antwort, Entscheidung oder Handlung erwartet?
3. GELD? Geht es um Geld, Rechnung, Zahlung, Angebot, Vertrag oder finanzielle Dinge?
4. DRINGEND? Ist es zeitkritisch? Gibt es eine Deadline, einen Termin, oder ist es dringend?

Dann klassifiziere:
- ESSENZ = Echter Mensch der etwas von mir will (Mensch=Ja UND Aktion=Ja), ODER es geht um Geld, ODER es ist dringend
- WICHTIG = Mindestens 1x Ja, aber nicht ganz so kritisch
- INFO = Nützliche automatische Info (Bestellbestätigung, Lieferstatus, Systembenachrichtigung)
- NEWSLETTER = Newsletter, regelmäßige Updates, Marketing das ich evtl. abonniert habe
- SPAM = Unerwünschte Werbung, Phishing, Müll

Antworte NUR mit JSON:
{
  "mensch": "ja|nein",
  "aktion": "ja|nein",
  "geld": "ja|nein",
  "dringend": "ja|nein",
  "kategorie": "essenz|wichtig|info|newsletter|spam",
  "confidence": 0-100,
  "zusammenfassung": "1-2 Sätze was die E-Mail will",
  "grund": "Warum diese Kategorie"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1
      });

      const content = response.choices[0].message.content.trim();

      // Parse JSON
      let jsonStr = content;
      if (content.includes('```')) {
        jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }

      const result = JSON.parse(jsonStr);

      // Zähle "Ja" Antworten
      const jaCount = ['mensch', 'aktion', 'geld', 'dringend']
        .filter(key => result[key]?.toLowerCase() === 'ja').length;

      return {
        kategorie: result.kategorie.toLowerCase(),
        confidence: Math.max(result.confidence, 80), // Stufe 3 sollte sicher sein
        mensch: result.mensch,
        aktion: result.aktion,
        geld: result.geld,
        dringend: result.dringend,
        zusammenfassung: result.zusammenfassung,
        grund: result.grund,
        jaCount,
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
