/**
 * STUFE 2: Intelligente GPT-Klassifizierung (Betreff + Absender)
 *
 * GPT entscheidet basierend auf 4 Fragen:
 * 1. Ist das ein echter Mensch oder automatisch?
 * 2. Erwartet jemand eine Antwort/Aktion?
 * 3. Geht es um Geld?
 * 4. Ist es zeitkritisch?
 *
 * KEINE Regeln, KEINE Whitelist/Blacklist - nur GPT-Intelligenz
 */

const OpenAI = require('openai');
const Store = require('electron-store');

class Stufe2Classifier {
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

  async klassifiziere(email) {
    if (!this.openai) {
      console.warn('OpenAI API Key nicht konfiguriert');
      return {
        kategorie: 'normal',
        confidence: 50,
        needsMoreText: false,
        stufe: 2,
        error: 'API Key fehlt'
      };
    }

    const from = email.from || {};
    const absenderName = from.name || '';
    const absenderEmail = from.address || '';
    const subject = email.subject || '';

    const prompt = `Du bist ein E-Mail-Assistent. Analysiere NUR Absender und Betreff.

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}

Beantworte diese 4 Fragen mit Ja/Nein/Unsicher:

1. MENSCH? Ist das von einem echten Menschen (nicht automatisch/System/Newsletter)?
2. AKTION? Erwartet jemand eine Antwort oder Aktion von mir?
3. GELD? Geht es um Geld (Rechnung, Zahlung, Angebot, Vertrag)?
4. DRINGEND? Ist es zeitkritisch (Deadline, Termin, dringend)?

Dann klassifiziere:
- ESSENZ = Mindestens 2x Ja bei wichtigen Fragen (Mensch+Aktion, oder Geld, oder Dringend)
- WICHTIG = Mindestens 1x Ja
- INFO = Automatische Benachrichtigung die nützlich sein könnte
- NEWSLETTER = Regelmäßiger Newsletter/Marketing
- SPAM = Werbung, unerwünscht

Antworte NUR mit JSON:
{
  "mensch": "ja|nein|unsicher",
  "aktion": "ja|nein|unsicher",
  "geld": "ja|nein|unsicher",
  "dringend": "ja|nein|unsicher",
  "kategorie": "essenz|wichtig|info|newsletter|spam",
  "confidence": 0-100,
  "grund": "Kurze Begründung"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
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

      // Zähle "Unsicher" Antworten
      const unsicherCount = ['mensch', 'aktion', 'geld', 'dringend']
        .filter(key => result[key]?.toLowerCase() === 'unsicher').length;

      // Brauchen wir mehr Text?
      const needsMoreText = unsicherCount >= 2 || (result.confidence < 70 && jaCount > 0);

      return {
        kategorie: result.kategorie.toLowerCase(),
        confidence: result.confidence,
        mensch: result.mensch,
        aktion: result.aktion,
        geld: result.geld,
        dringend: result.dringend,
        grund: result.grund,
        jaCount,
        unsicherCount,
        needsMoreText,
        stufe: 2
      };

    } catch (error) {
      console.error('Stufe 2 GPT Fehler:', error.message);
      return {
        kategorie: 'normal',
        confidence: 50,
        needsMoreText: true,
        stufe: 2,
        error: error.message
      };
    }
  }

  // Batch-Klassifizierung für mehrere E-Mails
  async batchKlassifiziere(emails) {
    if (!this.openai) {
      return emails.map(() => ({
        kategorie: 'normal',
        confidence: 50,
        needsMoreText: false,
        stufe: 2,
        error: 'API Key fehlt'
      }));
    }

    // Gruppiere bis zu 10 E-Mails in einem Request
    const batchSize = 10;
    const results = [];

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      const prompt = `Du bist ein E-Mail-Assistent. Analysiere diese ${batch.length} E-Mails NUR anhand von Absender und Betreff.

${batch.map((e, idx) => {
  const from = e.from || {};
  return `[${idx + 1}]
ABSENDER: ${from.name || ''} <${from.address || ''}>
BETREFF: ${e.subject || ''}`;
}).join('\n\n')}

Für JEDE E-Mail, beantworte:
1. MENSCH? Echter Mensch oder automatisch?
2. AKTION? Erwartet Antwort/Aktion?
3. GELD? Geht es um Geld?
4. DRINGEND? Zeitkritisch?

Klassifiziere:
- ESSENZ = Mindestens 2x Ja (wichtig!)
- WICHTIG = Mindestens 1x Ja
- INFO = Nützliche automatische Nachricht
- NEWSLETTER = Newsletter/Marketing
- SPAM = Werbung/unerwünscht

Antworte NUR mit JSON Array:
[
  {"nr": 1, "mensch": "ja|nein", "aktion": "ja|nein", "geld": "ja|nein", "dringend": "ja|nein", "kategorie": "...", "confidence": 0-100, "grund": "..."},
  ...
]`;

      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150 * batch.length,
          temperature: 0.1
        });

        const content = response.choices[0].message.content.trim();
        let jsonStr = content;
        if (content.includes('```')) {
          jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }

        const batchResponse = JSON.parse(jsonStr);

        for (let j = 0; j < batch.length; j++) {
          const gptResult = batchResponse.find(r => r.nr === j + 1) || batchResponse[j];

          if (gptResult) {
            const jaCount = ['mensch', 'aktion', 'geld', 'dringend']
              .filter(key => gptResult[key]?.toLowerCase() === 'ja').length;

            const unsicherCount = ['mensch', 'aktion', 'geld', 'dringend']
              .filter(key => gptResult[key]?.toLowerCase() === 'unsicher').length;

            results.push({
              kategorie: gptResult.kategorie?.toLowerCase() || 'normal',
              confidence: gptResult.confidence || 70,
              mensch: gptResult.mensch,
              aktion: gptResult.aktion,
              geld: gptResult.geld,
              dringend: gptResult.dringend,
              grund: gptResult.grund,
              jaCount,
              unsicherCount,
              needsMoreText: unsicherCount >= 2 || gptResult.confidence < 70,
              stufe: 2
            });
          } else {
            results.push({
              kategorie: 'normal',
              confidence: 50,
              needsMoreText: true,
              stufe: 2
            });
          }
        }

      } catch (error) {
        console.error('Batch Stufe 2 Fehler:', error.message);

        // Fallback für die ganze Batch
        for (let j = 0; j < batch.length; j++) {
          results.push({
            kategorie: 'normal',
            confidence: 50,
            needsMoreText: true,
            stufe: 2,
            error: error.message
          });
        }
      }
    }

    return results;
  }
}

module.exports = Stufe2Classifier;
