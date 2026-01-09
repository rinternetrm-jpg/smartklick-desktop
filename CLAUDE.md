# Projektregeln für Smartklick Desktop

## Nach jedem Build automatisch:
1. Version in package.json erhöhen (patch)
2. Git commit mit Version
3. Git tag erstellen (v[VERSION])
4. GitHub Release erstellen mit der EXE
5. Download-Link ausgeben

## Build Befehl:
npm run build:win

## Immer nach erfolgreichem Build fragen:
"Soll ich einen GitHub Release erstellen?"

## GitHub Repository:
- Remote: https://github.com/rinternetrm-jpg/smartklick-desktop.git
- Releases: https://github.com/rinternetrm-jpg/smartklick-desktop/releases

## Projekt-Struktur:
- `main.js` - Electron Hauptprozess
- `preload.js` - Preload Script für IPC
- `src/` - Frontend Code (HTML, CSS, JS)
- `src/services/` - Backend Services
- `build/` - Build Output (EXE)

## Wichtige Dateien:
- `src/email-window.html` - E-Mail Dashboard
- `src/styles/email.css` - E-Mail Styles (Slate Blue Dark Mode)
- `src/scripts/email-app.js` - E-Mail Frontend Logic
