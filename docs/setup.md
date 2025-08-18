# Setup & Installation

## Prerequisiti
- Node.js 18+
- NPM 8+
- Account Google Workspace (dominio consentito)
- Claude API Key
- (Opzionale) ClickUp workspace

## Procedura Rapida
```bash
git clone https://github.com/simbus82/Agency-Knowledge-App.git
cd Agency-Knowledge-App
npm run setup
npm run dev:all
```
Browser: http://localhost:8080

## Procedura Manuale
```bash
npm install
cp .env.example .env
# Modifica valori richiesti
npm run start:all
```

## Setup Google OAuth (Sintesi)
1. Crea progetto su Google Cloud
2. Abilita Drive API
3. Crea OAuth Client (Web)
4. Redirect: `http://localhost:8080/callback/google`
5. Imposta `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`

## Setup ClickUp (Opzionale)
1. Crea app / token
2. Autorizza e ottieni Team ID
3. Connetti via UI → Impostazioni

## Verifica
- `/health` → tutti i servizi `connected`
- `/version` → mostra versione corrente

