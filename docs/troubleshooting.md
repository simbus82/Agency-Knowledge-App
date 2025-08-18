# Troubleshooting

## Problemi Comuni
| Errore | Causa | Fix |
|--------|-------|-----|
| Claude 401 | API key errata | Aggiorna chiave in settings |
| Drive access denied | Token scaduto | Rifai login Google |
| ClickUp vuoto | OAuth non completo | Riconnetti ClickUp |
| Lentezza risposta | Fetch dati + parsing | Attendi / riduci limiti fetch |
| Version non aggiornata | Cache browser | Refresh hard + controlla `/version` |

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

