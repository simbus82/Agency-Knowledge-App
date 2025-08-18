# Development Guidelines

## Scripts
```
npm run dev:all
npm run test
npm run test:ai
npm run release:prep
```

## Stile
- JS moderno (ES2022) senza transpilation
- Evita ottimizzazioni premature
- Commenti per blocchi logica AI

## Test
- `test-connections.js` per sanità integrazioni
- Aggiungere test mirati su nuove API

## Commit
- Prefissi: feat:, fix:, chore:, docs:, refactor:
- Tenere CHANGELOG aggiornato con release:prep

## Performance Tips
- Memorizza risultati costosi (cache helper)
- Evita loop fetch sequenziali (usa Promise.all dove sicuro)

## Futuro Possibile
- Linter + formatter standard (ESLint + Prettier)
- Test unitari per engine memoria
- Benchmark token usage

