# Setup & Installation

## Prerequisiti
- Node.js 18+
- NPM 8+
- Account Google Workspace (dominio consentito)
- Claude API Key
- (Opzionale) ClickUp workspace (OAuth o personal token)
- (Opzionale) Gmail service account (read-only)

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
1. OAuth App (client id/secret) per interazioni user driven
2. Oppure genera Personal API Token e impostalo come `CLICKUP_API_KEY`
3. Connetti via UI oppure lascia solo token server se basta read-only

## Setup Gmail (Opzionale Read-Only)
1. Service Account + Domain-wide Delegation
2. Scope: `https://www.googleapis.com/auth/gmail.readonly`
3. Inserisci JSON in `GOOGLE_CREDENTIALS_JSON` e mail utente in `GOOGLE_IMPERSONATED_USER_EMAIL`
4. Riavvia: il planner includerà i tool Gmail

## Verifica
- `/health` → tutti i servizi `connected`
- `/version` → mostra versione corrente

