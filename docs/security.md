# Security

## Implementato
- Backend-only secrets
- Dominio Google allowlist
- Token refresh cifrati (AES-256-GCM)
- Session cookie httpOnly
- CORS controllato
- Limiti dimensione file / truncation
- On-demand enrichment
- Audit errori refresh token
- Gating dinamico connettori (evita esposizione tool non configurati)
- Service Account Gmail con scope minimo (readonly)

## Da Aggiungere
- Rate limiting middleware
- CSP più granulare
- Audit trail modifiche settings
- Alerting centralizzato
- Vector semantic store (privacy controls)
- Rate limit per tool_call / fonte
- Grounding validator anti-hallucination

## Token Encryption
Chiave: `TOKEN_ENC_KEY` base64 32 bytes.
Algoritmo: aes-256-gcm (nonce + tag memorizzati).

## Checklist Rapida
- [ ] `.env` non versionato
- [ ] Rotate chiavi trimestralmente
- [ ] Backup DB cifrati
- [ ] Log accessi revisionati mensilmente

