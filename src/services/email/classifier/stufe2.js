/**
 * STUFE 2: Betreff + Absender GPT-Analyse (Günstig)
 * Nur wenn Stufe 1 unsicher ist. Schickt NUR Betreff + Absender an GPT.
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

  async klassifiziere(email, stufe1Result) {
    if (!this.openai) {
      console.warn('OpenAI API Key nicht konfiguriert, überspringe Stufe 2');
      return {
        ...stufe1Result,
        stufe: 2,
        needsGPT: true,
        error: 'API Key fehlt'
      };
    }

    const from = email.from || {};
    const absenderName = from.name || '';
    const absenderEmail = from.address || '';
    const subject = email.subject || '';

    const prompt = `Klassifiziere diese E-Mail NUR anhand von Absender und Betreff:

ABSENDER: ${absenderName} <${absenderEmail}>
BETREFF: ${subject}

Bisherige Einschätzung: ${stufe1Result.kategorie.toUpperCase()} (${stufe1Result.confidence}% sicher)
Gründe: ${stufe1Result.reasons.slice(0, 5).join(', ')}

Kategorien:
- ESSENZ: Muss gelesen werden, erwartet Antwort/Aktion
- WICHTIG: Sollte gelesen werden, relevant
- NORMAL: Kann gelesen werden, nicht dringend
- INFO: Automatische Benachrichtigung (Bestellungen, System-Mails)
- NEWSLETTER: Abonnierter Newsletter, regelmäßige Updates
- SPAM: Werbung, unerwünscht, Marketing

Antworte NUR mit JSON (keine Erklärung davor oder danach):
{
  "kategorie": "essenz|wichtig|normal|info|newsletter|spam",
  "confidence": 0-100,
  "istFrage": true/false,
  "erwartetAntwort": true/false,
  "hatDeadline": true/false,
  "grund": "Kurze Begründung (max 10 Wörter)"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.1
      });

      const content = response.choices[0].message.content.trim();

      // Parse JSON - handle potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }

      const result = JSON.parse(jsonStr);

      // Kombiniere mit Stufe 1
      if (result.confidence >= 75) {
        return {
          kategorie: result.kategorie.toLowerCase(),
          confidence: result.confidence,
          tags: this.extractTags(result),
          grund: result.grund,
          stufe: 2,
          needsGPT: false,
          gptResult: result
        };
      }

      // Immer noch unsicher → Stufe 3
      return {
        kategorie: result.kategorie.toLowerCase(),
        confidence: result.confidence,
        tags: this.extractTags(result),
        grund: result.grund,
        stufe: 2,
        needsGPT: true,
        gptResult: result
      };

    } catch (error) {
      console.error('Stufe 2 GPT Fehler:', error.message);

      // Fallback: Stufe 1 Ergebnis verwenden
      return {
        ...stufe1Result,
        stufe: 2,
        needsGPT: true,
        error: error.message
      };
    }
  }

  // Batch-Verarbeitung für mehrere E-Mails
  async batchKlassifiziere(emails, stufe1Results) {
    if (!this.openai) {
      console.warn('OpenAI API Key nicht konfiguriert');
      return emails.map((_, i) => ({
        ...stufe1Results[i],
        stufe: 2,
        needsGPT: true,
        error: 'API Key fehlt'
      }));
    }

    // Gruppiere bis zu 10 E-Mails in einem Request
    const batchSize = 10;
    const results = [];

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const batchResults = stufe1Results.slice(i, i + batchSize);

      const prompt = `Klassifiziere diese ${batch.length} E-Mails NUR anhand von Absender und Betreff:

${batch.map((e, idx) => {
  const from = e.from || {};
  return `[${idx + 1}]
ABSENDER: ${from.name || ''} <${from.address || ''}>
BETREFF: ${e.subject || ''}
VORHER: ${batchResults[idx].kategorie} (${batchResults[idx].confidence}%)`;
}).join('\n\n')}

Kategorien: ESSENZ, WICHTIG, NORMAL, INFO, NEWSLETTER, SPAM

Antworte NUR mit JSON Array (keine Erklärung):
[
  { "nr": 1, "kategorie": "...", "confidence": 0-100, "erwartetAntwort": true/false, "grund": "..." },
  ...
]`;

      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100 * batch.length,
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

          if (gptResult && gptResult.confidence >= 75) {
            results.push({
              kategorie: gptResult.kategorie.toLowerCase(),
              confidence: gptResult.confidence,
              tags: this.extractTags(gptResult),
              grund: gptResult.grund,
              stufe: 2,
              needsGPT: false,
              gptResult
            });
          } else {
            results.push({
              kategorie: gptResult?.kategorie?.toLowerCase() || batchResults[j].kategorie,
              confidence: gptResult?.confidence || batchResults[j].confidence,
              tags: gptResult ? this.extractTags(gptResult) : [],
              grund: gptResult?.grund,
              stufe: 2,
              needsGPT: true,
              gptResult
            });
          }
        }

      } catch (error) {
        console.error('Batch Stufe 2 Fehler:', error.message);

        // Fallback für die ganze Batch
        for (const result of batchResults) {
          results.push({
            ...result,
            stufe: 2,
            needsGPT: true,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  extractTags(gptResult) {
    const tags = [];

    if (gptResult.erwartetAntwort) {
      tags.push('ANTWORT_NÖTIG');
    }

    if (gptResult.istFrage) {
      tags.push('FRAGE');
    }

    if (gptResult.hatDeadline) {
      tags.push('DEADLINE');
    }

    return tags;
  }
}

module.exports = Stufe2Classifier;
