# Smartklick Desktop

Desktop Voice App mit KI-Korrektur für Windows, macOS und Linux.

## Features

- **3 Ansichtsmodi:** Mini, Kompakt, Normal
- **5 Tonalitäten:** Native, Privat, Casual, Freundlich, Learning
- **Übersetzung:** DE, EN, FR, ES, IT
- **Learning-Modus:** Fehler-Analyse mit Korrektur-Panel
- **Agent-Modus:** Sprachbefehle für E-Mails, Kalender, Drive, Web-Suche
- **Always-on-Top:** Optional
- **Hotkey-Support:** Strg+Shift+S, Alt+S, F9
- **Tray-Icon:** Läuft im Hintergrund

## Installation

```bash
npm install
```

## Entwicklung

```bash
npm start
```

## Build

### Windows
```bash
npm run build:win
```

### macOS
```bash
npm run build:mac
```

### Linux
```bash
npm run build:linux
```

## Projektstruktur

```
smartklick-desktop/
├── package.json
├── main.js              # Electron Main Process
├── preload.js           # Preload Script (IPC Bridge)
├── src/
│   ├── index.html       # Alle 3 Modi in einer Datei
│   ├── styles/
│   │   └── main.css     # Komplettes Styling
│   ├── scripts/
│   │   └── app.js       # App-Logik (Audio, API, UI)
│   └── assets/
│       └── icons/
└── build/               # Build-Output
```

## API

Die App kommuniziert mit dem Voice Keyboard Server:
- **Server:** http://188.40.97.126:8080
- **Endpoint:** POST /transcribe/stream
- **Format:** Server-Sent Events (SSE)

## Tastenkürzel

| Kürzel | Aktion |
|--------|--------|
| Strg+Shift+S | Aufnahme starten/stoppen |
| Escape | Panel schließen |
| Enter | Text einfügen (im Panel) |

## Tonalitäten

| Farbe | Modus | Beschreibung |
|-------|-------|--------------|
| 🟠 Orange | Native | Muttersprachlich natürlich |
| 🔴 Rot | Privat | Liebevoll mit Kosenamen |
| 🔵 Blau | Casual | Locker und entspannt |
| 🟢 Grün | Freundlich | Warm und freundlich |
| 🟣 Violett | Learning | Fehler-Analyse |
