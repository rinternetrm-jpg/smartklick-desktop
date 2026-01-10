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
      console.warn('[STUFE1] OpenAI API Key nicht konfiguriert!');
      return {
        kategorie: 'info',
        confidence: 50,
        needsMoreText: false,
        stufe: 1,
        error: 'API Key fehlt'
      };
    }

    const from = email.from || {};
    const absenderName = from.name || '';
    const absenderEmail = from.address || '';
    const subject = email.subject || '';

    // STUFE 1: Nur Absender + Betreff (günstig)
    const prompt = `Du bist Roland, ein Unternehmer. Schau dir diese E-Mail an:

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}

Ist das ein echter Mensch der auf meine Antwort wartet? Oder Werbung/Newsletter/Automatisch?

SICHER NICHT WICHTIG (100% sicher):
- MediaMarkt, Eventim, Amazon, eBay = WERBUNG
- Facebook, LinkedIn, Instagram = WERBUNG
- Google-Warnungen, WordPress, IONOS = INFO
- Newsletter, Weekly, Monthly = NEWSLETTER
- noreply@, notification@ = INFO

SICHER WICHTIG (100% sicher):
- Echter Name + echtes Anliegen ("Frage zu...", "Können wir...")
- Persönliche E-Mail-Adresse mit direktem Betreff

UNSICHER (muss Inhalt prüfen):
- Nur "Test", "Anhang", "Dokument" ohne Kontext
- Unbekannter Absender mit unklarem Betreff

Kategorien:
- essenz = Echter Mensch wartet auf Antwort
- wichtig = Könnte Antwort brauchen
- info = System-Mails, Bestätigungen
- werbung = Social Media, Shops, Marketing
- newsletter = Abonnierte Updates
- spam = Phishing, Betrug

JSON: {"kat":"essenz|wichtig|info|werbung|newsletter|spam","sicherheit":0-100,"piepst":true/false}`;

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
      console.log('[STUFE1] Parsed:', result);

      // Kategorie aus "kat" oder "kategorie" lesen
      const kategorie = (result.kat || result.kategorie || 'info').toLowerCase();
      const sicherheit = result.sicherheit || result.conf || result.confidence || 70;
      const piepst = result.piepst || false;

      // STUFE 2 nur wenn Sicherheit < 80%
      const needsMoreText = sicherheit < 80;

      console.log(`[STUFE1] ${subject?.substring(0, 30)}... → ${kategorie} (${sicherheit}%) ${needsMoreText ? '→ STUFE 2' : '✓'}`);

      return {
        kategorie,
        confidence: sicherheit,
        piepst,
        needsMoreText,
        stufe: 1
      };

    } catch (error) {
      console.error('[STUFE1] GPT Fehler:', error.message);
      return {
        kategorie: 'info',
        confidence: 50,
        needsMoreText: true,
        stufe: 1,
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

WERBUNG: Facebook, LinkedIn, Instagram, Amazon, eBay, Shops, "hat gepostet", Rabatt
INFO: WordPress, IONOS, noreply@, Bestätigungen, System-Mails
NEWSLETTER: Abonnierte Updates, Weekly, Monthly
ESSENZ/WICHTIG: Echte Menschen mit persönlicher Anfrage

Kategorien:
- ESSENZ = Mensch erwartet Antwort
- WICHTIG = Könnte Antwort brauchen
- INFO = System-Mails
- WERBUNG = Social Media, Shops
- NEWSLETTER = Abonnierte Updates
- SPAM = Phishing

JSON: [{"nr":1,"kat":"info","conf":85},{"nr":2,"kat":"werbung","conf":90},...]`;

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
