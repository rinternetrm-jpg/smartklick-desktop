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
    const storeKey = this.store.get('openaiApiKey');
    const envKey = process.env.OPENAI_API_KEY;
    const apiKey = storeKey || envKey;

    console.log('[STUFE2] API Key Status:', {
      fromStore: storeKey ? 'found (' + storeKey.substring(0, 10) + '...)' : 'not set',
      fromEnv: envKey ? 'found (' + envKey.substring(0, 10) + '...)' : 'not set',
      using: apiKey ? 'configured' : 'MISSING'
    });

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
      console.warn('[STUFE2] OpenAI API Key nicht konfiguriert!');
      return {
        kategorie: 'info',  // Fallback zu info
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

    const prompt = `Klassifiziere diese E-Mail NUR anhand von Absender und Betreff.

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}

WICHTIG - Das sind KEINE echten Menschen:
- WordPress, IONOS, Hostinger, Strato = Hosting-Benachrichtigungen → INFO
- noreply@, no-reply@, notification@, info@, support@ = Automatisch → INFO
- Facebook, LinkedIn, Twitter, Instagram = Social Media → INFO oder NEWSLETTER
- Amazon, PayPal, DHL, Hermes = Bestellungen/Versand → INFO
- Newsletter, "Dein Update", "Weekly" = NEWSLETTER

ECHTE Menschen (ESSENZ/WICHTIG):
- Persönliche E-Mail-Adresse (vorname.nachname@firma.de)
- Direkter Betreff wie "Frage zu...", "Können wir...", "Bitte um..."
- Jemand der PERSÖNLICH schreibt und eine Antwort erwartet

Kategorien:
- ESSENZ = Echter Mensch schreibt persönlich UND erwartet Antwort/Aktion
- WICHTIG = Könnte wichtig sein, aber nicht sicher ob Antwort nötig
- INFO = Automatische System-Mails, Bestätigungen, Benachrichtigungen
- NEWSLETTER = Regelmäßige Updates, Marketing, Werbung die ich evtl. abonniert habe
- SPAM = Unerwünschte Werbung, Phishing

Antworte NUR mit JSON:
{"kategorie":"essenz|wichtig|info|newsletter|spam","confidence":0-100,"grund":"max 10 Worte"}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1
      });

      const content = response.choices[0].message.content.trim();
      console.log('[STUFE2] GPT Response:', content.substring(0, 200));

      // Parse JSON
      let jsonStr = content;
      if (content.includes('```')) {
        jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }

      // Find JSON in response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const result = JSON.parse(jsonStr);
      console.log('[STUFE2] Parsed:', result);

      // Brauchen wir mehr Text? Nur bei niedriger Confidence
      const needsMoreText = result.confidence < 60;

      return {
        kategorie: result.kategorie?.toLowerCase() || 'info',
        confidence: result.confidence || 70,
        grund: result.grund,
        needsMoreText,
        stufe: 2
      };

    } catch (error) {
      console.error('[STUFE2] GPT Fehler:', error.message);
      console.error('[STUFE2] Full error:', error);
      return {
        kategorie: 'info',  // Fallback zu info statt normal
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
      console.warn('[STUFE2-BATCH] OpenAI API Key nicht konfiguriert!');
      return emails.map(() => ({
        kategorie: 'info',
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

      const prompt = `Klassifiziere diese ${batch.length} E-Mails.

${batch.map((e, idx) => {
  const from = e.from || {};
  return `[${idx + 1}] ${from.name || ''} <${from.address || ''}> | ${e.subject || ''}`;
}).join('\n')}

KEINE echten Menschen: WordPress, IONOS, Hostinger, Strato, noreply@, notification@, Facebook, LinkedIn, Amazon, PayPal, DHL → INFO
ECHTE Menschen: Persönliche Adresse (vorname@), direkter Betreff ("Frage zu...", "Können wir...") → ESSENZ/WICHTIG

Kategorien:
- ESSENZ = Echter Mensch erwartet Antwort
- WICHTIG = Könnte wichtig sein
- INFO = System-Mail, Bestätigung
- NEWSLETTER = Marketing, Updates
- SPAM = Unerwünscht

JSON Array:
[{"nr":1,"kat":"info","conf":85},{"nr":2,"kat":"essenz","conf":90},...]`;

      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 50 * batch.length, // Kompakteres JSON = weniger Tokens
          temperature: 0.1
        });

        const content = response.choices[0].message.content.trim();
        console.log('[STUFE2-BATCH] GPT Response:', content.substring(0, 300));

        let jsonStr = content;
        if (content.includes('```')) {
          jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }

        // Find JSON array in response
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        }

        const batchResponse = JSON.parse(jsonStr);
        console.log('[STUFE2-BATCH] Parsed', batchResponse.length, 'results');

        for (let j = 0; j < batch.length; j++) {
          const gptResult = batchResponse.find(r => r.nr === j + 1) || batchResponse[j];

          if (gptResult) {
            // Kategorie aus "kat" oder "kategorie" lesen
            const kategorie = (gptResult.kat || gptResult.kategorie || 'info').toLowerCase();
            const confidence = gptResult.conf || gptResult.confidence || 70;

            results.push({
              kategorie,
              confidence,
              needsMoreText: confidence < 60,
              stufe: 2
            });
          } else {
            console.warn('[STUFE2-BATCH] Kein Result für Email', j + 1);
            results.push({
              kategorie: 'info',
              confidence: 50,
              needsMoreText: true,
              stufe: 2
            });
          }
        }

      } catch (error) {
        console.error('[STUFE2-BATCH] Fehler:', error.message);
        console.error('[STUFE2-BATCH] Full error:', error);

        // Fallback für die ganze Batch
        for (let j = 0; j < batch.length; j++) {
          results.push({
            kategorie: 'info',
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
