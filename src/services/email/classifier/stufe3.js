/**
 * STUFE 3: Volltext-Analyse (Nur wenn nötig)
 * Nur für E-Mails die nach Stufe 1 + 2 immer noch unsicher sind (ca. 5%).
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

  // Intelligente Text-Extraktion - nur relevante Teile
  extrahiereRelevanz(email) {
    const text = email.text || email.body || '';
    const relevanteParts = [];

    // Erster Absatz (meist die Hauptaussage)
    const absätze = text.split(/\n\n+/);
    if (absätze[0]) {
      relevanteParts.push(absätze[0].substring(0, 300));
    }

    // Suche nach Fragen
    const fragen = text.match(/[^.!?\n]*\?/g) || [];
    relevanteParts.push(...fragen.slice(0, 3).map(f => f.trim()));

    // Suche nach Deadlines/Daten
    const zeilen = text.split('\n');
    const datumsZeilen = zeilen.filter(line =>
      /\d{1,2}\.\d{1,2}\.(\d{2,4})?|bis (zum )?\d{1,2}\.|deadline|frist|spätestens/i.test(line) ||
      /morgen|heute|diese woche|nächste woche|tomorrow|today/i.test(line) ||
      /\d{1,2}:\d{2}\s*(uhr)?/i.test(line)
    );
    relevanteParts.push(...datumsZeilen.slice(0, 2).map(z => z.trim()));

    // Suche nach Handlungsaufforderungen
    const aufforderungen = zeilen.filter(line =>
      /bitte|kannst du|könntest du|ich brauche|schick mir|send me|please/i.test(line) ||
      /wäre (es )?(dir )?möglich|würdest du|könnten sie/i.test(line) ||
      /lass (mich|uns) wissen|let me know|confirm|bestätige/i.test(line)
    );
    relevanteParts.push(...aufforderungen.slice(0, 2).map(a => a.trim()));

    // Suche nach Geld-Beträgen
    const geldZeilen = zeilen.filter(line =>
      /€\s*\d+|\d+\s*€|\d+[.,]\d{2}\s*(EUR|CHF|USD)?/i.test(line) ||
      /rechnung|invoice|zahlung|payment|überweisung|betrag/i.test(line)
    );
    relevanteParts.push(...geldZeilen.slice(0, 2).map(g => g.trim()));

    // Entferne Duplikate und leere Zeilen
    const uniqueParts = [...new Set(relevanteParts)]
      .filter(p => p && p.length > 5);

    return uniqueParts.join('\n---\n').substring(0, 1000);
  }

  async klassifiziere(email, bisherigeBewertung) {
    if (!this.openai) {
      console.warn('OpenAI API Key nicht konfiguriert, überspringe Stufe 3');
      return {
        ...bisherigeBewertung,
        stufe: 3,
        error: 'API Key fehlt'
      };
    }

    const from = email.from || {};
    const relevanteParts = this.extrahiereRelevanz(email);

    const prompt = `Analysiere diese E-Mail vollständig:

ABSENDER: ${from.name || ''} <${from.address || ''}>
BETREFF: ${email.subject || ''}
DATUM: ${email.date || 'unbekannt'}

RELEVANTE TEXTTEILE:
${relevanteParts || '(Kein Text verfügbar)'}

Bisherige Einschätzung: ${bisherigeBewertung.kategorie?.toUpperCase()} (${bisherigeBewertung.confidence}% sicher)

Beantworte diese Fragen:
1. Was will der Absender von mir?
2. Muss ich etwas TUN oder nur WISSEN?
3. Gibt es eine Deadline?
4. Ist das eine echte Person oder automatisch generiert?
5. Erwartet jemand eine Antwort von mir?

Kategorien:
- ESSENZ: Muss gelesen werden, erwartet Antwort/Aktion von mir
- WICHTIG: Sollte gelesen werden, relevant für mich
- NORMAL: Kann gelesen werden, nicht dringend
- INFO: Automatische Benachrichtigung (Bestellungen, System-Mails)
- NEWSLETTER: Abonnierter Newsletter, regelmäßige Updates
- SPAM: Werbung, unerwünscht, Marketing

Aktionen:
- antworten: Ich muss antworten
- lesen: Nur zur Kenntnis nehmen
- ignorieren: Kann ignoriert werden
- termin_eintragen: Enthält Termin zum Eintragen
- bezahlen: Rechnung/Zahlung
- entscheiden: Ich muss etwas entscheiden

Antworte NUR mit JSON (keine Erklärung):
{
  "kategorie": "essenz|wichtig|normal|info|newsletter|spam",
  "confidence": 0-100,
  "zusammenfassung": "1 Satz was der Absender will",
  "aktion": "antworten|lesen|ignorieren|termin_eintragen|bezahlen|entscheiden",
  "deadline": "YYYY-MM-DD oder null",
  "tags": ["ANTWORT_NÖTIG", "TERMIN", "GELD", "DEADLINE", "FRAGE", "ENTSCHEIDUNG"],
  "autoAntwortMöglich": true/false,
  "autoAntwortVorschlag": "Kurzer Antworttext wenn möglich, sonst null"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.1
      });

      const content = response.choices[0].message.content.trim();

      // Parse JSON - handle potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }

      const result = JSON.parse(jsonStr);

      return {
        kategorie: result.kategorie.toLowerCase(),
        confidence: Math.max(result.confidence, 80), // Stufe 3 sollte sicher sein
        zusammenfassung: result.zusammenfassung,
        aktion: result.aktion,
        deadline: result.deadline,
        tags: result.tags || [],
        autoAntwortMöglich: result.autoAntwortMöglich,
        autoAntwortVorschlag: result.autoAntwortVorschlag,
        stufe: 3,
        needsGPT: false,
        gptResult: result
      };

    } catch (error) {
      console.error('Stufe 3 GPT Fehler:', error.message);

      // Fallback: Vorheriges Ergebnis mit erhöhter Confidence
      return {
        ...bisherigeBewertung,
        confidence: Math.max(bisherigeBewertung.confidence || 50, 60),
        stufe: 3,
        error: error.message
      };
    }
  }

  // Generiere Auto-Antwort basierend auf Klassifizierung
  async generiereAutoAntwort(email, klassifizierung) {
    if (!klassifizierung.autoAntwortMöglich) {
      return null;
    }

    if (klassifizierung.autoAntwortVorschlag) {
      return klassifizierung.autoAntwortVorschlag;
    }

    if (!this.openai) {
      return null;
    }

    const from = email.from || {};

    const prompt = `Generiere eine kurze, höfliche Antwort auf diese E-Mail:

VON: ${from.name || from.address}
BETREFF: ${email.subject}
ZUSAMMENFASSUNG: ${klassifizierung.zusammenfassung}
AKTION: ${klassifizierung.aktion}

Regeln:
- Maximal 2-3 Sätze
- Professionell aber freundlich
- Auf Deutsch
- Keine Floskeln wie "Ich hoffe diese E-Mail erreicht Sie wohlauf"

Antworte NUR mit dem Antworttext (keine Anführungszeichen):`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.7
      });

      return response.choices[0].message.content.trim();

    } catch (error) {
      console.error('Auto-Antwort Fehler:', error.message);
      return null;
    }
  }
}

module.exports = Stufe3Classifier;
