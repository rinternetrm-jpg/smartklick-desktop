# Smartklick E-Mail Klassifizierungssystem v2

## Übersicht

Das System klassifiziert E-Mails in folgende Kategorien:

| Kategorie | Icon | Beschreibung |
|-----------|------|--------------|
| ESSENZ | ⭐ | Sofortige Aktion erforderlich (nur wenn < 7 Tage alt) |
| WICHTIG | 🔴 | Sollte heute gelesen werden (nur wenn < 14 Tage alt) |
| TERMINE | 📅 | Kalender-Einladungen, Zoom, Teams Meetings |
| RECHNUNG | 📄 | Rechnungen (Alter egal!) |
| NORMAL | 📧 | Standard E-Mails |
| INFO | ℹ️ | System-Benachrichtigungen |
| NEWSLETTER | 📰 | Abonnierte Newsletter |
| WERBUNG | 📢 | Marketing, Promotions |
| SPAM | 🚫 | Unerwünschte Werbung |
| VERALTET | 📦 | E-Mails älter als 30 Tage |

---

## Klassifizierungs-Reihenfolge

Die Klassifizierung erfolgt in dieser EXAKTEN Reihenfolge:

### STUFE 1: RECHNUNG (VOR Alter-Check!)
Rechnungen sind IMMER relevant, egal wie alt!

**Erkennungsmuster:**
- `ihre.*rechnung`
- `rechnung (nr|nummer)`
- `rechnungsnummer`
- `invoice`
- `zahlungseingang`
- `zahlungsbestätigung`
- `zahlungsbeleg`
- `rechnung im anhang`
- `1&1.*rechnung`
- `ionos.*rechnung`

→ Kategorie: **RECHNUNG** (Confidence: 95%)

---

### STUFE 2: TERMIN (VOR Alter-Check!)
Termine haben eigene Datum-Logik.

**Termin-Domains:**
- calendar.google.com
- teams.microsoft.com
- zoom.us
- calendly.com
- doodle.com

**Erkennungsmuster:**
- `zoom.*meeting` / `zoom.*einladung` / `join.*zoom`
- `teams.*meeting` / `teams.*einladung` / `teams.*besprechung` / `microsoft teams`
- `calendar.*invite` / `google.*calendar` / `einladung.*kalender`
- `einladung.*besprechung` / `termin.*einladung` / `meeting.*einladung`
- `besprechungsanfrage` / `terminanfrage`

**Termin-Datum-Logik:**
- Termin in der Zukunft → **TERMINE**
- Termin war gestern → **TERMINE** + Warnung "Möglicherweise verpasst"
- Termin ist vorbei → **INFO**
- Kein Datum gefunden + E-Mail < 7 Tage → **TERMINE**
- Kein Datum gefunden + E-Mail > 7 Tage → **INFO**

---

### STUFE 3: ALTER PRÜFEN

| Alter | Maximale Kategorie | Gruppe |
|-------|-------------------|--------|
| 0-3 Tage | ESSENZ | SEHR_AKTUELL |
| 3-7 Tage | ESSENZ | AKTUELL |
| 7-14 Tage | WICHTIG | RELEVANT |
| 14-30 Tage | NORMAL | ALT |
| 30-90 Tage | VERALTET | VERALTET |
| > 90 Tage | ARCHIV (ignorieren) | ARCHIV |

**Ausnahmen (ignorieren Alters-Limit):**
- RECHNUNG
- INFO
- NEWSLETTER
- WERBUNG
- SPAM

---

### STUFE 4: DRINGLICHKEITS-CHECK (VOR Domain!)

#### ESSENZ Keywords (nur wenn E-Mail < 7 Tage alt):

**Rechtlich/Finanziell dringend:**
- `vollstreckung`
- `letzte mahnung`
- `inkasso`
- `anwalt`
- `gericht`
- `klage`
- `zwangsvollstreckung`
- `pfändung`
- `mahnbescheid`

**Persönliche Anfragen:**
- `bitte (um)? anrufen`
- `rückruf`
- `ruf.*an`
- `kann dich nicht erreichen`
- `melde dich`
- `dringend`
- `urgent`

**Meetings mit Namen:**
- `meeting roland`
- `termin roland`
- `besprechung roland`

→ Kategorie: **ESSENZ** (Confidence: 95%)

#### WICHTIG Keywords (nur wenn E-Mail < 14 Tage alt):

**Zahlungsprobleme:**
- `fehlgeschlagen`
- `abgelehnt`
- `nicht möglich`
- `kreditkarteneinzug`
- `einzug fehlgeschlagen`
- `zahlung fehlgeschlagen`
- `konto nicht gedeckt`
- `zahlungserinnerung`
- `zahlungsproblem`

**Mahnungen:**
- `mahnung`

**Fristen:**
- `letzte chance`
- `läuft ab`
- `endet heute`
- `frist`
- `deadline`

**Wichtige Änderungen:**
- `kündigung`
- `gekündigt`
- `vertragsänderung`
- `sperrung`
- `gesperrt`
- `deaktiviert`

→ Kategorie: **WICHTIG** (Confidence: 90%)

---

### STUFE 5: ABSENDER-HISTORIE

Das System merkt sich Absender und berechnet einen "Urgency Score" (0-100).

**Wenn Urgency Score > 75:**
- Absender sendet oft wichtige E-Mails
- Nicht automatisch als INFO markieren
- GPT muss entscheiden

**Urgency Score Berechnung:**
- Basis: 50 Punkte
- Wiederholte Betreffs: +15 bis +35 Punkte
- Historisch wichtige E-Mails: bis +30 Punkte
- Aktivität in letzter Woche: +10 bis +20 Punkte

---

### STUFE 6: DOMAIN-CHECK (nur wenn keine Dringlichkeit)

#### MIXED_DOMAINS - GPT entscheidet:
Diese Domains können wichtige E-Mails enthalten!
- ionos.de, 1und1.de, hosteurope.de
- wise.com, paypal.com, stripe.com
- google.com, linkedin.com, twitter.com, instagram.com

→ Keine automatische Klassifizierung → GPT

#### SPAM_DOMAINS → WERBUNG:
- mediamarkt.de, saturn.de, amazon.*, ebay.*
- zalando.*, otto.de, lidl.*, aldi.*
- marketing.*, promo.*, deals.*, shop.*
- mail.facebook.com, facebookmail.com
- pinterest.com, tiktok.com

→ Kategorie: **WERBUNG** (Confidence: 90%)

#### NEWSLETTER_DOMAINS → NEWSLETTER:
- newsletter.*, news.*, update.*, digest.*
- eventim.*, ticketmaster.*, eventbrite.*
- substack.com, mailchimp.com, sendinblue.*

→ Kategorie: **NEWSLETTER** (Confidence: 88%)

#### INFO_DOMAINS → INFO:
- noreply.*, no-reply.*, notification.*
- github.com, gitlab.com, wordpress.*
- dhl.*, dpd.*, ups.*, fedex.*, post.ch

→ Kategorie: **INFO** (Confidence: 85%)

#### INFO_PREFIXES → INFO:
Wenn die E-Mail-Adresse folgendes enthält:
- noreply, no-reply, notification
- mailer, postmaster, daemon, system

→ Kategorie: **INFO** (Confidence: 85%)

---

### STUFE 7: GPT KLASSIFIZIERUNG

Wenn keine der obigen Regeln greift → GPT analysiert:
- Betreff
- Absender
- E-Mail-Text
- Kontext

---

## GPT Prompt (für Stufe 1-2 der GPT-Klassifizierung)

```
Du bist ein E-Mail-Klassifizierungssystem.

Klassifiziere die folgende E-Mail in EINE der Kategorien:
- essenz: Sofortige Aktion nötig (Rechtliches, Mahnungen, dringende Anfragen)
- wichtig: Sollte heute gelesen werden (Zahlungsprobleme, Fristen, Änderungen)
- termine: Kalender-Einladungen, Meetings
- rechnung: Rechnungen und Zahlungsbelege
- normal: Normale E-Mails die Aufmerksamkeit verdienen
- info: System-Benachrichtigungen, automatische Mails
- newsletter: Abonnierte Newsletter
- werbung: Marketing, Promotions, Angebote
- spam: Unerwünschte Werbung

Antworte im JSON-Format:
{
  "kategorie": "...",
  "confidence": 0-100,
  "gedanken": "Kurze Begründung"
}

E-Mail:
Von: {from}
Betreff: {subject}
Datum: {date}
```

---

## Zusammenfassung Klassifizierungs-Logik

```
1. RECHNUNG? → RECHNUNG (Alter egal!)
2. TERMIN?
   - Datum in Zukunft → TERMINE
   - Datum gestern → TERMINE + Warnung
   - Datum vorbei → INFO
3. ALTER > 90 Tage? → INFO (Archiv)
4. ESSENZ Keywords + < 7 Tage? → ESSENZ
5. WICHTIG Keywords + < 14 Tage? → WICHTIG
6. Absender Urgency > 75? → GPT
7. MIXED Domain? → GPT
8. SPAM Domain? → WERBUNG
9. NEWSLETTER Domain? → NEWSLETTER
10. INFO Domain/Prefix? → INFO
11. Sonst → GPT
```

---

## Alters-Herabstufung

Wenn eine E-Mail zu alt ist für ihre Kategorie:

| Ursprüngliche Kategorie | E-Mail-Alter | Neue Kategorie |
|------------------------|--------------|----------------|
| ESSENZ | > 7 Tage | WICHTIG |
| ESSENZ | > 14 Tage | NORMAL |
| ESSENZ | > 30 Tage | VERALTET |
| WICHTIG | > 14 Tage | NORMAL |
| WICHTIG | > 30 Tage | VERALTET |

---

*Smartklick E-Mail Klassifizierung v2.72.0*
