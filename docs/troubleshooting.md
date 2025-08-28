# Troubleshooting

## Problemi Comuni
| Errore | Causa | Fix |
|--------|-------|-----|
| Claude 401 | API key errata | Aggiorna chiave in settings |
| Drive access denied | Token scaduto / scope mancante | Rifai login Google + verifica scope Drive |
| ClickUp vuoto | OAuth incompleto / token assente | Riconnetti ClickUp o aggiungi `CLICKUP_API_KEY` |
| Gmail tool assente | Variabili Gmail mancanti | Imposta `GOOGLE_CREDENTIALS_JSON` + `GOOGLE_IMPERSONATED_USER_EMAIL` |
| tool_call error salvato | Connettore fallito (rete/auth) | Verifica log, riprova dopo fix credenziali |
| Lentezza risposta | Task graph ampio / molte annotazioni | Riduci limiti, verifica caching |
| Version non aggiornata | Cache browser | Hard refresh + controlla `/version` |

## Logs
File giornalieri in `./logs/`.
Aumenta verbosità: `LOG_LEVEL=debug`.

## Health
`/health` restituisce stato servizi.

## Reset Locale
```bash
mv data/*.db backups/
rm -rf node_modules && npm install
```

