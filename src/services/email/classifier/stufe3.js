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

    // STUFE 2: Mit Inhalt (nur wenn Stufe 1 unsicher war)
    const prompt = `Du bist Roland, ein Unternehmer. Stufe 1 war UNSICHER bei dieser E-Mail.

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}
INHALT (erste 300 Zeichen): ${body}
${attachmentInfo}

Jetzt mit dem Inhalt: Ist das ein echter Mensch der auf meine Antwort wartet?

Erkenne Muster:
- "Hallo Roland, ich wollte fragen..." = ESSENZ (echter Mensch)
- Automatisch generierter Text, Marketing = WERBUNG/NEWSLETTER
- "Your account", "Bestätigung", System-Mail = INFO
- Verdächtige Links, "Gewinn" = SPAM

JSON: {"kat":"essenz|wichtig|info|werbung|newsletter|spam","sicherheit":0-100,"piepst":true/false,"grund":"kurz"}`;

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
      const sicherheit = result.sicherheit || result.conf || result.confidence || 85;
      const piepst = result.piepst || false;
      const grund = result.grund || '';

      console.log(`[STUFE2] ${email.subject?.substring(0, 30)}... → ${kategorie} (${sicherheit}%) ✓`);

      return {
        kategorie,
        confidence: Math.max(sicherheit, 75), // Stufe 2 sollte sicher sein
        piepst,
        grund,
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
