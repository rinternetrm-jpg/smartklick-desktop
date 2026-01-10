/**
 * STUFE 1: GPT-Klassifizierung (nur Absender + Betreff)
 *
 * Wird aufgerufen wenn Stufe 0 (Domain-Check) nicht sicher war.
 * Analysiert nur Absender und Betreff - günstig!
 * Bei Unsicherheit (<80%) → Stufe 2 mit Inhalt
 */

const OpenAI = require('openai');
const Store = require('electron-store');

class Stufe2Classifier {
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

    // Lade vorheriges Feedback und Regeln
    const feedbackContext = this.getFeedbackContext();
    const regelnContext = this.getRegelnContext();

    // STUFE 1: Nur Absender + Betreff (günstig)
    const prompt = `Du bist Roland Müller, ein Schweizer Unternehmer. Analysiere diese E-Mail:

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}

WICHTIG - ABSENDER-REGELN:
1. E-Mails von "Roland Müller" an mich selbst sind MEIST Tests
2. ABER: Wenn Betreff/Inhalt "rückruf", "anrufen", "dringend", "erreichen", "bitte" enthält = WICHTIG!
3. Der INHALT überschreibt die Absender-Regel! Jemand der um Rückruf bittet wartet auf mich!
${regelnContext}${feedbackContext}
Frage: Ist das ein echter Mensch der auf MEINE Antwort wartet?

KATEGORIEN:
- essenz = Echter Mensch wartet definitiv auf Antwort
- wichtig = Könnte Antwort brauchen
- info = System-Mails, Bestätigungen, automatisch
- werbung = Shops, Social Media, Marketing
- newsletter = Abonnierte Updates
- spam = Phishing, Betrug, Tests

DENKE LAUT: Erkläre kurz warum du so entscheidest.

JSON: {"kategorie":"...","gedanken":"Kurze Begründung warum...","sicherheit":0-100}`;

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

      // Felder auslesen
      const kategorie = (result.kategorie || result.kat || 'info').toLowerCase();
      const sicherheit = result.sicherheit || result.confidence || 70;
      const gedanken = result.gedanken || result.grund || '';

      // STUFE 2 nur wenn Sicherheit < 80%
      const needsMoreText = sicherheit < 80;

      console.log(`[STUFE1] ${subject?.substring(0, 30)}... → ${kategorie} (${sicherheit}%) ${needsMoreText ? '→ STUFE 2' : '✓'}`);
      if (gedanken) {
        console.log(`[STUFE1] Gedanken: ${gedanken.substring(0, 100)}...`);
      }

      return {
        kategorie,
        confidence: sicherheit,
        gedanken,
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
